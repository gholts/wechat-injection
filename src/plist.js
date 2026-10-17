import { DOMParser } from '@xmldom/xmldom';
import { parse, build } from 'plist';

globalThis.DOMParser ??= DOMParser;
const decoder = new TextDecoder();
export const encode = (text) => new TextEncoder().encode(text);

export function readPlist(bytes) {
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('Invalid or oversized property list.');
  const value = parse(decoder.decode(bytes.subarray(0, 6)) === 'bplist' ? bytes : decoder.decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a property-list dictionary.');
  return value;
}

export const writePlist = (value) => encode(build(value));
