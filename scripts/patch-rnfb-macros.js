#!/usr/bin/env node

/**
 * Patch for React Native Firebase modules to fix macro redefinition issues
 * and syntax errors that cause build failures with Xcode 16+
 */

const fs = require('fs');
const path = require('path');

function patchRNFBMacros() {
  const modulesToPatch = [
    {
      name: '@react-native-firebase/app',
      headerPath: 'ios/RNFBApp/RNFBAppModule.h',
      implPath: 'ios/RNFBApp/RNFBAppModule.m'
    },
    {
      name: '@react-native-firebase/app-check',
      headerPath: 'ios/RNFBAppCheck/RNFBAppCheckModule.h', 
      implPath: 'ios/RNFBAppCheck/RNFBAppCheckModule.m'
    }
  ];

  for (const module of modulesToPatch) {
    try {
      console.log(`[RNFB Macros Patch] Patching ${module.name}...`);
      
      // Find the module paths
      const basePaths = [
        `node_modules/${module.name}`,
        `node_modules/.pnpm/${module.name.replace(/-/g, '+')}*/node_modules/${module.name}`
      ];

      let moduleRoot = null;
      for (const basePath of basePaths) {
        const fullPath = path.join(process.cwd(), basePath);
        if (fs.existsSync(fullPath)) {
          moduleRoot = fullPath;
          break;
        }
      }

      if (!moduleRoot) {
        console.log(`[RNFB Macros Patch] ${module.name} not found, skipping`);
        continue;
      }

      const headerPath = path.join(moduleRoot, module.headerPath);
      const implPath = path.join(moduleRoot, module.implPath);

      // Patch header file
      if (fs.existsSync(headerPath)) {
        let headerContent = fs.readFileSync(headerPath, 'utf8');
        
        // Add proper imports and guards
        if (!headerContent.includes('#ifndef RNFB_MODULE_MACROS_H')) {
          const headerGuard = `
#ifndef RNFB_MODULE_MACROS_H
#define RNFB_MODULE_MACROS_H

// Import React Native headers with proper modular header support
#if __has_include(<React/RCTBridgeModule.h>)
  #import <React/RCTBridgeModule.h>
#endif
#if __has_include(<React/RCTEventEmitter.h>)
  #import <React/RCTEventEmitter.h>
#endif
#if __has_include(<React/RCTUtils.h>)
  #import <React/RCTUtils.h>
#endif

// Suppress macro redefinition warnings
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wmacro-redefined"

`;
          
          const footerGuard = `

#pragma clang diagnostic pop
#endif // RNFB_MODULE_MACROS_H
`;

          // Add header guard
          headerContent = headerGuard + headerContent + footerGuard;
          
          fs.writeFileSync(headerPath, headerContent, 'utf8');
          console.log(`[RNFB Macros Patch] Added header guards to ${module.headerPath}`);
        }
      }

      // Patch implementation file
      if (fs.existsSync(implPath)) {
        let implContent = fs.readFileSync(implPath, 'utf8');
        
        // Fix common syntax errors
        const fixes = [
          {
            pattern: /RCT_EXPORT_METHOD\(\s*\n\s*:\s*\(/g,
            replacement: 'RCT_EXPORT_METHOD(',
            description: 'Fix RCT_EXPORT_METHOD syntax'
          },
          {
            pattern: /:\s*\(FIRApp\s*\*\)\s*firebaseApp\s*\n\s*:\s*\(/g,
            replacement: ': (FIRApp *)firebaseApp : (',
            description: 'Fix parameter syntax'
          },
          {
            pattern: /:\s*\(BOOL\)\s*isTokenAutoRefreshEnabled\s*\n\s*:\s*\(/g,
            replacement: ': (BOOL)isTokenAutoRefreshEnabled : (',
            description: 'Fix BOOL parameter syntax'
          }
        ];

        let modified = false;
        for (const fix of fixes) {
          if (implContent.match(fix.pattern)) {
            implContent = implContent.replace(fix.pattern, fix.replacement);
            modified = true;
            console.log(`[RNFB Macros Patch] Applied fix: ${fix.description}`);
          }
        }

        // Add compiler pragmas to suppress warnings
        if (!implContent.includes('#pragma clang diagnostic push')) {
          const pragmas = `
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wimplicit-int"
#pragma clang diagnostic ignored "-Wmacro-redefined"
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

`;
          implContent = pragmas + implContent + '\n#pragma clang diagnostic pop\n';
          modified = true;
          console.log(`[RNFB Macros Patch] Added compiler pragmas to ${module.implPath}`);
        }

        if (modified) {
          fs.writeFileSync(implPath, implContent, 'utf8');
          console.log(`[RNFB Macros Patch] ✅ Patched ${module.implPath}`);
        }
      }

    } catch (error) {
      console.error(`[RNFB Macros Patch] Error patching ${module.name}:`, error.message);
    }
  }
}

// Also patch the specific RNFBAppCheck issue we saw in the logs
function patchRNFBAppCheckSpecific() {
  try {
    const possiblePaths = [
      'node_modules/@react-native-firebase/app-check/ios/RNFBAppCheck/RNFBAppCheckModule.m',
      'node_modules/.pnpm/@react-native-firebase+app-check*/node_modules/@react-native-firebase/app-check/ios/RNFBAppCheck/RNFBAppCheckModule.m'
    ];

    let modulePath = null;
    for (const p of possiblePaths) {
      const fullPath = path.join(process.cwd(), p);
      if (fs.existsSync(fullPath)) {
        modulePath = fullPath;
        break;
      }
    }

    if (!modulePath) {
      console.log('[RNFB Macros Patch] RNFBAppCheck module not found for specific patch');
      return;
    }

    let content = fs.readFileSync(modulePath, 'utf8');
    
    // Fix the specific syntax errors we saw in the logs
    const specificFixes = [
      {
        // Fix the RCT_EXPORT_METHOD syntax that was causing errors
        pattern: /RCT_EXPORT_METHOD\(\s*:\s*\(FIRApp\s*\*\)\s*firebaseApp\s*\n\s*:\s*\(NSString\s*\*\)\s*siteKeyOrProvider\s*\n\s*:\s*\(BOOL\)\s*isTokenAutoRefreshEnabled\s*\n\s*:\s*\(RCTPromiseResolveBlock\)\s*resolve\s*rejecter\s*\n\s*:\s*\(RCTPromiseRejectBlock\)\s*reject\s*\)/g,
        replacement: `RCT_EXPORT_METHOD(activate
                  : (FIRApp *)firebaseApp
                  : (NSString *)siteKeyOrProvider
                  : (BOOL)isTokenAutoRefreshEnabled
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)`,
        description: 'Fix RCT_EXPORT_METHOD parameter syntax'
      }
    ];

    let modified = false;
    for (const fix of specificFixes) {
      if (content.match(fix.pattern)) {
        content = content.replace(fix.pattern, fix.replacement);
        modified = true;
        console.log(`[RNFB Macros Patch] Applied specific fix: ${fix.description}`);
      }
    }

    if (modified) {
      fs.writeFileSync(modulePath, content, 'utf8');
      console.log('[RNFB Macros Patch] ✅ Applied specific RNFBAppCheck fixes');
    }

  } catch (error) {
    console.error('[RNFB Macros Patch] Error with specific RNFBAppCheck patch:', error.message);
  }
}

function patchRNFBMacros() {
  console.log('[RNFB Macros Patch] Starting comprehensive macro fixes...');
  patchRNFBMacros();
  patchRNFBAppCheckSpecific();
  console.log('[RNFB Macros Patch] All macro fixes completed');
}

if (require.main === module) {
  patchRNFBMacros();
}

module.exports = patchRNFBMacros;