SOURCES := $(shell find dylibs shared -name '*.h' -o -name '*.m')

.PHONY: build WeChatFocused WeChatStickers format lint

build:
	./build.sh

WeChatFocused WeChatStickers:
	./build.sh $@

format:
	xcrun clang-format -i $(SOURCES)

lint:
	xcrun clang-format --dry-run --Werror $(SOURCES)
	./build.sh
