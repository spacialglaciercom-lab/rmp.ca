#!/usr/bin/env node

/**
 * Final Cleanup Script
 * Handles remaining cleanup tasks and provides a summary
 * Run: node scripts/final-cleanup.js
 */

const fs = require('fs');
const path = require('path');

console.log('=== Final Migration Cleanup ===\n');

// Additional cleanup tasks
const FINAL_CLEANUP_TASKS = [
  {
    name: 'Clean node_modules cache',
    action: () => {
      const cacheDir = path.join(process.cwd(), 'node_modules', '.cache');
      if (fs.existsSync(cacheDir)) {
        try {
          fs.rmSync(cacheDir, { recursive: true, force: true });
          return { success: true, message: 'Node modules cache cleaned' };
        } catch (error) {
          return { success: false, message: `Error: ${error.message}` };
        }
      }
      return { success: true, message: 'No node_modules cache found' };
    }
  },
  {
    name: 'Clean temporary OS files',
    action: () => {
      const tempPatterns = ['.DS_Store', 'Thumbs.db', '*.tmp'];
      let cleaned = 0;
      
      tempPatterns.forEach(pattern => {
        // This would need more sophisticated glob matching in a real implementation
        // For now, just check current directory
        try {
          const files = fs.readdirSync(process.cwd());
          files.forEach(file => {
            if (file.includes(pattern.replace('*', ''))) {
              fs.unlinkSync(path.join(process.cwd(), file));
              cleaned++;
            }
          });
        } catch (error) {
          // Ignore errors for individual files
        }
      });
      
      return { success: true, message: `Cleaned ${cleaned} temporary files` };
    }
  },
  {
    name: 'Verify cleanup completion',
    action: () => {
      const remainingArtifacts = [
        'app.config.ts.backup.original',
        'app.config.ts.fresh',
        'ios_build_logs.txt',
        'migrate-to-new-expo-account.js'
      ];
      
      const found = remainingArtifacts.filter(file => 
        fs.existsSync(path.join(process.cwd(), file))
      );
      
      if (found.length === 0) {
        return { success: true, message: 'No migration artifacts remaining' };
      } else {
        return { success: false, message: `Found remaining artifacts: ${found.join(', ')}` };
      }
    }
  },
  {
    name: 'Create cleanup completion marker',
    action: () => {
      const marker = {
        cleanupCompleted: new Date().toISOString(),
        version: '1.0.0',
        status: 'migration_cleanup_complete'
      };
      
      fs.writeFileSync(
        path.join(process.cwd(), '.migration-cleanup-complete'),
        JSON.stringify(marker, null, 2)
      );
      
      return { success: true, message: 'Cleanup completion marker created' };
    }
  }
];

function runFinalCleanup() {
  console.log('🚀 Running final cleanup tasks...\n');
  
  const results = [];
  
  FINAL_CLEANUP_TASKS.forEach((task, index) => {
    console.log(`📋 ${index + 1}. ${task.name}...`);
    
    try {
      const result = task.action();
      results.push({ task: task.name, ...result });
      
      if (result.success) {
        console.log(`   ✅ ${result.message}`);
      } else {
        console.log(`   ⚠️  ${result.message}`);
      }
    } catch (error) {
      results.push({ 
        task: task.name, 
        success: false, 
        message: `Error: ${error.message}` 
      });
      console.log(`   ❌ Error: ${error.message}`);
    }
    
    console.log('');
  });
  
  return results;
}

function displayFinalSummary(results) {
  console.log('📊 Final Cleanup Summary:\n');
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Successful tasks: ${successful}`);
  console.log(`⚠️  Tasks with warnings: ${failed}`);
  console.log(`📈 Success rate: ${Math.round((successful / results.length) * 100)}%`);
  
  if (failed > 0) {
    console.log('\n🔍 Tasks that need attention:');
    results.filter(r => !r.success).forEach(result => {
      console.log(`   • ${result.task}: ${result.message}`);
    });
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🎉 Migration cleanup process completed!');
  console.log('✨ Your project is now clean and optimized.');
  console.log('='.repeat(50));
}

function checkCleanupStatus() {
  console.log('🔍 Checking cleanup status...\n');
  
  // Check if cleanup summary exists
  const summaryPath = path.join(process.cwd(), 'migration-cleanup-summary.json');
  if (fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      console.log('📄 Previous cleanup summary found:');
      console.log(`   • Date: ${new Date(summary.timestamp).toLocaleString()}`);
      console.log(`   • Mode: ${summary.mode}`);
      console.log(`   • Items cleaned: ${summary.totalCleaned || 0}`);
      console.log(`   • Space freed: ${(summary.spaceFreed / 1024 / 1024).toFixed(2)} MB`);
      console.log('');
    } catch (error) {
      console.log('⚠️  Could not read cleanup summary\n');
    }
  } else {
    console.log('ℹ️  No previous cleanup summary found\n');
  }
  
  // Check for completion marker
  const markerPath = path.join(process.cwd(), '.migration-cleanup-complete');
  if (fs.existsSync(markerPath)) {
    console.log('✅ Migration cleanup has been completed previously.');
    console.log('🔄 You can run this script again to verify status.\n');
  } else {
    console.log('🆕 Migration cleanup has not been completed yet.\n');
  }
}

function main() {
  try {
    // Check current status
    checkCleanupStatus();
    
    // Run final cleanup tasks
    const results = runFinalCleanup();
    
    // Display summary
    displayFinalSummary(results);
    
    console.log('\n💡 Next steps:');
    console.log('   • Restart your development server if running');
    console.log('   • Run a fresh build to ensure everything works');
    console.log('   • Commit any remaining changes to version control');
    console.log('   • Consider running npm audit to check for security issues');
    
  } catch (error) {
    console.error('❌ Final cleanup failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runFinalCleanup, displayFinalSummary, checkCleanupStatus };