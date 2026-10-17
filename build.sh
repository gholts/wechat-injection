#!/bin/sh
set -eu

cd "$(dirname "$0")"
case "${1:-all}" in
  all|WeChatFocused) ;;
  *) echo "Usage: $0 [WeChatFocused]" >&2; exit 1 ;;
esac
SDK=$(xcrun --sdk iphoneos --show-sdk-path)
ROOT=$PWD
export SDK ROOT
if [ "${1:-all}" = all ]; then
  sh dylibs/WeChatFocused/build.sh
else
  sh "dylibs/$1/build.sh"
fi
