// SPDX-License-Identifier: Apache-2.0
#import "Runtime.h"
#import "StickerImage.h"
#import "Store.h"
#import <dlfcn.h>
#import <stdatomic.h>

static id (*originalFavorites)(id, SEL);
static void (*originalClear)(id, SEL);
static dispatch_queue_t exportQueue;
static atomic_uint_fast64_t revision;

static BOOL WCSMatches(Method method, const char *types) {
    if (!method) return NO;
    NSMethodSignature *actual = [NSMethodSignature signatureWithObjCTypes:method_getTypeEncoding(method)];
    NSMethodSignature *expected = [NSMethodSignature signatureWithObjCTypes:types];
    if (actual.numberOfArguments != expected.numberOfArguments || strcmp(actual.methodReturnType, expected.methodReturnType)) return NO;
    for (NSUInteger i = 0; i < actual.numberOfArguments; i++) {
        if (strcmp([actual getArgumentTypeAtIndex:i], [expected getArgumentTypeAtIndex:i])) return NO;
    }
    return YES;
}

static id WCSValue(id object, const char *name) {
    SEL selector = sel_registerName(name);
    return WCSMatches(class_getInstanceMethod(object_getClass(object), selector), "@@:") ? WCMessage0(object, name) : nil;
}

static void WCSExport(NSArray<NSDictionary *> *favorites, uint_fast64_t version) {
    dispatch_async(exportQueue, ^{
        @autoreleasepool {
            if (version != atomic_load(&revision)) return;
            NSURL *directory = WCSStoreDirectory();
            NSFileManager *files = NSFileManager.defaultManager;
            if (!directory || ![files createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:nil]) return;
            NSMutableArray *names = [NSMutableArray array];
            for (NSDictionary *favorite in favorites) {
                @autoreleasepool {
                    if (version != atomic_load(&revision)) return;
                    NSString *identifier = favorite[@"md5"];
                    NSString *cached = nil;
                    for (NSString *ext in @[@"png", @"gif", @"jpg"]) {
                        NSString *name = [identifier stringByAppendingPathExtension:ext];
                        if ([files fileExistsAtPath:[directory URLByAppendingPathComponent:name].path]) {
                            cached = name;
                            break;
                        }
                    }
                    if (cached) {
                        [names addObject:cached];
                        continue;
                    }
                    if ([[files attributesOfItemAtPath:favorite[@"path"] error:nil] fileSize] > WCSMaximumSourceBytes) continue;
                    // Own the bytes: WeChat may replace or truncate its cache while exporting.
                    __block NSData *data = [NSData dataWithContentsOfFile:favorite[@"path"]];
                    if (!data.length || data.length > WCSMaximumSourceBytes) continue;
                    // WxAM decoding remains in WeChat. Do not assume its private API is thread-safe.
                    if (data.length >= 4 && !memcmp(data.bytes, "wxgf", 4)) {
                        dispatch_sync(dispatch_get_main_queue(), ^{
                            if (version != atomic_load(&revision)) {
                                data = nil;
                                return;
                            }
                            Class util = NSClassFromString(@"EmoticonUtil");
                            SEL decode = sel_registerName("createGifFromWxAMData:");
                            id decoded = WCSMatches(class_getClassMethod(util, decode), "@@:@") ? WCMessage1(util, "createGifFromWxAMData:", data) : nil;
                            data = [decoded isKindOfClass:NSData.class] ? decoded : nil;
                        });
                    }
                    NSString *extension = nil;
                    NSData *converted = WCSStickerData(data, &extension);
                    if (!converted || version != atomic_load(&revision)) continue;
                    NSString *name = [identifier stringByAppendingPathExtension:extension];
                    if ([converted writeToURL:[directory URLByAppendingPathComponent:name] options:NSDataWritingAtomic error:nil]) [names addObject:name];
                }
            }
            if (version != atomic_load(&revision)) return;
            // Immutable sticker files + atomic index replacement keep readers consistent.
            NSDictionary *index = @{@"files": names,
                                    @"skipped": @(favorites.count - names.count)};
            if (![index writeToURL:[directory URLByAppendingPathComponent:@"index.plist"] atomically:YES])
                NSLog(@"[WeChatStickers] Cannot publish sticker index");
        }
    });
}

static id WCSFavorites(id self, SEL command) {
    uint_fast64_t version = atomic_load(&revision);
    id list = originalFavorites(self, command);
    // Observe the real read. Never initialize services or ask WeChat to read the list again.
    if (![NSThread isMainThread] || ![list isKindOfClass:NSArray.class]) return list;
    Class util = NSClassFromString(@"EmoticonUtil");
    SEL pathSelector = sel_registerName("pathOfEmoticonForMd5:needUpdateTime:ignoreWxAM:");
    NSMutableArray *favorites = [NSMutableArray array];
    NSCharacterSet *invalid = [NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"].invertedSet;
    for (id item in list) {
        id md5 = [item isKindOfClass:NSString.class] ? item : WCSValue(WCSValue(item, "m_emojiInfo"), "md5");
        // A changed private model must not silently publish a partial or empty collection.
        if (![md5 isKindOfClass:NSString.class] || [md5 length] != 32 || [md5 rangeOfCharacterFromSet:invalid].location != NSNotFound) return list;
        id path = ((id(*)(id, SEL, id, BOOL, BOOL))objc_msgSend)(util, pathSelector, md5, NO, NO);
        [favorites addObject:@{@"md5": [md5 lowercaseString], @"path": [path isKindOfClass:NSString.class] ? [path copy] : @""}];
    }
    // A newer read or logout wins, including one that overlapped the original getter.
    uint_fast64_t next = version + 1;
    if (atomic_compare_exchange_strong(&revision, &version, next)) WCSExport(favorites, next);
    return list;
}

static void WCSClear(id self, SEL command) {
    originalClear(self, command);
    uint_fast64_t version = atomic_fetch_add(&revision, 1) + 1;
    WCSExport(@[], version);
}

__attribute__((constructor)) static void WCSInstall(void) {
    @autoreleasepool {
        if (![NSBundle.mainBundle.bundlePath.pathExtension isEqualToString:@"app"] || !WCSStoreDirectory()) return;
        WCHookMessage hook = (WCHookMessage)dlsym(RTLD_DEFAULT, "MSHookMessageEx");
        Class manager = NSClassFromString(@"CEmoticonMgr");
        SEL favorites = sel_registerName("getCustomEmoticonListWithOutGame");
        SEL clear = sel_registerName("onServiceClearData");
        Method path = class_getClassMethod(NSClassFromString(@"EmoticonUtil"), sel_registerName("pathOfEmoticonForMd5:needUpdateTime:ignoreWxAM:"));
        if (!hook || !WCSMatches(class_getInstanceMethod(manager, favorites), "@@:") ||
            !WCSMatches(class_getInstanceMethod(manager, clear), "v@:") || !WCSMatches(path, "@@:@BB")) {
            NSLog(@"[WeChatStickers] Unsupported runtime; no hooks installed");
            return;
        }
        exportQueue = dispatch_queue_create("dev.gholts.dylib.WeChatStickers.export", DISPATCH_QUEUE_SERIAL);
        hook(manager, clear, (IMP)WCSClear, (IMP *)&originalClear);
        hook(manager, favorites, (IMP)WCSFavorites, (IMP *)&originalFavorites);
    }
}
