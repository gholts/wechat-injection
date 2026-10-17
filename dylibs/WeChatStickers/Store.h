// SPDX-License-Identifier: Apache-2.0
#pragma once
#import <Foundation/Foundation.h>

#ifndef WCS_APP_GROUP
#define WCS_APP_GROUP @"group.dev.gholts.WeChatStickers"
#endif

static inline NSURL *WCSStoreDirectory(void) {
    id configured = [NSBundle.mainBundle objectForInfoDictionaryKey:@"WeChatStickersAppGroup"];
    NSString *identifier = [configured isKindOfClass:NSString.class] && [configured hasPrefix:@"group."] ? configured : WCS_APP_GROUP;
    NSURL *group = [NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:identifier];
    return [group URLByAppendingPathComponent:@"WeChatStickers" isDirectory:YES];
}
