// SPDX-License-Identifier: Apache-2.0
#import <Messages/Messages.h>
#import "Store.h"

@interface GHWeChatStickersMessagesController : MSMessagesAppViewController <MSStickerBrowserViewDataSource>
@property (nonatomic, strong) MSStickerBrowserView *browser;
@property (nonatomic, strong) UILabel *status;
@property (nonatomic, copy) NSArray<MSSticker *> *stickers;
@end

@implementation GHWeChatStickersMessagesController
- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.systemBackgroundColor;
    self.browser = [[MSStickerBrowserView alloc] initWithFrame:CGRectZero stickerSize:MSStickerSizeSmall];
    self.browser.dataSource = self;
    self.browser.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:self.browser];
    self.status = [UILabel new];
    self.status.numberOfLines = 0;
    self.status.textAlignment = NSTextAlignmentCenter;
    self.status.textColor = UIColor.secondaryLabelColor;
    self.status.font = [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
    self.status.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:self.status];
    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [self.status.topAnchor constraintEqualToAnchor:safe.topAnchor
                                              constant:8],
        [self.status.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor
                                                  constant:16],
        [self.status.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor
                                                   constant:-16],
        [self.browser.topAnchor constraintEqualToAnchor:self.status.bottomAnchor
                                               constant:8],
        [self.browser.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor],
        [self.browser.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor],
        [self.browser.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor]
    ]];
}

- (void)willBecomeActiveWithConversation:(MSConversation *)conversation {
    [super willBecomeActiveWithConversation:conversation];
    [self loadViewIfNeeded];
    NSURL *directory = WCSStoreDirectory();
    NSDictionary *index = directory ? [NSDictionary dictionaryWithContentsOfURL:[directory URLByAppendingPathComponent:@"index.plist"]] : nil;
    NSMutableArray *stickers = [NSMutableArray array];
    NSUInteger skipped = [index[@"skipped"] unsignedIntegerValue];
    for (NSString *name in index[@"files"]) {
        if (![name isKindOfClass:NSString.class] || ![name.lastPathComponent isEqualToString:name]) continue;
        NSString *description = [NSString stringWithFormat:@"WeChat favorite sticker %lu", (unsigned long)stickers.count + 1];
        MSSticker *sticker = [[MSSticker alloc] initWithContentsOfFileURL:[directory URLByAppendingPathComponent:name] localizedDescription:description error:nil];
        if (sticker) [stickers addObject:sticker];
        else skipped++;
    }
    self.stickers = stickers;
    if (!directory) self.status.text = @"Shared storage unavailable. Reinstall with App Groups enabled.";
    else if (skipped) self.status.text = [NSString stringWithFormat:@"%lu favorites unavailable. Open WeChat’s heart tab to retry. Some may exceed iMessage sticker limits.", (unsigned long)skipped];
    else self.status.text = stickers.count ? @"" : @"Open WeChat’s heart tab to sync favorite stickers.";
    [self.browser reloadData];
}

- (NSInteger)numberOfStickersInStickerBrowserView:(MSStickerBrowserView *)stickerBrowserView {
    (void)stickerBrowserView;
    return self.stickers.count;
}

- (MSSticker *)stickerBrowserView:(MSStickerBrowserView *)stickerBrowserView stickerAtIndex:(NSInteger)index {
    (void)stickerBrowserView;
    return self.stickers[index];
}
@end
