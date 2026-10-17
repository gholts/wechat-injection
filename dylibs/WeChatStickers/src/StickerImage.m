// SPDX-License-Identifier: Apache-2.0
#import "StickerImage.h"
#import <ImageIO/ImageIO.h>
#import <CoreGraphics/CoreGraphics.h>

NSData *WCSStickerData(NSData *data, NSString **extension) {
    if (!data.length || data.length > WCSMaximumSourceBytes) return nil;
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    if (!source) return nil;
    size_t count = CGImageSourceGetCount(source);
    NSString *type = (__bridge NSString *)CGImageSourceGetType(source);
    const uint8_t pngEnd[] = {0, 0, 0, 0, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82};
    // ImageIO accepts unfinished PNGs. Allow WeChat metadata after the end chunk.
    BOOL incompletePNG = [type isEqualToString:@"public.png"] &&
                         [data rangeOfData:[NSData dataWithBytes:pngEnd length:sizeof(pngEnd)]
                                   options:NSDataSearchBackwards
                                     range:NSMakeRange(0, data.length)]
                                 .location == NSNotFound;
    if (!count || incompletePNG) {
        CFRelease(source);
        return nil;
    }
    NSDictionary *properties = (__bridge_transfer NSDictionary *)CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
    NSUInteger width = [properties[(__bridge NSString *)kCGImagePropertyPixelWidth] unsignedIntegerValue];
    NSUInteger height = [properties[(__bridge NSString *)kCGImagePropertyPixelHeight] unsignedIntegerValue];
    NSDictionary *extensions = @{@"public.png": @"png", @"com.compuserve.gif": @"gif", @"public.jpeg": @"jpg"};
    if (width >= 300 && height >= 300 && width <= 618 && height <= 618 && data.length <= 500 * 1024 && extensions[type]) {
        *extension = extensions[type];
        CFRelease(source);
        return data;
    }
    // Bound decoding work. Never flatten an animation to its first frame.
    if (count > 500 || !width || !height) {
        CFRelease(source);
        return nil;
    }
    BOOL animated = count > 1;
    NSMutableData *output = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)output,
                                                                         animated ? CFSTR("com.compuserve.gif") : CFSTR("public.png"), count, NULL);
    if (!destination) {
        CFRelease(source);
        return nil;
    }
    if (animated) {
        NSDictionary *global = (__bridge_transfer NSDictionary *)CGImageSourceCopyProperties(source, NULL);
        NSNumber *loops = global[(__bridge NSString *)kCGImagePropertyGIFDictionary][(__bridge NSString *)kCGImagePropertyGIFLoopCount];
        if (!loops) loops = global[(__bridge NSString *)kCGImagePropertyPNGDictionary][(__bridge NSString *)kCGImagePropertyAPNGLoopCount] ?: @0;
        CGImageDestinationSetProperties(destination, (__bridge CFDictionaryRef) @{(__bridge NSString *)kCGImagePropertyGIFDictionary: @{(__bridge NSString *)kCGImagePropertyGIFLoopCount: loops}});
    }
    BOOL complete = YES;
    for (size_t i = 0; i < count; i++) {
        @autoreleasepool {
            NSDictionary *options = @{(__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
                                      (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
                                      (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @300};
            CGImageRef frame = CGImageSourceCreateThumbnailAtIndex(source, i, (__bridge CFDictionaryRef)options);
            CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
            CGContextRef canvas = CGBitmapContextCreate(NULL, 300, 300, 8, 0, color, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
            CGColorSpaceRelease(color);
            if (!frame || !canvas) {
                if (frame) CGImageRelease(frame);
                if (canvas) CGContextRelease(canvas);
                complete = NO;
                break;
            }
            CGFloat scale = MIN(300.0 / CGImageGetWidth(frame), 300.0 / CGImageGetHeight(frame));
            CGSize size = CGSizeMake(CGImageGetWidth(frame) * scale, CGImageGetHeight(frame) * scale);
            CGContextSetInterpolationQuality(canvas, kCGInterpolationHigh);
            CGContextDrawImage(canvas, CGRectMake((300 - size.width) / 2, (300 - size.height) / 2, size.width, size.height), frame);
            CGImageRef image = CGBitmapContextCreateImage(canvas);
            NSDictionary *frameProperties = (__bridge_transfer NSDictionary *)CGImageSourceCopyPropertiesAtIndex(source, i, NULL);
            NSDictionary *gif = frameProperties[(__bridge NSString *)kCGImagePropertyGIFDictionary];
            NSDictionary *png = frameProperties[(__bridge NSString *)kCGImagePropertyPNGDictionary];
            NSNumber *delay = gif[(__bridge NSString *)kCGImagePropertyGIFUnclampedDelayTime] ?: gif[(__bridge NSString *)kCGImagePropertyGIFDelayTime];
            if (!delay) delay = png[(__bridge NSString *)kCGImagePropertyAPNGUnclampedDelayTime] ?: png[(__bridge NSString *)kCGImagePropertyAPNGDelayTime] ?
                                                                                                                                                            : @0.1;
            NSDictionary *metadata = animated ? @{(__bridge NSString *)kCGImagePropertyGIFDictionary: @{(__bridge NSString *)kCGImagePropertyGIFDelayTime: delay}} : @{};
            if (image) CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)metadata);
            else complete = NO;
            if (image) CGImageRelease(image);
            CGImageRelease(frame);
            CGContextRelease(canvas);
            if (output.length > 500 * 1024) complete = NO;
            if (!complete) break;
        }
    }
    complete = complete && CGImageDestinationFinalize(destination);
    CFRelease(destination);
    CFRelease(source);
    if (!complete || output.length > 500 * 1024) return nil;
    *extension = animated ? @"gif" : @"png";
    return output;
}
