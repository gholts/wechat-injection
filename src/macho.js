const text = new TextDecoder();

// Read load commands only. zsign owns all binary modifications and signing.
export function inspectMachO(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bound = (start, size) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size < 0 || start + size > bytes.length) throw new Error('Malformed Mach-O binary.');
  };
  bound(0, 8);
  const magic = view.getUint32(0);
  let ranges = [[0, bytes.length]];
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const wide = magic === 0xcafebabf;
    const count = view.getUint32(4);
    if (!count || count > 32) throw new Error('Invalid universal binary.');
    bound(8, count * (wide ? 32 : 20));
    ranges = Array.from({ length: count }, (_, i) => {
      const entry = 8 + i * (wide ? 32 : 20);
      return wide ? [Number(view.getBigUint64(entry + 8)), Number(view.getBigUint64(entry + 16))] : [view.getUint32(entry + 8), view.getUint32(entry + 12)];
    });
  }
  return ranges.map(([offset, length]) => {
    bound(offset, length);
    bound(offset, 28);
    const magic = view.getUint32(offset, true);
    if (magic !== 0xfeedfacf && magic !== 0xfeedface) throw new Error('Unsupported Mach-O architecture.');
    let cursor = offset + (magic === 0xfeedfacf ? 32 : 28);
    const end = cursor + view.getUint32(offset + 20, true);
    if (end > offset + length) throw new Error('Invalid Mach-O load commands.');
    const result = { cpuType: view.getUint32(offset + 4, true), encrypted: false, libraries: [], signature: null, offset, length };
    for (let i = 0; i < view.getUint32(offset + 16, true); i++) {
      bound(cursor, 8);
      const command = view.getUint32(cursor, true);
      const size = view.getUint32(cursor + 4, true);
      if (size < 8 || cursor + size > end) throw new Error('Invalid Mach-O load command.');
      if (command === 0x21 || command === 0x2c) {
        if (size < 20) throw new Error('Invalid encryption command.');
        result.encrypted ||= view.getUint32(cursor + 16, true) !== 0;
      }
      if ([0xc, 0x80000018, 0x8000001f, 0x80000023].includes(command)) {
        if (size < 24) throw new Error('Invalid library command.');
        const start = cursor + view.getUint32(cursor + 8, true);
        if (start < cursor + 24 || start >= cursor + size) throw new Error('Invalid library path.');
        const name = bytes.subarray(start, cursor + size);
        const zero = name.indexOf(0);
        if (zero < 0) throw new Error('Invalid library path.');
        result.libraries.push(text.decode(name.subarray(0, zero)));
      }
      if (command === 0x1d) {
        if (size < 16) throw new Error('Invalid signature command.');
        const start = offset + view.getUint32(cursor + 8, true);
        const count = view.getUint32(cursor + 12, true);
        bound(start, count);
        if (start + count > offset + length) throw new Error('Invalid signature bounds.');
        result.signature = bytes.subarray(start, start + count);
      }
      cursor += size;
    }
    if (cursor !== end) throw new Error('Invalid Mach-O command count.');
    return result;
  });
}

export function signatureSlots(signature) {
  if (!signature || signature.length < 12) throw new Error('Missing code signature.');
  const view = new DataView(signature.buffer, signature.byteOffset, signature.byteLength);
  const length = view.getUint32(4);
  const count = view.getUint32(8);
  if (view.getUint32(0) !== 0xfade0cc0 || length > signature.length || count > 64 || 12 + count * 8 > length) throw new Error('Malformed code signature.');
  const slots = new Map();
  for (let i = 0; i < count; i++) {
    const type = view.getUint32(12 + i * 8);
    const start = view.getUint32(16 + i * 8);
    if (start + 8 > length) throw new Error('Malformed signature slot.');
    const size = view.getUint32(start + 4);
    if (size < 8 || start + size > length) throw new Error('Malformed signature slot.');
    slots.set(type, signature.subarray(start, start + size));
  }
  return slots;
}
