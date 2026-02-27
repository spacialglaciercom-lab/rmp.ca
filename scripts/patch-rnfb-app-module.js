#!/usr/bin/env node

/**
 * Patch for @react-native-firebase/app to fix RCTBridgeModule import issues
 * that cause "declaration of 'RCTBridgeModule' must be imported" errors.
 */

const fs = require('fs');
const path = require('path');

function patchRNFBAppModule() {
  try {
    // Find the RNFBApp module in node_modules
    const possiblePaths = [
      'node_modules/@react-native-firebase/app/ios/RNFBApp/RNFBAppModule.h',
      'node_modules/.pnpm/@react-native-firebase+app*/node_modules/@react-native-firebase/app/ios/RNFBApp/RNFBAppModule.h'
    ];

    let moduleHeaderPath = null;
    for (const p of possiblePaths) {
      const fullPath = path.join(process.cwd(), p);
      if (fs.existsSync(fullPath)) {
        moduleHeaderPath = fullPath;
        break;
      }
    }

    if (!moduleHeaderPath) {
      console.log('[RNFBApp Module Patch] Module header not found, skipping patch');
      return;
    }

    console.log(`[RNFBApp Module Patch] Found module header at: ${moduleHeaderPath}`);

    let content = fs.readFileSync(moduleHeaderPath, 'utf8');

    // Check if RCTBridgeModule import is missing
    if (!content.includes('#import <React/RCTBridgeModule.h>')) {
      // Add the import after Foundation import
      const foundationImport = content.match(/#import\s+<Foundation\/Foundation\.h>/);
      if (foundationImport) {
        content = content.replace(
          foundationImport[0],
          foundationImport[0] + '\n#import <React/RCTBridgeModule.h>'
        );
      } else {
        // Add at the top after the last import
        const lastImport = content.match(/(.*#import\s+.*\n)(?!.*#import)/s);
        if (lastImport) {
          content = content.replace(
            lastImport[1],
            lastImport[1] + '#import <React/RCTBridgeModule.h>\n'
          );
        }
      }
      
      fs.writeFileSync(moduleHeaderPath, content, 'utf8');
      console.log('[RNFBApp Module Patch] Successfully added RCTBridgeModule import');
    } else {
      console.log('[RNFBApp Module Patch] RCTBridgeModule import already present');
    }

    // Also fix the implementation file
    const implPath = moduleHeaderPath.replace('.h', '.m');
    if (fs.existsSync(implPath)) {
      let implContent = fs.readFileSync(implPath, 'utf8');
      
      // Add dispatch header if missing
      if (!implContent.includes('#import <dispatch/dispatch.h>')) {
        const lastImport = implContent.match(/(.*#import\s+.*\n)(?!.*#import)/s);
        if (lastImport) {
          implContent = implContent.replace(
            lastImport[1],
            lastImport[1] + '#import <dispatch/dispatch.h>\n'
          );
          fs.writeFileSync(implPath, implContent, 'utf8');
          console.log('[RNFBApp Module Patch] Added dispatch header to implementation');
        }
      }
    }

  } catch (error) {
    console.error('[RNFBApp Module Patch] Error patching module:', error.message);
  }
}

if (require.main === module) {
  patchRNFBAppModule();
}

module.exports = patchRNFBAppModule;