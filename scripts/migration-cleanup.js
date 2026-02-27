#!/usr/bin/env node

/**
 * Migration Cleanup Script
 * Safely removes migration artifacts and temporary files while preserving essential data
 * Run: node scripts/migration-cleanup.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== Migration Cleanup Script ===\n');

// Files and patterns to clean up
const CLEANUP_PATTERNS = {
  // Backup and temporary files
  backupFiles: [
    'app.config.ts.backup.original',
    'app.config.ts.fresh',
    '*.backup',
    '*.tmp',
    '*.temp',
    '*.bak'
  ],
  
  // Migration scripts (keep documentation)
  migrationScripts: [
    'migrate-to-new-expo-account.js',
    'fresh-account-setup.js',
    'complete-fresh-build.js',
    'setup-new-expo-account.js'
  ],
  
  // Build logs and large temporary files
  buildArtifacts: [
    'ios_build_logs.txt',
    '*.log',
    'build-error-analyzer.js',
    'check-build-error.js',
    'complete-fresh-build.js'
  ],
  
  // Monitor scripts (keep only essential ones)
  monitorScripts: [
    'monitor-current-build.js',
    'monitor-ios-build.js'
  ],
  
  // Cache directories
  cacheDirectories: [
    '.expo',
    'node_modules/.cache',
    'dist'
  ]
};

// Files to preserve (documentation and essential scripts)
const PRESERVE_FILES = [
  'EXPO_ACCOUNT_SETUP.md',
  'NEW_ACCOUNT_SETUP_GUIDE.md',
  'AGENT_HANDOFF.md',
  'README.md',
  'package.json',
  'app.config.ts'
];

// Essential scripts to keep
const KEEP_SCRIPTS = [
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

function findFilesByPattern(patterns, basePath = '.') {
  const foundFiles = [];
  
  patterns.forEach(pattern => {
    if (pattern.includes('*')) {
      // Handle glob patterns
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      try {
        const files = fs.readdirSync(basePath, { recursive: true });
        files.forEach(file => {
          if (regex.test(file)) {
            const fullPath = path.join(basePath, file);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              foundFiles.push(fullPath);
            }
          }
        });
      } catch (error) {
        // Directory doesn't exist or other error
      }
    } else {
      // Handle specific files
      const fullPath = path.join(basePath, pattern);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        foundFiles.push(fullPath);
      }
    }
  });
  
  return foundFiles;
}

function findDirectories(dirNames, basePath = '.') {
  const foundDirs = [];
  
  dirNames.forEach(dirName => {
    const fullPath = path.join(basePath, dirName);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      foundDirs.push(fullPath);
    }
  });
  
  return foundDirs;
}

function shouldPreserveFile(filePath) {
  const fileName = path.basename(filePath);
  return PRESERVE_FILES.includes(fileName) || KEEP_SCRIPTS.includes(fileName);
}

function analyzeCleanup() {
  console.log('🔍 Analyzing files for cleanup...\n');
  
  const analysis = {
    backupFiles: [],
    migrationScripts: [],
    buildArtifacts: [],
    monitorScripts: [],
    cacheDirectories: [],
    totalSize: 0
  };
  
  // Find backup and temporary files
  analysis.backupFiles = findFilesByPattern(CLEANUP_PATTERNS.backupFiles);
  
  // Find migration scripts
  analysis.migrationScripts = findFilesByPattern(CLEANUP_PATTERNS.migrationScripts);
  
  // Find build artifacts
  analysis.buildArtifacts = findFilesByPattern(CLEANUP_PATTERNS.buildArtifacts);
  
  // Find monitor scripts
  analysis.monitorScripts = findFilesByPattern(CLEANUP_PATTERNS.monitorScripts);
  
  // Find cache directories
  analysis.cacheDirectories = findDirectories(CLEANUP_PATTERNS.cacheDirectories);
  
  // Calculate total size
  const allFiles = [
    ...analysis.backupFiles,
    ...analysis.migrationScripts,
    ...analysis.buildArtifacts,
    ...analysis.monitorScripts
  ];
  
  allFiles.forEach(file => {
    if (!shouldPreserveFile(file)) {
      analysis.totalSize += getFileSize(file);
    }
  });
  
  // Add cache directory sizes
  analysis.cacheDirectories.forEach(dir => {
    try {
      const files = fs.readdirSync(dir, { recursive: true });
      files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          analysis.totalSize += getFileSize(filePath);
        }
      });
    } catch (error) {
      console.warn(`⚠️  Could not analyze directory: ${dir}`);
    }
  });
  
  return analysis;
}

function displayAnalysis(analysis) {
  console.log('📊 Cleanup Analysis Results:\n');
  
  const categories = [
    { name: 'Backup & Temporary Files', files: analysis.backupFiles, color: '🗂️' },
    { name: 'Migration Scripts', files: analysis.migrationScripts, color: '📦' },
    { name: 'Build Artifacts', files: analysis.buildArtifacts, color: '🔨' },
    { name: 'Monitor Scripts', files: analysis.monitorScripts, color: '📊' },
    { name: 'Cache Directories', files: analysis.cacheDirectories, color: '🗑️' }
  ];
  
  let totalFiles = 0;
  
  categories.forEach(category => {
    if (category.files.length > 0) {
      console.log(`${category.color} ${category.name}: ${category.files.length} items`);
      category.files.forEach(file => {
        const size = getFileSize(file);
        console.log(`   ${file} (${formatFileSize(size)})`);
      });
      console.log('');
      totalFiles += category.files.length;
    }
  });
  
  console.log(`💾 Total space that can be freed: ${formatFileSize(analysis.totalSize)}`);
  console.log(`📁 Total items to clean: ${totalFiles}\n`);
}

function performCleanup(analysis, dryRun = true) {
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be deleted\n');
  }
  
  const allItems = [
    ...analysis.backupFiles,
    ...analysis.migrationScripts,
    ...analysis.buildArtifacts,
    ...analysis.monitorScripts,
    ...analysis.cacheDirectories
  ];
  
  let cleanedCount = 0;
  let freedSpace = 0;
  
  allItems.forEach(item => {
    try {
      if (fs.existsSync(item)) {
        const size = getFileSize(item);
        
        if (!shouldPreserveFile(item)) {
          if (!dryRun) {
            if (fs.statSync(item).isDirectory()) {
              fs.rmSync(item, { recursive: true, force: true });
            } else {
              fs.unlinkSync(item);
            }
          }
          
          console.log(`${dryRun ? 'Would remove' : 'Removed'}: ${item}`);
          cleanedCount++;
          freedSpace += size;
        } else {
          console.log(`🚫 Preserved: ${item} (essential file)`);
        }
      }
    } catch (error) {
      console.error(`❌ Error cleaning ${item}:`, error.message);
    }
  });
  
  console.log(`\n✅ Cleanup ${dryRun ? 'simulation' : 'completed'}!`);
  console.log(`📁 ${dryRun ? 'Would clean' : 'Cleaned'}: ${cleanedCount} items`);
  console.log(`💾 ${dryRun ? 'Would free' : 'Freed'}: ${formatFileSize(freedSpace)}`);
}

function createCleanupReport(analysis) {
  const report = {
    timestamp: new Date().toISOString(),
    analysis: analysis,
    summary: {
      totalItems: analysis.backupFiles.length + analysis.migrationScripts.length + 
                  analysis.buildArtifacts.length + analysis.monitorScripts.length + 
                  analysis.cacheDirectories.length,
      totalSize: analysis.totalSize,
      categories: {
        backupFiles: analysis.backupFiles.length,
        migrationScripts: analysis.migrationScripts.length,
        buildArtifacts: analysis.buildArtifacts.length,
        monitorScripts: analysis.monitorScripts.length,
        cacheDirectories: analysis.cacheDirectories.length
      }
    }
  };
  
  const reportPath = path.join(process.cwd(), 'migration-cleanup-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Cleanup report saved to: ${reportPath}`);
}

function main() {
  try {
    console.log('🚀 Starting migration cleanup analysis...\n');
    
    // Analyze what needs to be cleaned up
    const analysis = analyzeCleanup();
    
    // Display analysis results
    displayAnalysis(analysis);
    
    // Create cleanup report
    createCleanupReport(analysis);
    
    // Ask user if they want to proceed with cleanup
    console.log('\n🤔 What would you like to do?');
    console.log('1. Run DRY RUN (recommended first)');
    console.log('2. Perform actual cleanup');
    console.log('3. Exit without cleaning\n');
    
    // For now, let's do a dry run by default
    console.log('🔄 Running dry run mode...\n');
    performCleanup(analysis, true);
    
    console.log('\n💡 To perform actual cleanup, run:');
    console.log('   node scripts/migration-cleanup.js --force');
    console.log('\n✨ Cleanup analysis complete!');
    
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
      const analysis = analyzeCleanup();
      performCleanup(analysis, false);
      console.log('\n🎉 Migration cleanup completed successfully!');
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
      process.exit(1);
    }
  } else {
    main();
  }
}

module.exports = { analyzeCleanup, performCleanup, createCleanupReport };