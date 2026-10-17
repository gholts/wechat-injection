#!/bin/sh
set -eu

OUTPUT="$ROOT/build/WeChatFocused"
NAME=dev.gholts.dylib.WeChatFocused
mkdir -p "$OUTPUT"
xcrun --sdk iphoneos clang \
  -arch arm64e -miphoneos-version-min=14.0 -fobjc-arc \
  -Wall -Wextra -Werror -fvisibility=hidden -dynamiclib \
  -install_name "@rpath/$NAME.dylib" -isysroot "$SDK" -I "$ROOT/shared" \
  -framework Foundation -framework UIKit -framework Photos \
  -framework ImageIO -framework CoreGraphics -framework AVFoundation \
  -weak_framework PhotosUI -weak_framework UniformTypeIdentifiers \
  -o "$OUTPUT/$NAME.dylib" "$ROOT"/dylibs/WeChatFocused/src/*.m
