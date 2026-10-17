WeChat Stickers IPA builder. Runs in your browser; files stay local.

Use a decrypted IPA, P12 (password optional), and explicit profiles for WeChat,
<WeChat ID>.WeChatStickers, and existing extensions. Use the same team and
certificate. WeChat and WeChatStickers must share an App Group.

Local preview (Node 24):
  npm ci --ignore-scripts
  npm run build
  npm run preview

Deploy: Settings > Pages > Source = GitHub Actions.
Push to builder; the workflow builds and publishes dist/.

Desktop recommended. arm64 iOS only; max 3 GB expanded; no symlinks.
Apple certificate trust and revocation are not checked.

Prebuilt files and source details: public/payload/ and public/vendor/.
Licenses: public/licenses.txt.
