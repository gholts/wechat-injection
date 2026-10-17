WeChat dylibs

WeChatFocused: Moments tab + native Photos picker.
WeChatStickers: WeChat favorite stickers in iMessage.

Build (Mac + Xcode)

  make build          Build both packages.
  make WeChatFocused  Build only WeChatFocused.
  make WeChatStickers Build only WeChatStickers.
  make format         Format source.
  make lint           Check formatting and compile.

Output: build/<name>/dev.gholts.dylib.<name>.dylib
Inject into WeChat using Feather: path @executable_path, folder /Frameworks/,
extension injection off. Both dylibs require MSHookMessageEx.

Stickers setup

Dylib injection alone is insufficient. Use your registered App Group and signed
WeChat bundle ID (replace the example values):

  APP_GROUP_ID=group.your.id WECHAT_BUNDLE_ID=your.wechat.id make WeChatStickers

1. Embed build/WeChatStickers/WeChatStickers.appex in WeChat.app/PlugIns/.
   For CI downloads, extract WeChatStickers.appex.tar.gz first.
2. Merge AppGroup.entitlements into both app and extension entitlements.
   Both provisioning profiles must support that group. Keep other entitlements.
3. Match the extension's version/build to WeChat. Sign the dylib, extension, and app;
   preserve the extension when installing.

Open WeChat's heart tab, then reopen WeChat Stickers in Messages to sync.
Device compatibility and account safety are not guaranteed.

Code: Apache-2.0. WeChat icon artwork is excluded from this license.
Icon source: https://apps.apple.com/us/app/wechat/id414478124
