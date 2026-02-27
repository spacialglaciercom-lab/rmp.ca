/**
 * Simple processor icon generator using basic canvas operations
 * Creates a processor-style app icon without external dependencies
 */

const fs = require('fs');
const path = require('path');

// Simple SVG generator for processor icon
function generateProcessorSVG() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background with rounded corners -->
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="50%" stop-color="#1a1a1a"/>
      <stop offset="100%" stop-color="#2a2a2a"/>
    </linearGradient>
    <mask id="roundedCorners">
      <rect width="1024" height="1024" fill="white"/>
      <rect x="50" y="50" width="924" height="924" rx="130" fill="black"/>
    </mask>
  </defs>
  
  <!-- Background -->
  <rect width="1024" height="1024" fill="url(#bgGradient)" mask="url(#roundedCorners)"/>
  
  <!-- Processor Die -->
  <rect x="312" y="312" width="400" height="400" rx="40" fill="#1a1a1a" stroke="#FFD700" stroke-width="8"/>
  
  <!-- Internal Grid -->
  <rect x="362" y="362" width="300" height="300" rx="20" fill="none" stroke="#B87333" stroke-width="4"/>
  
  <!-- Processor Cores (5x5 grid) -->
  <g fill="#B87333">
    <!-- Row 1 -->
    <rect x="387" y="387" width="30" height="30" rx="4"/>
    <rect x="437" y="387" width="30" height="30" rx="4"/>
    <rect x="487" y="387" width="30" height="30" rx="4"/>
    <rect x="537" y="387" width="30" height="30" rx="4"/>
    <rect x="587" y="387" width="30" height="30" rx="4"/>
    <!-- Row 2 -->
    <rect x="387" y="437" width="30" height="30" rx="4"/>
    <rect x="437" y="437" width="30" height="30" rx="4"/>
    <rect x="487" y="437" width="30" height="30" rx="4"/>
    <rect x="537" y="437" width="30" height="30" rx="4"/>
    <rect x="587" y="437" width="30" height="30" rx="4"/>
    <!-- Row 3 -->
    <rect x="387" y="487" width="30" height="30" rx="4"/>
    <rect x="437" y="487" width="30" height="30" rx="4"/>
    <rect x="487" y="487" width="30" height="30" rx="4"/>
    <rect x="537" y="487" width="30" height="30" rx="4"/>
    <rect x="587" y="487" width="30" height="30" rx="4"/>
    <!-- Row 4 -->
    <rect x="387" y="537" width="30" height="30" rx="4"/>
    <rect x="437" y="537" width="30" height="30" rx="4"/>
    <rect x="487" y="537" width="30" height="30" rx="4"/>
    <rect x="537" y="537" width="30" height="30" rx="4"/>
    <rect x="587" y="537" width="30" height="30" rx="4"/>
    <!-- Row 5 -->
    <rect x="387" y="587" width="30" height="30" rx="4"/>
    <rect x="437" y="587" width="30" height="30" rx="4"/>
    <rect x="487" y="587" width="30" height="30" rx="4"/>
    <rect x="537" y="587" width="30" height="30" rx="4"/>
    <rect x="587" y="587" width="30" height="30" rx="4"/>
  </g>
  
  <!-- Connection Pads - Top Row -->
  <g fill="#FFD700">
    <rect x="212" y="212" width="24" height="24" rx="6"/>
    <rect x="262" y="212" width="24" height="24" rx="6"/>
    <rect x="312" y="212" width="24" height="24" rx="6"/>
    <rect x="362" y="212" width="24" height="24" rx="6"/>
    <rect x="412" y="212" width="24" height="24" rx="6"/>
    <rect x="462" y="212" width="24" height="24" rx="6"/>
    <rect x="512" y="212" width="24" height="24" rx="6"/>
    <rect x="562" y="212" width="24" height="24" rx="6"/>
    <rect x="612" y="212" width="24" height="24" rx="6"/>
    <rect x="662" y="212" width="24" height="24" rx="6"/>
    <rect x="712" y="212" width="24" height="24" rx="6"/>
    <rect x="762" y="212" width="24" height="24" rx="6"/>
  </g>
  
  <!-- Connection Pads - Bottom Row -->
  <g fill="#FFD700">
    <rect x="212" y="788" width="24" height="24" rx="6"/>
    <rect x="262" y="788" width="24" height="24" rx="6"/>
    <rect x="312" y="788" width="24" height="24" rx="6"/>
    <rect x="362" y="788" width="24" height="24" rx="6"/>
    <rect x="412" y="788" width="24" height="24" rx="6"/>
    <rect x="462" y="788" width="24" height="24" rx="6"/>
    <rect x="512" y="788" width="24" height="24" rx="6"/>
    <rect x="562" y="788" width="24" height="24" rx="6"/>
    <rect x="612" y="788" width="24" height="24" rx="6"/>
    <rect x="662" y="788" width="24" height="24" rx="6"/>
    <rect x="712" y="788" width="24" height="24" rx="6"/>
    <rect x="762" y="788" width="24" height="24" rx="6"/>
  </g>
  
  <!-- Trace Connections -->
  <g stroke="#B87333" stroke-width="2" opacity="0.6">
    <!-- Top connections -->
    <line x1="224" y1="236" x2="224" y2="312" stroke-linecap="round"/>
    <line x1="274" y1="236" x2="274" y2="312" stroke-linecap="round"/>
    <line x1="324" y1="236" x2="324" y2="312" stroke-linecap="round"/>
    <line x1="374" y1="236" x2="374" y2="312" stroke-linecap="round"/>
    <line x1="424" y1="236" x2="424" y2="312" stroke-linecap="round"/>
    <line x1="474" y1="236" x2="474" y2="312" stroke-linecap="round"/>
    <line x1="524" y1="236" x2="524" y2="312" stroke-linecap="round"/>
    <line x1="574" y1="236" x2="574" y2="312" stroke-linecap="round"/>
    <line x1="624" y1="236" x2="624" y2="312" stroke-linecap="round"/>
    <line x1="674" y1="236" x2="674" y2="312" stroke-linecap="round"/>
    <line x1="724" y1="236" x2="724" y2="312" stroke-linecap="round"/>
    <line x1="774" y1="236" x2="774" y2="312" stroke-linecap="round"/>
    <!-- Bottom connections -->
    <line x1="224" y1="788" x2="224" y2="712" stroke-linecap="round"/>
    <line x1="274" y1="788" x2="274" y2="712" stroke-linecap="round"/>
    <line x1="324" y1="788" x2="324" y2="712" stroke-linecap="round"/>
    <line x1="374" y1="788" x2="374" y2="712" stroke-linecap="round"/>
    <line x1="424" y1="788" x2="424" y2="712" stroke-linecap="round"/>
    <line x1="474" y1="788" x2="474" y2="712" stroke-linecap="round"/>
    <line x1="524" y1="788" x2="524" y2="712" stroke-linecap="round"/>
    <line x1="574" y1="788" x2="574" y2="712" stroke-linecap="round"/>
    <line x1="624" y1="788" x2="624" y2="712" stroke-linecap="round"/>
    <line x1="674" y1="788" x2="674" y2="712" stroke-linecap="round"/>
    <line x1="724" y1="788" x2="724" y2="712" stroke-linecap="round"/>
    <line x1="774" y1="788" x2="774" y2="712" stroke-linecap="round"/>
  </g>
  
  <!-- Route Arrow -->
  <polygon points="512,462 492,482 492,472 472,472 472,552 492,552 492,542 512,562 532,542 532,552 552,552 552,472 532,472 532,482" fill="#00d9ff"/>
  
  <!-- Small Components -->
  <g opacity="0.7">
    <!-- Resistors -->
    <rect x="150" y="150" width="20" height="8" rx="2" fill="#C0C0C0"/>
    <rect x="850" y="150" width="20" height="8" rx="2" fill="#C0C0C0"/>
    <rect x="150" y="850" width="20" height="8" rx="2" fill="#C0C0C0"/>
    <rect x="850" y="850" width="20" height="8" rx="2" fill="#C0C0C0"/>
  </g>
</svg>`;
}

function saveSVG(svgContent, filename) {
  const outputPath = path.join(__dirname, '../assets/images', filename);
  
  try {
    fs.writeFileSync(outputPath, svgContent);
    console.log(`✅ Saved processor icon SVG: ${filename}`);
    console.log(`📁 Location: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`❌ Error saving SVG:`, error);
    return null;
  }
}

function generateIconSizes() {
  const sizes = [
    { size: 1024, name: 'processor-icon-main.svg' },
    { size: 512, name: 'processor-icon-512.svg' },
    { size: 256, name: 'processor-icon-256.svg' },
    { size: 128, name: 'processor-icon-128.svg' }
  ];
  
  console.log('🚀 Generating processor-style app icon SVG files...');
  
  const svgContent = generateProcessorSVG();
  const generatedFiles = [];
  
  // Save main SVG
  const mainPath = saveSVG(svgContent, 'processor-icon.svg');
  if (mainPath) generatedFiles.push(mainPath);
  
  // Create size-specific versions (same SVG, different canvas size)
  sizes.forEach(({ size, name }) => {
    const sizedSVG = svgContent.replace('width="1024" height="1024"', `width="${size}" height="${size}"`);
    const outputPath = saveSVG(sizedSVG, name);
    if (outputPath) generatedFiles.push(outputPath);
  });
  
  return generatedFiles;
}

function createIOSIconConfiguration() {
  const config = {
    "images": [
      {
        "idiom": "iphone",
        "scale": "2x",
        "size": "20x20",
        "filename": "processor-icon-iphone-notification-2x.png"
      },
      {
        "idiom": "iphone",
        "scale": "3x",
        "size": "20x20",
        "filename": "processor-icon-iphone-notification-3x.png"
      },
      {
        "idiom": "iphone",
        "scale": "2x",
        "size": "29x29",
        "filename": "processor-icon-iphone-settings-2x.png"
      },
      {
        "idiom": "iphone",
        "scale": "3x",
        "size": "29x29",
        "filename": "processor-icon-iphone-settings-3x.png"
      },
      {
        "idiom": "iphone",
        "scale": "2x",
        "size": "40x40",
        "filename": "processor-icon-iphone-spotlight-2x.png"
      },
      {
        "idiom": "iphone",
        "scale": "3x",
        "size": "40x40",
        "filename": "processor-icon-iphone-spotlight-3x.png"
      },
      {
        "idiom": "iphone",
        "scale": "2x",
        "size": "60x60",
        "filename": "processor-icon-iphone-app-2x.png"
      },
      {
        "idiom": "iphone",
        "scale": "3x",
        "size": "60x60",
        "filename": "processor-icon-iphone-app-3x.png"
      },
      {
        "idiom": "ipad",
        "scale": "1x",
        "size": "76x76",
        "filename": "processor-icon-ipad-app-1x.png"
      },
      {
        "idiom": "ipad",
        "scale": "2x",
        "size": "76x76",
        "filename": "processor-icon-ipad-app-2x.png"
      },
      {
        "idiom": "ipad",
        "scale": "2x",
        "size": "83.5x83.5",
        "filename": "processor-icon-ipad-pro-app-2x.png"
      },
      {
        "idiom": "ios-marketing",
        "scale": "1x",
        "size": "1024x1024",
        "filename": "processor-icon-app-store-1x.png"
      }
    ],
    "info": {
      "author": "xcode",
      "version": 1
    }
  };
  
  const configPath = path.join(__dirname, '../assets/images/processor-icons/ios/AppIcon.appiconset/Contents.json');
  
  // Create directory if it doesn't exist
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`✅ Created iOS AppIcon.appiconset configuration`);
  console.log(`📁 Location: ${configPath}`);
}

function createImplementationGuide() {
  const guide = `
# Processor Icon Implementation

## Files Generated:
${generateIconSizes().map(file => `- ${path.basename(file)}`).join('\n')}

## Next Steps:

1. **Convert SVG to PNG** (Required for app icons)
   - Use online converters like: cloudconvert.com, svg2png.com
   - Or use Figma/Adobe Illustrator to export as PNG
   - Or use command line: rsvg-convert or inkscape

2. **Create Required Sizes**
   Convert the main SVG to these PNG sizes:
   - 1024x1024 (App Store)
   - 180x180 (iPhone @3x)
   - 120x120 (iPhone @2x)
   - 152x152 (iPad @2x)
   - 76x76 (iPad @1x)
   - etc. (see iOS configuration above)

3. **Update App Configuration**
   Replace your current app.config.ts icon settings with processor icons

4. **Test on Device**
   Build and test the new icons on actual devices

## Recommended Tools for SVG → PNG Conversion:

1. **Online Converters** (Easiest)
   - https://cloudconvert.com/svg-to-png
   - https://svg2png.com/
   - https://convertio.co/svg-png/

2. **Command Line** (For batch conversion)
   \`\`\`bash
   # Using rsvg-convert (install: brew install librsvg)
   rsvg-convert -w 1024 -h 1024 processor-icon.svg -o processor-icon-1024.png
   
   # Using Inkscape
   inkscape processor-icon.svg -w 1024 -h 1024 -o processor-icon-1024.png
   \`\`\`

3. **Figma** (Best quality)
   - Import the SVG
   - Set export settings to PNG
   - Export at multiple sizes

4. **Adobe Illustrator**
   - Open SVG file
   - File → Export → Export for Screens
   - Set multiple sizes

## Quick Start:

1. Go to https://cloudconvert.com/svg-to-png
2. Upload processor-icon.svg
3. Set size to 1024x1024
4. Download PNG
5. Repeat for other required sizes
6. Update app.config.ts
7. Rebuild your app

The processor-style icon will complete your app's aesthetic transformation! 🚀
`;

  const guidePath = path.join(__dirname, '../assets/images/PROCESSOR_ICON_IMPLEMENTATION.md');
  fs.writeFileSync(guidePath, guide.trim());
  console.log(`✅ Created implementation guide`);
  console.log(`📁 Location: ${guidePath}`);
}

// Main execution
function main() {
  console.log('🎯 Starting processor icon generation...');
  
  // Generate SVG files
  const generatedFiles = generateIconSizes();
  
  // Create iOS configuration
  createIOSIconConfiguration();
  
  // Create implementation guide
  createImplementationGuide();
  
  console.log('\n🎉 Processor icon generation complete!');
  console.log('\n💡 Next: Convert SVG files to PNG using the implementation guide');
  console.log('\n🔗 Quick conversion: https://cloudconvert.com/svg-to-png');
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  generateProcessorSVG,
  generateIconSizes,
  createIOSIconConfiguration,
  createImplementationGuide
};