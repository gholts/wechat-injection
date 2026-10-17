// SPDX-License-Identifier: Apache-2.0
#pragma once
#import <Foundation/Foundation.h>

static const NSUInteger WCSMaximumSourceBytes = 8 * 1024 * 1024;

// Returns nil when an image cannot fit Messages' format, dimensions or size limits.
NSData *WCSStickerData(NSData *data, NSString **extension);
