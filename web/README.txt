Browser-only WeChat Stickers IPA builder. No signing server or credential storage.

Local preview (Mac + Xcode + Node 24):
  make WeChatStickers
  python3 web/scripts/prepare-payload.py
  npm ci --ignore-scripts --prefix web
  npm run build --prefix web
  npm run preview --prefix web

Use a decrypted IPA, P12, optional password, and explicit provisioning profiles.
Profiles must share a signing team; WeChat + <WeChat ID>.WeChatStickers need
the same App Group. Existing extensions are preserved and need profiles too.
App Group is automatic when there is one shared group; otherwise enter the one to use.
The page checks CMS signatures, expiry, certificate membership and App IDs.
It does not establish Apple's certificate trust or revocation status.
Desktop browsers recommended. Expanded IPAs limited to 3 GB; no symlinks.

Tests use disposable certificates, never real credentials:
  python3 web/test/create-fixtures.py
  npm test --prefix web
  cd web && npx playwright install chromium && npm run test:browser

GitHub Pages: select GitHub Actions as the Pages source. The Browser IPA builder
workflow builds native payloads, tests the page, and deploys this branch.
Only public build files reach GitHub; users' IPA and signing files stay local.

Signer provenance and licenses: public/vendor/PROVENANCE.txt and public/licenses.txt.
