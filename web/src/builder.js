import { readPlist, writePlist } from './plist.js';
import { readProfile, selectProfiles, verifySigner, digest } from './profiles.js';
import { inspectMachO, signatureSlots } from './macho.js';
import { extractIPA, filesUnder, safePath } from './archive.js';

const DYLIB = 'dev.gholts.dylib.WeChatStickers.dylib';
const EXTENSION = 'WeChatStickers.appex';

function runSigner(module, args, errors) {
  errors.length = 0;
  const code = module.callMain(args);
  if (errors.some((line) => /Unknown issuer hash/i.test(line))) throw new Error('Unsupported certificate issuer. Use an Apple Development or Distribution P12.');
  if (code !== 0) {
    if (errors.some((line) => /password|p12|private key|mac verify/i.test(line))) throw new Error('Cannot unlock the P12. Check the certificate and password.');
    throw new Error('Signing failed. Check the certificate, profiles, and decrypted IPA.');
  }
}

async function payload(FS, base) {
  const response = await fetch(new URL('payload/manifest.json', base), { credentials: 'omit' });
  if (!response.ok) throw new Error('Sticker build files are unavailable. Rebuild the website payload.');
  const manifest = await response.json();
  if (manifest.format !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported sticker payload.');
  for (const file of manifest.files) {
    const path = safePath(file.path);
    if (path !== DYLIB && !path.startsWith(`${EXTENSION}/`)) throw new Error('Unexpected sticker payload path.');
    const download = await fetch(new URL(`payload/${path}`, base), { credentials: 'omit' });
    if (!download.ok) throw new Error('Could not load the sticker payload.');
    const bytes = new Uint8Array(await download.arrayBuffer());
    if (bytes.length !== file.size || await digest(bytes) !== file.sha256) throw new Error('Sticker payload integrity check failed. Reload the page.');
    const target = `/payload/${path}`;
    FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
    FS.writeFile(target, bytes, { canOwn: true });
    FS.chmod(target, file.mode);
  }
  if (!FS.analyzePath(`/payload/${DYLIB}`).exists || !FS.analyzePath(`/payload/${EXTENSION}/Info.plist`).exists) throw new Error('Incomplete sticker payload.');
}

function copyTree(FS, from, to) {
  FS.mkdirTree(to);
  for (const path of filesUnder(FS, from)) {
    const destination = to + path.slice(from.length);
    FS.mkdirTree(destination.slice(0, destination.lastIndexOf('/')));
    FS.writeFile(destination, FS.readFile(path), { canOwn: true });
    FS.chmod(destination, FS.stat(path).mode & 0o777);
  }
}

export async function buildIPA({ ipa, certificate, password, provisionFiles, base }, progress) {
  if (!ipa?.size || !certificate?.size || !provisionFiles?.length) throw new Error('Select an IPA, a P12, and provisioning profiles.');
  if (certificate.size > 4 * 1024 * 1024) throw new Error('P12 files must be smaller than 4 MB.');
  progress('Checking provisioning profiles…');
  const profiles = await Promise.all(provisionFiles.map(readProfile));
  const plan = selectProfiles(profiles);
  const errors = [];
  progress('Loading local signing tools…');
  const { default: createModule } = await import(/* @vite-ignore */ new URL('vendor/zsign.mjs', base).href);
  const module = await createModule({
    noInitialRun: true,
    locateFile: (file) => new URL(`vendor/${file}`, base).href,
    print: (line) => { if (/error|fail|can't|password/i.test(line)) errors.push(line); },
    printErr: (line) => { errors.push(line); },
  });
  const FS = module.FS;
  for (const dir of ['/credentials', '/payload', '/work/ipa', '/output', '/tmp']) FS.mkdirTree(dir);
  FS.chdir('/work');
  try {
    FS.writeFile('/credentials/certificate.p12', new Uint8Array(await certificate.arrayBuffer()), { canOwn: true });
    // Root profile must be first: zsign uses it to initialize the containing app.
    const ordered = [plan.app, ...profiles.filter((profile) => profile !== plan.app)];
    ordered.forEach((profile, index) => FS.writeFile(`/credentials/${index}.mobileprovision`, profile.bytes));
    await payload(FS, base);
    const signing = ['-f', '-k', '/credentials/certificate.p12', '-p', password];
    progress('Checking the signing certificate…');
    runSigner(module, [...signing, '-m', '/credentials/0.mobileprovision', `/payload/${DYLIB}`], errors);
    await verifySigner(FS.readFile(`/payload/${DYLIB}`), profiles);

    const appPath = await extractIPA(ipa, FS, progress);
    const mainPath = `${appPath}/Info.plist`;
    const mainInfo = readPlist(FS.readFile(mainPath));
    const oldID = mainInfo.CFBundleIdentifier;
    if (typeof oldID !== 'string' || !/^[A-Za-z0-9.-]+$/.test(oldID)) throw new Error('IPA has an invalid bundle identifier.');
    if (typeof mainInfo.CFBundleVersion !== 'string' || typeof mainInfo.CFBundleShortVersionString !== 'string') throw new Error('IPA is missing its version or build number.');
    const extensionPath = `${appPath}/PlugIns/${EXTENSION}`;
    // Existing copies are rejected, avoiding two differently located copies being loaded.
    if (FS.analyzePath(extensionPath).exists) throw new Error('This IPA already contains WeChatStickers. Start with the original decrypted IPA.');
    progress('Adding WeChat Stickers…');
    copyTree(FS, `/payload/${EXTENSION}`, extensionPath);
    const extensionInfo = readPlist(FS.readFile(`${extensionPath}/Info.plist`));
    extensionInfo.CFBundleIdentifier = plan.extension.id;
    extensionInfo.CFBundleShortVersionString = mainInfo.CFBundleShortVersionString;
    extensionInfo.CFBundleVersion = mainInfo.CFBundleVersion;
    extensionInfo.WeChatStickersAppGroup = plan.group;
    FS.writeFile(`${extensionPath}/Info.plist`, writePlist(extensionInfo));
    mainInfo.CFBundleIdentifier = plan.app.id;
    mainInfo.WeChatStickersAppGroup = plan.group;
    if (!mainInfo.MinimumOSVersion || Number.parseInt(mainInfo.MinimumOSVersion, 10) < 14) mainInfo.MinimumOSVersion = '14.0';
    FS.writeFile(mainPath, writePlist(mainInfo));

    const bundles = [];
    for (const path of filesUnder(FS, appPath).filter((path) => /\.(app|appex)\/Info\.plist$/.test(path))) {
      const info = readPlist(FS.readFile(path));
      if (path !== mainPath && !path.startsWith(`${extensionPath}/`) && info.CFBundleIdentifier?.startsWith(`${oldID}.`)) info.CFBundleIdentifier = plan.app.id + info.CFBundleIdentifier.slice(oldID.length);
      if (info.WKCompanionAppBundleIdentifier === oldID) info.WKCompanionAppBundleIdentifier = plan.app.id;
      const profile = plan.byID.get(info.CFBundleIdentifier);
      if (!profile) throw new Error(`Add a provisioning profile for the existing extension ${info.CFBundleIdentifier}.`);
      const executable = info.CFBundleExecutable;
      if (typeof executable !== 'string' || !executable || executable.includes('/') || executable === '..' || executable.includes('\\')) throw new Error('Invalid bundle executable name.');
      const folder = path.slice(0, -'/Info.plist'.length);
      const binary = `${folder}/${executable}`;
      const slices = inspectMachO(FS.readFile(binary));
      if (slices.some((slice) => slice.encrypted)) throw new Error('IPA contains encrypted App Store code. Select a decrypted WeChat IPA.');
      if (slices.some((slice) => slice.libraries.some((name) => name.endsWith(`/${DYLIB}`)))) throw new Error('WeChatStickers is already injected. Start with the original decrypted IPA.');
      FS.chmod(binary, 0o755);
      FS.writeFile(path, writePlist(info));
      // Embed the correct profile before zsign hashes bundle resources.
      FS.writeFile(`${folder}/embedded.mobileprovision`, profile.bytes);
      bundles.push({ binary, profile, main: path === mainPath });
    }
    progress('Signing the app and extensions…');
    const args = [...signing];
    ordered.forEach((_, index) => args.push('-m', `/credentials/${index}.mobileprovision`));
    args.push('-l', `/payload/${DYLIB}`, '-z', '1', '-o', '/output/WeChatStickers.ipa', appPath);
    runSigner(module, args, errors);
    progress('Verifying signed bundles…');
    for (const bundle of bundles) {
      const bytes = FS.readFile(bundle.binary);
      await verifySigner(bytes, [bundle.profile]);
      for (const slice of inspectMachO(bytes)) {
        const entitlements = signatureSlots(slice.signature).get(5);
        if (!entitlements) throw new Error('Signed bundle is missing entitlements.');
        const values = readPlist(entitlements.subarray(8));
        if (!values['application-identifier']?.endsWith(`.${bundle.profile.id}`)) throw new Error('Signed bundle has the wrong App ID.');
        if ((bundle.main || bundle.profile === plan.extension) && !values['com.apple.security.application-groups']?.includes(plan.group)) throw new Error('Signed bundle is missing the shared App Group.');
        if (bundle.main && !slice.libraries.includes(`@executable_path/${DYLIB}`)) throw new Error('Dylib injection failed: the IPA has no room for the load command.');
      }
    }
    const output = FS.analyzePath('/output/WeChatStickers.ipa').object;
    if (!output?.usedBytes) throw new Error('Signing did not produce an IPA.');
    return new Blob([output.contents.subarray(0, output.usedBytes)], { type: 'application/octet-stream' });
  } finally {
    // No persistent filesystem is mounted. The worker is destroyed after each job.
    password = '';
    for (const name of FS.readdir('/credentials')) if (name !== '.' && name !== '..') FS.unlink(`/credentials/${name}`);
  }
}
