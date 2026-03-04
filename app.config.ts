// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
// Bundle ID format: RouteMasterPro style for professional appearance
// Updated to com.routemasterpro.mobile for cleaner, more professional package name
// This follows Android best practices and is more memorable
const rawBundleId = "com.routemasterpro.mobile";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Extract timestamp from bundle ID and prefix with "manus" for deep link scheme
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

const APP_VERSION = "1.1.0";

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "RouteMasterPro",
  appSlug: "trashroute-mobile",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663304551018/mcoTEDACrdFNhFmz.png",
  scheme: "routemasterpro",
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config = {
  name: env.appName,
  slug: env.appSlug,
  platforms: ["ios", "android", "web"],
  version: APP_VERSION,
  runtimeVersion: { policy: "appVersion" as const },
  orientation: "portrait",
  /** App icon (iOS home screen, Android, web). 1024×1024 PNG recommended. */
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  ios: {
    icon: "./assets/images/icon.png",
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    /** CFBundleVersion; must increment for each App Store submission (EAS Submit). */
    buildNumber: "7",
    /** Required for Sign in with Apple (expo-apple-authentication) — adds the Apple Sign In entitlement. */
    usesAppleSignIn: true,
    googleServicesFile: "./GoogleService-Info.plist",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ["location", "audio"],
      // Required for Linking.canOpenURL to detect Organic Maps, OsmAnd, MAPS.ME (offline map apps), Mapillary
      LSApplicationQueriesSchemes: ["om", "osmandmaps", "mapswithme", "mapswithmepro", "mapillary", "comgooglemaps", "waze"],
      // Required for microphone access (expo-audio recording)
      NSMicrophoneUsageDescription: "Allow $(PRODUCT_NAME) to access your microphone for voice commands and AI chat.",
      // Required for Mapillary contribution (expo-camera)
      NSCameraUsageDescription: "Allow $(PRODUCT_NAME) to capture street-level imagery for Mapillary.",
      // Allow tile servers used by Map (UrlTile) — without these, map shows gray grid on iOS
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSExceptionDomains: {
          "cdnjs.cloudflare.com": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "tile.openstreetmap.org": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "tile-cyclosm.openstreetmap.fr": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "a.tile-cyclosm.openstreetmap.fr": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "basemaps.cartocdn.com": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "a.basemaps.cartocdn.com": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "localhost": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "openstreetmap.org": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "cartocdn.com": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "server.arcgisonline.com": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "tile.opentopomap.org": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
          "servicesmatriciels.mern.gouv.qc.ca": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSExceptionMinimumTLSVersion: "TLSv1.2",
            NSExceptionRequiresForwardSecrecy: false,
          },
        },
      },
    },
  },
  android: {
    versionCode: 4,
    /** Required by @react-native-firebase/app plugin. Replace with your real file from Firebase Console → Project settings → Your apps → Android. */
    googleServicesFile: "./google-services.json",
    /** Uses top-level icon (same as iOS). No separate adaptive layers. */
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "",
      },
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: true,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS", "ACCESS_BACKGROUND_LOCATION"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  // Re-add when you have a new Expo project (after running `eas init` or creating project at expo.dev)
  // updates: { url: "https://u.expo.dev/YOUR_NEW_PROJECT_ID" },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-apple-authentication",
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "RouteMasterPro needs location for turn-by-turn navigation.",
        isIosBackgroundLocationEnabled: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
          newArchEnabled: true, // Required by react-native-reanimated 4.x
        },
        ios: {
          useFrameworks: "static",
          deploymentTarget: "18.0", // Leap SDK requires iOS 18.0+
          newArchEnabled: true, // Required by react-native-reanimated 4.x
        },
      },
    ],
    "@react-native-firebase/app",
    "@react-native-firebase/crashlytics",
    "./plugins/withCrashlyticsDsymInputs.js",
    "./plugins/withFirebaseModularHeaders.js",
    "./plugins/withRNFBModularHeadersFix.js",
    "./plugins/withRNFBStorageFix.js",
    "./plugins/withRNFBFirestoreFix.js",
    "./plugins/withExpoVideoRecordingFix.js",
    // Leap SDK is iOS-only (requires Swift/SPM). Disabled for Android builds.
    // To enable for iOS: set EXPO_LEAP_SDK=1 and ensure modules/leap-extract exists
    ...(process.env.EXPO_LEAP_SDK === "1" ? [["./plugins/withLeapSdk.js", { version: "0.9.2" }]] : []),
    // Moonshine Voice on-device STT. Adds SPM package (iOS) and JNI libs (Android).
    // Enable for native builds: set EXPO_MOONSHINE=1
    ...(process.env.EXPO_MOONSHINE === "1" ? [["./plugins/withMoonshineSdk.js", { version: "2.0.0" }]] : []),
    // Embed MAPS.ME native map only when OMIM framework is available (set EXPO_MAPME_EMBED=1). Otherwise use openInOfflineMap() from lib/offline-map-url.ts.
    ...(process.env.EXPO_MAPME_EMBED === "1" ? ["./plugins/withMapsMe.js"] : []),
    // Vector map on native (iOS/Android). No token required; use OSM or MapLibre styles. Replaces Mapbox; no Podfile hacks.
    "@maplibre/maplibre-react-native",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  // Set after creating a new Expo project (expo.dev or `eas init`). Required for EAS Build/Submit and OTA updates.
  extra: {
    eas: {
      projectId: "8477234b-7a0e-4437-8efb-4325e13d0e08",
    },
    // Baked-in at build time so iOS has a default Google Maps key (EAS sets EXPO_PUBLIC_GOOGLE_MAPS_API_KEY).
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    // Optional: OpenWeatherMap API key for weather-enhanced routing (client reads EXPO_PUBLIC_OPENWEATHERMAP_API_KEY)
    openWeatherMapApiKey: process.env.EXPO_PUBLIC_OPENWEATHERMAP_API_KEY ?? "",
    // Python/FastAPI Overture route optimizer backend URL (baked in at build time)
    optimizerUrl:
      process.env.EXPO_PUBLIC_OPTIMIZER_URL ??
      "https://proactive-adaptation-backend.up.railway.app",
  },
};

export default config;
