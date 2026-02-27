#!/usr/bin/env node

/**
 * Targeted Migration Cleanup Script
 * Focuses on specific migration artifacts and backup files
 * Run: node scripts/targeted-migration-cleanup.js
 */

const fs = require('fs');
const path = require('path');

console.log('=== Targeted Migration Cleanup ===\n');

// Specific files to clean up (migration artifacts)
const MIGRATION_ARTIFACTS = [
  'app.config.ts.backup.original',
  'app.config.ts.fresh',
  'ios_build_logs.txt',
  'migrate-to-new-expo-account.js',
  'fresh-account-setup.js',
  'complete-fresh-build.js',
  'setup-new-expo-account.js',
  'monitor-current-build.js',
  'monitor-ios-build.js',
  'build-error-analyzer.js',
  'check-build-error.js'
];

// Cache directories to clean
const CACHE_DIRECTORIES = [
  '.expo',
  'dist'
];

// Files to preserve (important documentation and scripts)
const PRESERVE_FILES = [
  'EXPO_ACCOUNT_SETUP.md',
  'NEW_ACCOUNT_SETUP_GUIDE.md',
  'AGENT_HANDOFF.md',
  'README.md',
  'package.json',
  'app.config.ts',
  'clear-all-cache.js',
  'clear-cache.bat',
  'clear-expo-cache.js',
  'ios-setup.sh',
  'load-env.js',
  'reset-project.js'
];

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function targetedCleanup(dryRun = true) {
  console.log(`${dryRun ? '🔍 ANALYZING' : '🧹 CLEANING'} migration artifacts...\n`);
  
  let totalCleaned = 0;
  let spaceFreed = 0;
  const cleanedFiles = [];
  
  // Clean specific migration files
  console.log('📦 Migration Artifacts:');
  MIGRATION_ARTIFACTS.forEach(fileName => {
    const filePath = path.join(process.cwd(), fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const size = getFileSize(filePath);
      
      if (!PRESERVE_FILES.includes(fileName)) {
        if (dryRun) {
          console.log(`   Would remove: ${fileName} (${formatFileSize(size)})`);
        } else {
          try {
            fs.unlinkSync(filePath);
            console.log(`   Removed: ${fileName} (${formatFileSize(size)})`);
            cleanedFiles.push(fileName);
          } catch (error) {
            console.log(`   ❌ Error removing ${fileName}: ${error.message}`);
          }
        }
        totalCleaned++;
        spaceFreed += size;
      } else {
        console.log(`   🚫 Preserved: ${fileName} (essential file)`);
      }
    }
  });
  
  console.log('\n🗂️  Cache Directories:');
  CACHE_DIRECTORIES.forEach(dirName => {
    const dirPath = path.join(process.cwd(), dirName);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      try {
        const files = fs.readdirSync(dirPath, { recursive: true });
        let dirSize = 0;
        let fileCount = 0;
        
        files.forEach(file => {
          const filePath = path.join(dirPath, file);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            dirSize += getFileSize(filePath);
            fileCount++;
          }
        });
        
        if (dryRun) {
          console.log(`   Would clean: ${dirName}/ (${fileCount} files, ${formatFileSize(dirSize)})`);
        } else {
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`   Cleaned: ${dirName}/ (${fileCount} files, ${formatFileSize(dirSize)})`);
        }
        
        totalCleaned += fileCount;
        spaceFreed += dirSize;
      } catch (error) {
        console.log(`   ❌ Error cleaning ${dirName}: ${error.message}`);
      }
    } else {
      console.log(`   ℹ️  ${dirName}/ not found`);
    }
  });
  
  console.log(`\n✅ ${dryRun ? 'Analysis' : 'Cleanup'} complete!`);
  console.log(`📁 ${dryRun ? 'Would clean' : 'Cleaned'}: ${totalCleaned} items`);
  console.log(`💾 ${dryRun ? 'Would free' : 'Freed'}: ${formatFileSize(spaceFreed)}`);
  
  return { totalCleaned, spaceFreed, cleanedFiles };
}

function createCleanupSummary(result, dryRun = true) {
  const summary = {
    timestamp: new Date().toISOString(),
    mode: dryRun ? 'dry-run' : 'actual',
    totalCleaned: result.totalCleaned,
    spaceFreed: result.spaceFreed,
    cleanedFiles: result.cleanedFiles,
    artifactsRemoved: MIGRATION_ARTIFACTS.filter(file => {
      const filePath = path.join(process.cwd(), file);
      return !PRESERVE_FILES.includes(file) && (!dryRun || fs.existsSync(filePath));
    })
  };
  
  const summaryPath = path.join(process.cwd(), 'migration-cleanup-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n📄 Cleanup summary saved to: ${summaryPath}`);
}

function main() {
  try {
    console.log('🚀 Starting targeted migration cleanup...\n');
    
    // Show what will be cleaned
    console.log('🎯 Targeted Artifacts to Clean:');
    MIGRATION_ARTIFACTS.forEach(file => {
      if (!PRESERVE_FILES.includes(file)) {
        console.log(`   • ${file}`);
      }
    });
    
    console.log('\n📁 Cache Directories to Clean:');
    CACHE_DIRECTORIES.forEach(dir => {
      console.log(`   • ${dir}/`);
    });
    
    console.log('\n🔒 Files to Preserve:');
    PRESERVE_FILES.forEach(file => {
      console.log(`   • ${file}`);
    });
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Run dry run first
    console.log('🔍 DRY RUN MODE - No files will be deleted\n');
    const result = targetedCleanup(true);
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Create summary
    createCleanupSummary(result, true);
    
    console.log('\n💡 To perform actual cleanup, run:');
    console.log('   node scripts/targeted-migration-cleanup.js --force');
    console.log('\n✨ Targeted cleanup analysis complete!');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    process.exit(1);
  }
}

// Handle command line arguments
if (require.main === module) {
  const args = process.argv.slice(2);
  const forceCleanup = args.includes('--force') || args.includes('-f');
  
  if (forceCleanup) {
    console.log('⚠️  FORCE MODE: Performing actual cleanup\n');
    try {
      const result = targetedCleanup(false);
      createCleanupSummary(result, false);
      console.log('\n🎉 Targeted migration cleanup completed successfully!');
      console.log('✨ Your project is now clean of migration artifacts.');
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
      process.exit(1);
    }
  } else {
    main();
  }
}

module.exports = { targetedCleanup, createCleanupSummary };