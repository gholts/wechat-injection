Browser-only WeChat Stickers IPA builder. No signing server or credential storage.

Local preview (Node 24):
  npm ci --ignore-scripts
  npm run build
  npm run preview

This branch contains only the web project. Required prebuilt sticker files live in
public/payload/; their source revision and hashes are included. No Xcode required.

Use a decrypted IPA, P12, optional password, and explicit provisioning profiles.
Profiles must share a signing team; WeChat + <WeChat ID>.WeChatStickers need
the same App Group. Existing extensions are preserved and need profiles too.
App Group is automatic when there is one shared group; otherwise enter the one to use.
The page checks CMS signatures, expiry, certificate membership and App IDs.
It does not establish Apple's certificate trust or revocation status.
Desktop browsers recommended. Expanded IPAs limited to 3 GB; no symlinks.

Tests use disposable certificates, never real credentials:
  python3 test/create-fixtures.py
  npm test
  npx playwright install chromium && npm run test:browser

GitHub Pages: select GitHub Actions as the Pages source. The Browser IPA builder
workflow tests the page, builds it, and deploys this branch.
Only public build files reach GitHub; users' IPA and signing files stay local.

Signer provenance and licenses: public/vendor/PROVENANCE.txt and public/licenses.txt.
