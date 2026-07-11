#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface AppServer : NSObject
@property(nonatomic, copy) void (^onStatus)(NSString *status, NSURL * _Nullable url, BOOL failed);
- (void)start;
- (void)stop;
@end

@implementation AppServer {
  NSTask *_task;
  NSString *_port;
}

- (instancetype)init {
  if ((self = [super init])) {
    _port = NSProcessInfo.processInfo.environment[@"CEO_DESKTOP_PORT"] ?: @"4310";
  }
  return self;
}

- (NSString *)findNode {
  for (NSString *p in @[ @"/opt/homebrew/bin/node", @"/usr/local/bin/node", @"/usr/bin/node" ]) {
    if ([[NSFileManager defaultManager] isExecutableFileAtPath:p]) return p;
  }
  return nil;
}

- (BOOL)isValidAppRoot:(NSString *)root {
  if (!root.length) return NO;
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *server = [root stringByAppendingPathComponent:@"server.js"];
  NSString *pkg = [root stringByAppendingPathComponent:@"package.json"];
  return [fm fileExistsAtPath:server] || [fm fileExistsAtPath:pkg];
}

- (BOOL)hasStandaloneServer:(NSString *)root {
  return [[NSFileManager defaultManager]
      fileExistsAtPath:[root stringByAppendingPathComponent:@"server.js"]];
}

/// Resolve ceo-app root. Prefer bundled Resources/ceo-app with server.js.
- (NSString *)resolveAppRoot {
  NSFileManager *fm = NSFileManager.defaultManager;

  // 1) Explicit override
  NSString *env = NSProcessInfo.processInfo.environment[@"CEO_APP_ROOT"];
  if ([self isValidAppRoot:env]) return env;

  // 2) NSBundle Resources/ceo-app
  NSString *bundled = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"ceo-app"];
  if ([self isValidAppRoot:bundled]) return bundled;

  // 3) Executable-relative: …/BluRidge CEO.app/Contents/MacOS/X → ../Resources/ceo-app
  NSString *exe = NSBundle.mainBundle.executablePath;
  if (!exe.length) {
    exe = NSProcessInfo.processInfo.arguments.firstObject;
  }
  if (exe.length) {
    NSString *viaExe = [[[exe stringByDeletingLastPathComponent] // MacOS
                            stringByDeletingLastPathComponent]   // Contents
                           stringByAppendingPathComponent:@"Resources/ceo-app"];
    if ([self isValidAppRoot:viaExe]) return viaExe;
  }

  // 4) Walk up from cwd (desktop:dev / source tree)
  NSString *probe = fm.currentDirectoryPath;
  for (int i = 0; i < 12; i++) {
    NSString *pkg = [probe stringByAppendingPathComponent:@"package.json"];
    NSData *data = [NSData dataWithContentsOfFile:pkg];
    if (data) {
      NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
      if ([text containsString:@"\"name\": \"ceo-app\""]) return probe;
    }
    NSString *parent = [probe stringByDeletingLastPathComponent];
    if ([parent isEqualToString:probe]) break;
    probe = parent;
  }

  return nil;
}

- (BOOL)waitForURL:(NSURL *)url attempts:(int)attempts {
  for (int i = 0; i < attempts; i++) {
    if (_task && !_task.isRunning && i > 2) return NO;
    NSURLRequest *req = [NSURLRequest requestWithURL:url
                                         cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                     timeoutInterval:1.2];
    __block BOOL ok = NO;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [[NSURLSession.sharedSession dataTaskWithRequest:req
                                   completionHandler:^(NSData *d, NSURLResponse *r, NSError *e) {
      NSHTTPURLResponse *http = (NSHTTPURLResponse *)r;
      if (!e && http.statusCode >= 200 && http.statusCode < 500) ok = YES;
      dispatch_semaphore_signal(sem);
    }] resume];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2 * NSEC_PER_SEC)));
    if (ok) return YES;
    if (self.onStatus) {
      self.onStatus([NSString stringWithFormat:@"Waiting for server… (%d/%d)", i + 1, attempts], nil, NO);
    }
    [NSThread sleepForTimeInterval:0.35];
  }
  return NO;
}

- (void)start {
  NSString *external = NSProcessInfo.processInfo.environment[@"CEO_DESKTOP_URL"];
  if (external.length) {
    NSURL *url = [NSURL URLWithString:external];
    if (self.onStatus) {
      self.onStatus([NSString stringWithFormat:@"Connecting to %@…", external], nil, NO);
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      BOOL ok = [self waitForURL:url attempts:60];
      dispatch_async(dispatch_get_main_queue(), ^{
        if (ok) {
          if (self.onStatus) self.onStatus(@"Ready", url, NO);
        } else if (self.onStatus) {
          self.onStatus(@"Could not reach Next.js. Run npm run dev first.", nil, YES);
        }
      });
    });
    return;
  }

  NSString *root = [self resolveAppRoot];
  if (!root) {
    if (self.onStatus) {
      self.onStatus(
          @"Could not find bundled ceo-app.\nRebuild with: npm run desktop:build",
          nil, YES);
    }
    return;
  }

  // Packaged apps must include standalone server.js
  BOOL looksBundled = [root containsString:@".app/Contents/Resources/"];
  if (looksBundled && ![self hasStandaloneServer:root]) {
    if (self.onStatus) {
      self.onStatus(
          @"App bundle is incomplete (missing server.js).\nRebuild with: npm run desktop:build",
          nil, YES);
    }
    return;
  }

  NSString *node = [self findNode];
  if (!node) {
    if (self.onStatus) {
      self.onStatus(@"Node.js not found. Install Node 20+ via Homebrew.", nil, YES);
    }
    return;
  }

  NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%@", _port]];
  if (self.onStatus) {
    self.onStatus([NSString stringWithFormat:@"Starting BluRidge server on port %@…", _port], nil, NO);
  }

  NSMutableDictionary *env = [NSProcessInfo.processInfo.environment mutableCopy];
  env[@"PORT"] = _port;
  env[@"HOSTNAME"] = @"127.0.0.1";
  env[@"CEO_DESKTOP"] = @"1";
  if (!env[@"NODE_ENV"]) env[@"NODE_ENV"] = @"production";

  NSTask *task = [NSTask new];
  task.environment = env;

  NSString *standalone = [root stringByAppendingPathComponent:@"server.js"];
  NSString *nested = [root stringByAppendingPathComponent:@".next/standalone/server.js"];
  NSString *nextBin = [root stringByAppendingPathComponent:@"node_modules/next/dist/bin/next"];

  if ([[NSFileManager defaultManager] fileExistsAtPath:standalone]) {
    task.currentDirectoryURL = [NSURL fileURLWithPath:root];
    task.executableURL = [NSURL fileURLWithPath:node];
    task.arguments = @[ standalone ];
  } else if ([[NSFileManager defaultManager] fileExistsAtPath:nested]) {
    task.currentDirectoryURL =
        [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@".next/standalone"]];
    task.executableURL = [NSURL fileURLWithPath:node];
    task.arguments = @[ nested ];
  } else if ([[NSFileManager defaultManager] fileExistsAtPath:nextBin]) {
    task.currentDirectoryURL = [NSURL fileURLWithPath:root];
    task.executableURL = [NSURL fileURLWithPath:node];
    task.arguments = @[ nextBin, @"start", @"-H", @"127.0.0.1", @"-p", _port ];
  } else {
    if (self.onStatus) {
      self.onStatus(@"Next.js not built. Run: npm run desktop:prepare", nil, YES);
    }
    return;
  }

  task.standardOutput = [NSPipe pipe];
  task.standardError = [NSPipe pipe];
  NSError *err = nil;
  if (![task launchAndReturnError:&err]) {
    if (self.onStatus) {
      self.onStatus(err.localizedDescription ?: @"Failed to launch server", nil, YES);
    }
    return;
  }
  _task = task;

  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    BOOL ok = [self waitForURL:url attempts:90];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (ok) {
        if (self.onStatus) self.onStatus(@"Ready", url, NO);
      } else {
        [self stop];
        if (self.onStatus) {
          self.onStatus(@"Server did not become ready. Check Postgres and .env.", nil, YES);
        }
      }
    });
  });
}

- (void)stop {
  if (_task.isRunning) [_task terminate];
  _task = nil;
}
@end

@interface AppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@end

@implementation AppDelegate {
  NSWindow *_window;
  WKWebView *_webView;
  NSTextField *_status;
  AppServer *_server;
}

- (void)applicationDidFinishLaunching:(NSNotification *)n {
  NSRect frame = NSMakeRect(0, 0, 1320, 860);
  _window = [[NSWindow alloc]
      initWithContentRect:frame
                styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                           NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable |
                           NSWindowStyleMaskFullSizeContentView)
                  backing:NSBackingStoreBuffered
                    defer:NO];
  _window.title = @"BluRidge CEO";
  _window.titlebarAppearsTransparent = YES;
  _window.minSize = NSMakeSize(1100, 700);
  [_window center];
  _window.backgroundColor = [NSColor colorWithRed:0.06 green:0.07 blue:0.10 alpha:1];

  NSView *content = [[NSView alloc] initWithFrame:frame];
  content.wantsLayer = YES;
  content.layer.backgroundColor =
      [NSColor colorWithRed:0.06 green:0.07 blue:0.10 alpha:1].CGColor;

  _status = [NSTextField labelWithString:@"Starting BluRidge…"];
  _status.alignment = NSTextAlignmentCenter;
  _status.textColor = NSColor.secondaryLabelColor;
  _status.font = [NSFont systemFontOfSize:13];
  _status.maximumNumberOfLines = 6;
  _status.translatesAutoresizingMaskIntoConstraints = NO;
  [content addSubview:_status];
  [NSLayoutConstraint activateConstraints:@[
    [_status.centerXAnchor constraintEqualToAnchor:content.centerXAnchor],
    [_status.centerYAnchor constraintEqualToAnchor:content.centerYAnchor],
    [_status.leadingAnchor constraintGreaterThanOrEqualToAnchor:content.leadingAnchor constant:40],
    [_status.trailingAnchor constraintLessThanOrEqualToAnchor:content.trailingAnchor constant:-40],
  ]];

  _window.contentView = content;
  [_window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  [self buildMenu];

  _server = [AppServer new];
  __weak typeof(self) weakSelf = self;
  _server.onStatus = ^(NSString *status, NSURL *url, BOOL failed) {
    __strong typeof(weakSelf) self = weakSelf;
    if (!self) return;
    if (url) {
      [self showWebView:url];
    } else {
      self->_status.hidden = NO;
      self->_status.stringValue = status;
      if (failed) {
        self->_status.stringValue =
            [status stringByAppendingString:@"\n\nFix the issue, then restart the app."];
      }
      [self->_webView removeFromSuperview];
      self->_webView = nil;
    }
  };
  [_server start];
}

- (void)buildMenu {
  NSMenu *mainMenu = [NSMenu new];
  NSMenuItem *appItem = [NSMenuItem new];
  [mainMenu addItem:appItem];
  NSMenu *appMenu = [NSMenu new];
  appItem.submenu = appMenu;
  [appMenu addItemWithTitle:@"Quit BluRidge CEO" action:@selector(terminate:) keyEquivalent:@"q"];

  NSMenuItem *serverItem = [NSMenuItem new];
  [mainMenu addItem:serverItem];
  NSMenu *serverMenu = [[NSMenu alloc] initWithTitle:@"Server"];
  serverItem.submenu = serverMenu;
  [serverMenu addItemWithTitle:@"Reload App" action:@selector(reloadApp) keyEquivalent:@"r"];
  [serverMenu addItemWithTitle:@"Open in Browser" action:@selector(openInBrowser) keyEquivalent:@"o"];
  NSApp.mainMenu = mainMenu;
}

- (void)reloadApp {
  [_webView reload];
}

- (void)openInBrowser {
  if (_webView.URL) [NSWorkspace.sharedWorkspace openURL:_webView.URL];
}

- (void)showWebView:(NSURL *)url {
  NSView *content = _window.contentView;
  _status.hidden = YES;
  if (!_webView) {
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.defaultWebpagePreferences.allowsContentJavaScript = YES;
    WKUserScript *script = [[WKUserScript alloc]
        initWithSource:
            @"Object.defineProperty(window,'__BLURIDGE_DESKTOP__',{value:true,writable:false});"
             "document.documentElement.dataset.desktop='1';"
                injectionTime:WKUserScriptInjectionTimeAtDocumentStart
             forMainFrameOnly:YES];
    [config.userContentController addUserScript:script];

    _webView = [[WKWebView alloc] initWithFrame:content.bounds configuration:config];
    _webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _webView.allowsBackForwardNavigationGestures = YES;
    _webView.allowsMagnification = YES;
    _webView.navigationDelegate = self;
    [_webView setValue:@NO forKey:@"drawsBackground"];
    [content addSubview:_webView];
  }
  NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
  [req setValue:@"BluRidgeCEO-macOS" forHTTPHeaderField:@"X-Desktop-App"];
  [_webView loadRequest:req];
}

- (void)applicationWillTerminate:(NSNotification *)n {
  [_server stop];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  return YES;
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *app = NSApplication.sharedApplication;
    AppDelegate *delegate = [AppDelegate new];
    app.delegate = delegate;
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    [app run];
  }
  return 0;
}
