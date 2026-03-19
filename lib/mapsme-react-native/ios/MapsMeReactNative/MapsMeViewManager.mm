#import "MapsMeViewManager.h"
#import <React/RCTConvert.h>
#import <React/RCTBridge.h>
#import <React/UIManager.h>

// Import the existing MAPS.ME framework headers
#import "MapViewController.h"
#import "Framework.h"
#import "MWMFrameworkHelper.h"
#import "EAGLView.h"

#include "map/framework.hpp"
#include "map/framework_light.hpp"

@implementation MapsMeViewManager

RCT_EXPORT_MODULE(MapsMeViewManager)

RCT_EXPORT_VIEW_PROPERTY(latitude, double)
RCT_EXPORT_VIEW_PROPERTY(longitude, double)
RCT_EXPORT_VIEW_PROPERTY(zoom, double)
RCT_EXPORT_VIEW_PROPERTY(onMapReady, RCTBubblingEventBlock)

- (UIView *)view
{
  MapsMeView *mapView = [[MapsMeView alloc] init];
  return mapView;
}

RCT_CUSTOM_VIEW_PROPERTY(latitude, double, MapsMeView)
{
  view.latitude = json ? [RCTConvert double:json] : 0;
  [view updateMapPosition];
}

RCT_CUSTOM_VIEW_PROPERTY(longitude, double, MapsMeView)
{
  view.longitude = json ? [RCTConvert double:json] : 0;
  [view updateMapPosition];
}

RCT_CUSTOM_VIEW_PROPERTY(zoom, double, MapsMeView)
{
  view.zoom = json ? [RCTConvert double:json] : 0;
  [view updateMapZoom];
}

RCT_EXPORT_METHOD(initializeFramework:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      // Check if framework is already initialized
      static dispatch_once_t onceToken;
      dispatch_once(&onceToken, ^{
        // Initialize the MAPS.ME framework
        FrameworkParams params;
        params.m_enableLocalAds = true;
        params.m_enableDiffs = true;
        
        // Get the framework instance
        auto &framework = GetFramework();
        
        // Basic initialization
        framework.Init(params);
        
        // Configure framework for React Native use
        framework.SetMapStyle(MapStyleClear);
        framework.SetMapCenter({40.7128, -74.0060}); // Default to New York
        framework.SetMapScale(15.0);
      });
      
      resolve(@{@"success": @YES, @"message": @"Framework initialized successfully"});
    } @catch (NSException *exception) {
      reject(@"FRAMEWORK_INIT_ERROR", @"Failed to initialize framework", [NSError errorWithDomain:@"MapsMeError" code:1 userInfo:@{NSLocalizedDescriptionKey: exception.reason}]);
    }
  });
}

RCT_EXPORT_METHOD(setMapPosition:(double)latitude longitude:(double)longitude)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      auto &framework = GetFramework();
      framework.SetMapCenter({latitude, longitude});
    } @catch (NSException *exception) {
      NSLog(@"Error setting map position: %@", exception.reason);
    }
  });
}

RCT_EXPORT_METHOD(setMapZoom:(double)zoom)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      auto &framework = GetFramework();
      framework.SetMapScale(zoom);
    } @catch (NSException *exception) {
      NSLog(@"Error setting map zoom: %@", exception.reason);
    }
  });
}

RCT_EXPORT_METHOD(getCurrentPosition:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      auto &framework = GetFramework();
      auto const position = framework.GetCurrentPosition();
      
      resolve(@{
        @"latitude": @(position.m_lat),
        @"longitude": @(position.m_lon),
        @"timestamp": @(position.m_timestamp)
      });
    } @catch (NSException *exception) {
      reject(@"POSITION_ERROR", @"Failed to get current position", [NSError errorWithDomain:@"MapsMeError" code:2 userInfo:@{NSLocalizedDescriptionKey: exception.reason}]);
    }
  });
}

RCT_EXPORT_METHOD(search:(NSString *)query resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      auto &framework = GetFramework();
      // This would use the search functionality
      // For now, return a mock response
      resolve(@[@{
        @"name": query,
        @"latitude": @40.7128,
        @"longitude": @-74.0060,
        @"type": @"mock_result"
      }]);
    } @catch (NSException *exception) {
      reject(@"SEARCH_ERROR", @"Failed to perform search", [NSError errorWithDomain:@"MapsMeError" code:3 userInfo:@{NSLocalizedDescriptionKey: exception.reason}]);
    }
  });
}

@end

@implementation MapsMeView
{
  EAGLView *_mapView;
  BOOL _frameworkInitialized;
  BOOL _viewAdded;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    _frameworkInitialized = NO;
    _viewAdded = NO;
    self.backgroundColor = [UIColor blackColor];
    [self setupMapsMeFramework];
  }
  return self;
}

- (void)setupMapsMeFramework
{
  // Initialize the MAPS.ME framework
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      // Check if framework is already initialized
      static dispatch_once_t onceToken;
      dispatch_once(&onceToken, ^{
        // Initialize the MAPS.ME framework
        FrameworkParams params;
        params.m_enableLocalAds = true;
        params.m_enableDiffs = true;
        
        // Get the framework instance
        auto &framework = GetFramework();
        
        // Basic initialization
        framework.Init(params);
        
        // Configure framework for React Native use
        framework.SetMapStyle(MapStyleClear);
        framework.SetMapCenter({40.7128, -74.0060}); // Default to New York
        framework.SetMapScale(15.0);
      });
      
      _frameworkInitialized = YES;
      
      // Create the EAGLView for rendering
      [self createMapView];
      
      // Notify React Native that the map is ready
      if (self.onMapReady) {
        self.onMapReady(@{@"ready": @YES});
      }
    } @catch (NSException *exception) {
      NSLog(@"Failed to initialize MAPS.ME framework: %@", exception.reason);
    }
  });
}

- (void)createMapView
{
  if (_mapView || !_frameworkInitialized) return;
  
  // Create the EAGLView that will render the map
  _mapView = [[EAGLView alloc] initWithFrame:self.bounds];
  _mapView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  _mapView.contentMode = UIViewContentModeScaleToFill;
  
  [self addSubview:_mapView];
  _viewAdded = YES;
}

- (void)updateMapPosition
{
  if (!_frameworkInitialized) return;
  
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      auto &framework = GetFramework();
      framework.SetMapCenter({self.latitude, self.longitude});
    } @catch (NSException *exception) {
      NSLog(@"Error updating map position: %@", exception.reason);
    }
  });
}

- (void)updateMapZoom
{
  if (!_frameworkInitialized) return;
  
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      auto &framework = GetFramework();
      framework.SetMapScale(self.zoom);
    } @catch (NSException *exception) {
      NSLog(@"Error updating map zoom: %@", exception.reason);
    }
  });
}

- (void)setLatitude:(double)latitude
{
  _latitude = latitude;
  [self updateMapPosition];
}

- (void)setLongitude:(double)longitude
{
  _longitude = longitude;
  [self updateMapPosition];
}

- (void)setZoom:(double)zoom
{
  _zoom = zoom;
  [self updateMapZoom];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  
  if (_mapView) {
    _mapView.frame = self.bounds;
  }
  
  if (_frameworkInitialized) {
    // Update viewport when view size changes
    CGRect rect = self.bounds;
    CGFloat scale = [UIScreen mainScreen].scale;
    
    [MWMFrameworkHelper setVisibleViewport:rect scaleFactor:scale];
  }
}

- (void)dealloc
{
  // Cleanup if needed
  if (_mapView) {
    [_mapView removeFromSuperview];
    _mapView = nil;
  }
}

@end