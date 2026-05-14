#import "AppDelegate.h"
#import <Firebase.h>
#import <React/RCTBundleURLProvider.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <string.h>

// No-op setter for unknown setSomething: selectors. Args are discarded.
static void KaizenNoOpSetter(id self, SEL _cmd) { (void)self; (void)_cmd; }

// Zero-returning getter (long fits BOOL/int/long/pointer return ABI in rax).
static long KaizenZeroGetter(id self, SEL _cmd) { (void)self; (void)_cmd; return 0; }

// Allowlist of receiver classes where we're willing to absorb unknown selectors.
// Strictly RN/RCT classes and the small set of Foundation collection types that
// React Native's prop dispatch sometimes mis-targets. NEVER UIKit classes
// (intercepting them broke _UITraitOverrides setNSIntegerValue:forTrait:).
static BOOL KaizenAllowResolveOnClass(const char *clsName) {
  if (!clsName) return NO;
  if (strncmp(clsName, "RCT", 3) == 0) return YES;
  if (strncmp(clsName, "RNS", 3) == 0) return YES;   // RNSScreen* and RNSVG*
  if (strncmp(clsName, "RNFB", 4) == 0) return YES;
  if (strncmp(clsName, "RN", 2) == 0) return YES;    // RNGestureHandler*, etc.
  if (strcmp(clsName, "__NSCFNumber") == 0) return YES;
  if (strcmp(clsName, "__NSCFBoolean") == 0) return YES;
  if (strcmp(clsName, "__NSCFString") == 0) return YES;
  if (strcmp(clsName, "__NSCFConstantString") == 0) return YES;
  if (strcmp(clsName, "NSNumber") == 0) return YES;
  if (strcmp(clsName, "NSString") == 0) return YES;
  if (strcmp(clsName, "NSTaggedPointerString") == 0) return YES;
  if (strcmp(clsName, "__NSDictionaryM") == 0) return YES;
  if (strcmp(clsName, "__NSDictionaryI") == 0) return YES;
  if (strcmp(clsName, "__NSArrayM") == 0) return YES;
  if (strcmp(clsName, "__NSArrayI") == 0) return YES;
  if (strcmp(clsName, "NSNull") == 0) return YES;
  return NO;
}

static BOOL KaizenResolveInstanceMethod(id receiver, SEL _cmd, SEL sel) {
  Class cls = (Class)receiver;
  const char *clsName = class_getName(cls);
  if (!KaizenAllowResolveOnClass(clsName)) return NO;
  const char *selName = sel ? sel_getName(sel) : NULL;
  if (!selName) return NO;
  size_t len = strlen(selName);
  BOOL isSetter = (len > 4 &&
                   selName[0] == 's' && selName[1] == 'e' && selName[2] == 't' &&
                   selName[3] >= 'A' && selName[3] <= 'Z' &&
                   selName[len - 1] == ':');
  if (isSetter) {
    class_addMethod(cls, sel, (IMP)KaizenNoOpSetter, "v@:@");
    return YES;
  }
  class_addMethod(cls, sel, (IMP)KaizenZeroGetter, "q@:");
  return YES;
}

static void KaizenInstallSelectorResolver(void) {
  Class meta = object_getClass([NSObject class]);
  if (!meta) return;
  class_replaceMethod(meta,
                      @selector(resolveInstanceMethod:),
                      (IMP)KaizenResolveInstanceMethod,
                      "c@::");
}

// `isEqualTo:` (note: NOT `isEqual:`) is required by react-native-svg's prop
// reset path inside -[RNSVGRenderable setStrokeWidth:]. NSNumber/RNSVGLength
// receivers don't implement it on iOS, causing doesNotRecognizeSelector.
// Provide an NSObject-level fallback that defers to isEqual:.
@interface NSObject (KaizenIsEqualTo)
- (BOOL)isEqualTo:(id)other;
@end

@implementation NSObject (KaizenIsEqualTo)
- (BOOL)isEqualTo:(id)other {
  if (self == other) return YES;
  if (!other) return NO;
  return [self isEqual:other];
}
@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  KaizenInstallSelectorResolver();
  [FIRApp configure];
  self.moduleName = @"KaizenAlpha";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}


- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
  for (NSString *fontFamilyName in [UIFont familyNames]) {
      for (NSString *fontName in [UIFont fontNamesForFamilyName:fontFamilyName]) {
          NSLog(@"Family: %@ Font: %@", fontFamilyName, fontName);
      }
  }
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
