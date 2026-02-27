#!/usr/bin/env node

/**
 * Patch for @react-native-firebase/app-check to fix the missing dispatch header import
 * that causes "type specifier missing, defaults to 'int'" errors in EAS builds.
 */

const fs = require('fs');
const path = require('path');

function patchRNFBAppCheck() {
  try {
    // Find the RNFBAppCheck module in node_modules
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
      console.log('[@react-native-firebase/app-check patch] Module not found, skipping patch');
      return;
    }

    console.log(`[@react-native-firebase/app-check patch] Found module at: ${modulePath}`);

    let content = fs.readFileSync(modulePath, 'utf8');

    // Check if dispatch header is already imported
    if (content.includes('#import <dispatch/dispatch.h>')) {
      console.log('[@react-native-firebase/app-check patch] Dispatch header already imported, skipping');
      return;
    }

    // Add the dispatch header import after the existing imports
    const importSection = content.match(/^([\s\S]*?#import\s+"RNFBAppCheckModule\.h"\s*\n)/m);
    if (importSection) {
      const newImport = '#import <dispatch/dispatch.h>\n';
      content = content.replace(importSection[1], importSection[1] + newImport);
      
      fs.writeFileSync(modulePath, content, 'utf8');
      console.log('[@react-native-firebase/app-check patch] Successfully added dispatch header import');
    } else {
      console.warn('[@react-native-firebase/app-check patch] Could not find import section to patch');
    }
  } catch (error) {
    console.error('[@react-native-firebase/app-check patch] Error patching module:', error.message);
  }
}

if (require.main === module) {
  patchRNFBAppCheck();
}

module.exports = patchRNFBAppCheck;