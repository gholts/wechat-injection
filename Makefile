SOURCES := $(shell find dylibs shared -name '*.h' -o -name '*.m')

.PHONY: build WeChatFocused format lint

build:
	./build.sh

WeChatFocused:
	./build.sh $@

format:
	xcrun clang-format -i $(SOURCES)

lint:
	xcrun clang-format --dry-run --Werror $(SOURCES)
	./build.sh
