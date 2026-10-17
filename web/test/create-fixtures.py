#!/usr/bin/env python3
"""Generate disposable signing identities and a tiny IPA. Never use real credentials."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import plistlib
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
out = root / 'test-results/fixtures'
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True, exist_ok=True)

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# zsign recognizes this issuer name. This CA has a random test key, so these
# credentials are NOT Apple-issued and can never authorize an iOS installation.
run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(out/'ca-key.pem'),
    '-out', str(out/'ca.pem'), '-days', '7', '-subj', '/CN=Apple Worldwide Developer Relations Certification Authority/OU=G3/O=Apple Inc./C=US')
run('openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(out/'key.pem'),
    '-out', str(out/'cert.csr'), '-subj', '/CN=Browser Signing Fixture/OU=TESTTEAM01/O=Local Tests/C=US')
run('openssl', 'x509', '-req', '-in', str(out/'cert.csr'), '-CA', str(out/'ca.pem'), '-CAkey', str(out/'ca-key.pem'),
    '-CAcreateserial', '-out', str(out/'cert.pem'), '-days', '7')
run('openssl', 'x509', '-in', str(out/'cert.pem'), '-outform', 'DER', '-out', str(out/'cert.der'))
for name, password in [('identity.p12', 'fixture-password'), ('unprotected.p12', '')]:
    run('openssl', 'pkcs12', '-export', '-inkey', str(out/'key.pem'), '-in', str(out/'cert.pem'),
        '-out', str(out/name), '-passout', 'pass:'+password)

now = datetime.now(timezone.utc).replace(tzinfo=None)
for name, bundle, groups, expiration in [
    ('app', 'dev.test.WeChat', ['group.dev.test.stickers'], now+timedelta(days=7)),
    ('extension', 'dev.test.WeChat.WeChatStickers', ['group.dev.test.stickers'], now+timedelta(days=7)),
    ('app-multi', 'dev.test.WeChat', ['group.dev.test.stickers', 'group.9a96c46eb073c04a.5'], now+timedelta(days=7)),
    ('extension-multi', 'dev.test.WeChat.WeChatStickers', ['group.dev.test.stickers', 'group.9a96c46eb073c04a.5'], now+timedelta(days=7)),
    ('share', 'dev.test.WeChat.Share', [], now+timedelta(days=7)),
    ('wrong-group', 'dev.test.WeChat.WeChatStickers', ['group.other'], now+timedelta(days=7)),
    ('expired', 'dev.test.WeChat.WeChatStickers', ['group.dev.test.stickers'], now-timedelta(days=1)),
]:
    value = {'Name': name, 'UUID': name, 'TeamIdentifier': ['TESTTEAM01'], 'ApplicationIdentifierPrefix': ['TESTTEAM01'],
             'CreationDate': now-timedelta(days=2), 'ExpirationDate': expiration, 'Platform': ['iOS'],
             'DeveloperCertificates': [(out/'cert.der').read_bytes()], 'ProvisionsAllDevices': True,
             'Entitlements': {'application-identifier': 'TESTTEAM01.'+bundle,
                              'com.apple.developer.team-identifier': 'TESTTEAM01', 'get-task-allow': False,
                              'com.apple.security.application-groups': groups}}
    (out/(name+'.plist')).write_bytes(plistlib.dumps(value))
    run('openssl', 'cms', '-sign', '-binary', '-nodetach', '-in', str(out/(name+'.plist')), '-signer', str(out/'cert.pem'),
        '-inkey', str(out/'key.pem'), '-outform', 'DER', '-out', str(out/(name+'.mobileprovision')))

app = out/'input/Payload/WeChat.app'
app.mkdir(parents=True, exist_ok=True)
(out/'main.c').write_text('int main(void) { return 0; }\n')
sdk = subprocess.check_output(['xcrun','--sdk','iphoneos','--show-sdk-path'], text=True).strip()
run('xcrun','--sdk','iphoneos','clang','-arch','arm64','-isysroot',sdk,'-miphoneos-version-min=14.0',
    '-Wl,-headerpad_max_install_names', str(out/'main.c'), '-o', str(app/'WeChat'))
info = {'CFBundleIdentifier': 'com.tencent.xin', 'CFBundleExecutable': 'WeChat', 'CFBundleName':'WeChat',
        'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '8.0.55', 'CFBundleVersion':'808055',
        'MinimumOSVersion': '14.0', 'UIDeviceFamily':[1,2]}
# Exercise binary plist input, not just XML.
(app/'Info.plist').write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
with zipfile.ZipFile(out/'wechat.ipa','w',zipfile.ZIP_DEFLATED) as archive:
    for path in app.rglob('*'):
        if path.is_file(): archive.write(path,path.relative_to(out/'input'))
share = app/'PlugIns/Share.appex'
share.mkdir(parents=True, exist_ok=True)
(share/'Share').write_bytes((app/'WeChat').read_bytes())
(share/'Share').chmod(0o755)
(share/'Info.plist').write_bytes(plistlib.dumps({**info,'CFBundleIdentifier':'com.tencent.xin.Share','CFBundleExecutable':'Share','CFBundlePackageType':'XPC!'}))
with zipfile.ZipFile(out/'wechat-with-share.ipa','w',zipfile.ZIP_DEFLATED) as archive:
    for path in app.rglob('*'):
        if path.is_file(): archive.write(path,path.relative_to(out/'input'))
print('Generated disposable test fixtures.')
