// SPDX-License-Identifier: Apache-2.0
#pragma once
#import <Foundation/Foundation.h>

#ifndef WCS_APP_GROUP
#define WCS_APP_GROUP @"group.dev.gholts.WeChatStickers"
#endif

static inline NSURL *WCSStoreDirectory(void) {
    NSURL *group = [NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:WCS_APP_GROUP];
    return [group URLByAppendingPathComponent:@"WeChatStickers" isDirectory:YES];
}
