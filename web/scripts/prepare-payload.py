#!/usr/bin/env python3
"""Package already-built native artifacts for the static site. No signing keys."""
import hashlib
import json
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[2]
source = root / 'build/WeChatStickers'
target = root / 'web/public/payload'
dylib = 'dev.gholts.dylib.WeChatStickers.dylib'
extension = 'WeChatStickers.appex'
if not (source / dylib).is_file() or not (source / extension / 'WeChatStickers').is_file():
    raise SystemExit('Run make WeChatStickers first.')
if target.exists():
    shutil.rmtree(target)
target.mkdir(parents=True)
shutil.copy2(source / dylib, target / dylib)
shutil.copytree(source / extension, target / extension)
files = []
for path in sorted(target.rglob('*')):
    if path.is_file():
        data = path.read_bytes()
        files.append({'path': path.relative_to(target).as_posix(), 'size': len(data),
                      'sha256': hashlib.sha256(data).hexdigest(), 'mode': path.stat().st_mode & 0o777})
(target / 'manifest.json').write_text(json.dumps({'format': 1, 'files': files}, indent=2) + '\n')
print(f'Prepared {len(files)} native payload files.')
