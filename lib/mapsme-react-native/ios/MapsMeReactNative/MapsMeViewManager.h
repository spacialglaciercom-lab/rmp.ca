#import <React/RCTViewManager.h>

@interface MapsMeViewManager : RCTViewManager
@end

@interface MapsMeView : UIView
@property (nonatomic, assign) double latitude;
@property (nonatomic, assign) double longitude;
@property (nonatomic, assign) double zoom;
@property (nonatomic, copy) RCTBubblingEventBlock onMapReady;
@end