#!/usr/bin/env node

/**
 * Patch for @react-native-firebase/app to fix RCTBridgeModule header import issues
 * This specifically targets the header file where the import declaration is needed
 */

const fs = require('fs');
const path = require('path');

function patchRNFBAppModuleHeader() {
  try {
    // Find the RNFBApp module header in node_modules
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
      console.log('[RNFBApp Module Header Patch] Module header not found, skipping patch');
      return;
    }

    console.log(`[RNFBApp Module Header Patch] Found module header at: ${moduleHeaderPath}`);

    let content = fs.readFileSync(moduleHeaderPath, 'utf8');

    // Check the current content to understand the structure
    console.log('[RNFBApp Module Header Patch] Current header content preview:');
    console.log(content.substring(0, 500));

    // Add forward declarations and imports at the top
    const headerFixes = `
// Forward declarations to fix modular header issues
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Additional forward declarations for Firebase
@class FIRApp;
@class FIRAuth;
`;

    // Add after the standard imports but before the @interface
    const importSectionEnd = content.match(/#import\s+"RNFBAppModule\.h"/);
    if (importSectionEnd) {
      // Find the end of import section
      const lines = content.split('\n');
      let insertIndex = -1;
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('#import') && !lines[i+1]?.includes('#import')) {
          insertIndex = i + 1;
          break;
        }
      }
      
      if (insertIndex > 0) {
        lines.splice(insertIndex, 0, ...headerFixes.trim().split('\n'));
        content = lines.join('\n');
        
        fs.writeFileSync(moduleHeaderPath, content, 'utf8');
        console.log('[RNFBApp Module Header Patch] Successfully added RCTBridgeModule imports and forward declarations');
      }
    } else {
      // If no imports found, add at the top after comments
      const commentEnd = content.match(/\*\/\s*\n/);
      if (commentEnd) {
        content = content.replace(commentEnd[0], commentEnd[0] + headerFixes);
        fs.writeFileSync(moduleHeaderPath, content, 'utf8');
        console.log('[RNFBApp Module Header Patch] Added imports after license header');
      }
    }

    // Verify the changes
    const updatedContent = fs.readFileSync(moduleHeaderPath, 'utf8');
    if (updatedContent.includes('#import <React/RCTBridgeModule.h>')) {
      console.log('[RNFBApp Module Header Patch] ✅ Successfully patched header file');
    } else {
      console.log('[RNFBApp Module Header Patch] ❌ Header patch may not have worked correctly');
    }

  } catch (error) {
    console.error('[RNFBApp Module Header Patch] Error patching module:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  patchRNFBAppModuleHeader();
}

module.exports = patchRNFBAppModuleHeader;