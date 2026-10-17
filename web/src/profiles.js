import * as asn1js from 'asn1js';
import { ContentInfo, SignedData, Certificate, IssuerAndSerialNumber } from 'pkijs';
import { readPlist } from './plist.js';
import { inspectMachO, signatureSlots } from './macho.js';

const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
export const digest = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

function signedData(bytes) {
  const parsed = asn1js.fromBER(buffer(bytes));
  if (parsed.offset === -1) throw new Error('Cannot read the signed certificate data.');
  const info = new ContentInfo({ schema: parsed.result });
  if (info.contentType !== '1.2.840.113549.1.7.2') throw new Error('Expected a CMS signed document.');
  return new SignedData({ schema: info.content });
}

export async function readProfile(file) {
  if (!file.size || file.size > 4 * 1024 * 1024) throw new Error('Provisioning profiles must be smaller than 4 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const cms = signedData(bytes);
  if (!await cms.verify({ signer: 0, checkChain: false })) throw new Error('Provisioning profile signature is invalid.');
  const content = cms.encapContentInfo.eContent?.getValue();
  if (!content) throw new Error('Provisioning profile has no content.');
  const value = readPlist(new Uint8Array(content));
  if (!Array.isArray(value.Platform) || !value.Platform.includes('iOS')) throw new Error(`Not an iOS provisioning profile: ${file.name}`);
  if (!(value.ExpirationDate instanceof Date) || value.ExpirationDate <= new Date()) throw new Error(`Profile expired: ${file.name}`);
  if (value.CreationDate > new Date()) throw new Error(`Profile is not valid yet: ${file.name}`);
  const entitlements = value.Entitlements;
  const application = entitlements?.['application-identifier'];
  const team = value.TeamIdentifier?.[0];
  if (typeof application !== 'string' || !application.includes('.') || typeof team !== 'string') throw new Error(`Invalid iOS profile: ${file.name}`);
  const id = application.slice(application.indexOf('.') + 1);
  // Exact IDs keep each extension's signing identity unambiguous.
  if (!/^[A-Za-z0-9.-]+$/.test(id)) throw new Error('Use profiles with explicit App IDs, not wildcard profiles.');
  if (entitlements['com.apple.developer.team-identifier'] !== team) throw new Error('Profile team identifiers do not match.');
  if (!Array.isArray(value.DeveloperCertificates) || !value.DeveloperCertificates.length) throw new Error('Profile contains no signing certificates.');
  const groups = entitlements['com.apple.security.application-groups'] ?? [];
  if (!Array.isArray(groups) || groups.some((group) => typeof group !== 'string' || !group.startsWith('group.') || group.includes('*'))) throw new Error('Invalid App Group entitlements.');
  return { id, team, groups, bytes, name: file.name, certificates: await Promise.all(value.DeveloperCertificates.map(digest)) };
}

export function selectProfiles(profiles) {
  const byID = new Map();
  for (const profile of profiles) {
    if (byID.has(profile.id)) throw new Error(`Select only one profile for ${profile.id}.`);
    byID.set(profile.id, profile);
  }
  const extensions = profiles.filter((profile) => profile.id.endsWith('.WeChatStickers'));
  if (extensions.length !== 1) throw new Error('Add one extension profile with App ID <WeChat App ID>.WeChatStickers.');
  const extension = extensions[0];
  const app = byID.get(extension.id.slice(0, -'.WeChatStickers'.length));
  if (!app) throw new Error(`Add the WeChat app profile for ${extension.id.slice(0, -'.WeChatStickers'.length)}.`);
  if (profiles.some((profile) => profile.team !== app.team)) throw new Error('All profiles must belong to the same signing team.');
  const group = app.groups.find((group) => extension.groups.includes(group));
  if (!group) throw new Error('WeChat and WeChatStickers profiles need the same App Group entitlement.');
  return { app, extension, group, byID };
}

export async function verifySigner(bytes, profiles) {
  for (const slice of inspectMachO(bytes)) {
    const slots = signatureSlots(slice.signature);
    const codeDirectory = slots.get(0);
    const signature = slots.get(0x10000);
    if (!codeDirectory || !signature) throw new Error('Signing did not produce a certificate signature.');
    const cms = signedData(signature.subarray(8));
    if (!await cms.verify({ signer: 0, data: buffer(codeDirectory), checkChain: false })) throw new Error('Generated code signature failed verification.');
    const sid = cms.signerInfos[0]?.sid;
    if (!(sid instanceof IssuerAndSerialNumber)) throw new Error('Unsupported signing certificate identifier.');
    const certificate = cms.certificates?.find((cert) => cert instanceof Certificate && cert.issuer.isEqual(sid.issuer) && cert.serialNumber.isEqual(sid.serialNumber));
    if (!certificate) throw new Error('Signing certificate is missing.');
    if (certificate.notBefore.value > new Date() || certificate.notAfter.value <= new Date()) throw new Error('Signing certificate is expired or not valid yet.');
    const fingerprint = await digest(new Uint8Array(certificate.toSchema().toBER(false)));
    for (const profile of profiles) {
      if (!profile.certificates.includes(fingerprint)) throw new Error(`The P12 certificate is not authorized by ${profile.name}.`);
    }
  }
}
