#!/bin/sh
set -eu

OUTPUT="$ROOT/build/WeChatStickers"
NAME=dev.gholts.dylib.WeChatStickers
APP_GROUP_ID=${APP_GROUP_ID:-group.dev.gholts.WeChatStickers}
WECHAT_BUNDLE_ID=${WECHAT_BUNDLE_ID:-com.tencent.xin}
for identifier in "$APP_GROUP_ID" "$WECHAT_BUNDLE_ID"; do
  case "$identifier" in
    ''|*[!a-zA-Z0-9.-]*) echo "Invalid identifier: $identifier" >&2; exit 1 ;;
  esac
done
case "$APP_GROUP_ID" in
  group.?*) ;;
  *) echo 'APP_GROUP_ID must start with group.' >&2; exit 1 ;;
esac
SOURCE="$ROOT/dylibs/WeChatStickers"
EXTENSION="$OUTPUT/WeChatStickers.appex"
# Never leave a previous package looking current after a failed build.
rm -f "$OUTPUT/WeChatStickers.appex.tar.gz" "$OUTPUT/$NAME.dylib"
rm -rf "$EXTENSION"
mkdir -p "$EXTENSION"

xcrun --sdk iphoneos clang \
  -arch arm64 -arch arm64e -miphoneos-version-min=14.0 -fobjc-arc \
  -Wall -Wextra -Werror -fvisibility=hidden -dynamiclib \
  -install_name "@rpath/$NAME.dylib" -isysroot "$SDK" \
  -I "$ROOT/shared" -I "$SOURCE" "-DWCS_APP_GROUP=@\"$APP_GROUP_ID\"" \
  -framework Foundation -framework UIKit -framework ImageIO -framework CoreGraphics \
  -o "$OUTPUT/$NAME.dylib" "$SOURCE"/src/*.m

xcrun --sdk iphoneos clang \
  -arch arm64 -miphoneos-version-min=14.0 -fobjc-arc \
  -Wall -Wextra -Werror -fapplication-extension \
  -isysroot "$SDK" -I "$SOURCE" "-DWCS_APP_GROUP=@\"$APP_GROUP_ID\"" \
  -framework Foundation -framework UIKit -framework Messages -framework CoreGraphics \
  -e _NSExtensionMain -o "$EXTENSION/WeChatStickers" "$SOURCE"/extension/*.m

cp "$SOURCE/extension/Info.plist" "$EXTENSION/Info.plist"
xcrun actool "$SOURCE/extension/Assets.xcassets" \
  --compile "$EXTENSION" --platform iphoneos --minimum-deployment-target 14.0 \
  --target-device iphone --target-device ipad --app-icon 'iMessage App Icon' \
  --output-partial-info-plist "$OUTPUT/IconInfo.plist" --output-format human-readable-text
(cd "$OUTPUT" && /usr/libexec/PlistBuddy -c 'Merge IconInfo.plist' WeChatStickers.appex/Info.plist)
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $WECHAT_BUNDLE_ID.WeChatStickers" "$EXTENSION/Info.plist"
cat > "$OUTPUT/AppGroup.entitlements" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.application-groups</key>
  <array><string>$APP_GROUP_ID</string></array>
</dict></plist>
EOF
plutil -lint "$EXTENSION/Info.plist" "$OUTPUT/AppGroup.entitlements"
# Archive preserves executable permissions when downloaded from CI artifacts.
COPYFILE_DISABLE=1 tar -czf "$OUTPUT/WeChatStickers.appex.tar.gz" -C "$OUTPUT" WeChatStickers.appex
