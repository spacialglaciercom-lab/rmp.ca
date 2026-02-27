/**
 * Create processor-style app icon using Canvas API
 * Generates PNG icons for iOS app button
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function createProcessorIcon(size = 1024) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Colors matching the processor UI theme
  const colors = {
    background: ['#0a0a0a', '#1a1a1a', '#2a2a2a'],
    copper: '#B87333',
    gold: '#FFD700',
    silver: '#C0C0C0',
    silicon: '#1a1a1a',
    cyan: '#00d9ff'
  };
  
  // Create background gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, colors.background[0]);
  gradient.addColorStop(0.5, colors.background[1]);
  gradient.addColorStop(1, colors.background[2]);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  
  // Round corners (iOS style)
  const cornerRadius = size * 0.175; // ~180px for 1024px
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, cornerRadius);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  
  // Scale factor for different sizes
  const scale = size / 1024;
  const s = (val) => val * scale;
  
  // Processor Die (Main Chip)
  const dieX = s(312);
  const dieY = s(312);
  const dieSize = s(400);
  
  ctx.strokeStyle = colors.gold;
  ctx.lineWidth = s(8);
  ctx.fillStyle = colors.silicon;
  ctx.fillRect(dieX, dieY, dieSize, dieSize);
  ctx.strokeRect(dieX, dieY, dieSize, dieSize);
  
  // Internal Grid Structure
  ctx.strokeStyle = colors.copper;
  ctx.lineWidth = s(4);
  ctx.strokeRect(s(362), s(362), s(300), s(300));
  
  // Processor Core Grid (5x5 grid of processor cores)
  const coreSize = s(30);
  const coreGap = s(20);
  const coreStartX = s(387);
  const coreStartY = s(387);
  
  ctx.fillStyle = colors.copper;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const x = coreStartX + col * (coreSize + coreGap);
      const y = coreStartY + row * (coreSize + coreGap);
      ctx.fillRect(x, y, coreSize, coreSize);
    }
  }
  
  // Connection Pads (Pin Grid Array)
  const padSize = s(24);
  const padPositions = [];
  
  // Top row of pads
  for (let i = 0; i < 12; i++) {
    const x = s(212 + i * 50);
    const y = s(212);
    padPositions.push({ x, y });
  }
  
  // Bottom row of pads
  for (let i = 0; i < 12; i++) {
    const x = s(212 + i * 50);
    const y = s(788);
    padPositions.push({ x, y });
  }
  
  // Left column of pads
  for (let i = 0; i < 11; i++) {
    const x = s(212);
    const y = s(262 + i * 50);
    padPositions.push({ x, y });
  }
  
  // Right column of pads
  for (let i = 0; i < 11; i++) {
    const x = s(788);
    const y = s(262 + i * 50);
    padPositions.push({ x, y });
  }
  
  // Draw pads
  ctx.fillStyle = colors.gold;
  padPositions.forEach(pad => {
    ctx.beginPath();
    ctx.roundRect(pad.x, pad.y, padSize, padSize, s(6));
    ctx.fill();
  });
  
  // Trace Connections from Pads to Die
  ctx.strokeStyle = colors.copper;
  ctx.lineWidth = s(2);
  ctx.globalAlpha = 0.6;
  
  // Top connections
  for (let i = 0; i < 12; i++) {
    const startX = s(224 + i * 50);
    const startY = s(236);
    const endY = s(312);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX, endY);
    ctx.stroke();
  }
  
  // Bottom connections
  for (let i = 0; i < 12; i++) {
    const startX = s(224 + i * 50);
    const startY = s(788);
    const endY = s(712);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX, endY);
    ctx.stroke();
  }
  
  // Left connections
  for (let i = 0; i < 11; i++) {
    const startX = s(236);
    const startY = s(274 + i * 50);
    const endX = s(312);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, startY);
    ctx.stroke();
  }
  
  // Right connections
  for (let i = 0; i < 11; i++) {
    const startX = s(788);
    const startY = s(274 + i * 50);
    const endX = s(712);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, startY);
    ctx.stroke();
  }
  
  ctx.globalAlpha = 1.0;
  
  // Route Arrow (Center piece)
  const arrowSize = s(80);
  const arrowX = (size - arrowSize) / 2;
  const arrowY = s(462);
  
  ctx.fillStyle = colors.cyan;
  ctx.beginPath();
  // Draw upward arrow
  ctx.moveTo(arrowX + arrowSize/2, arrowY);
  ctx.lineTo(arrowX + arrowSize*0.375, arrowY + arrowSize*0.25);
  ctx.lineTo(arrowX + arrowSize*0.4375, arrowY + arrowSize*0.25);
  ctx.lineTo(arrowX + arrowSize*0.4375, arrowY + arrowSize*0.5);
  ctx.lineTo(arrowX + arrowSize*0.3125, arrowY + arrowSize*0.5);
  ctx.lineTo(arrowX + arrowSize*0.3125, arrowY + arrowSize*0.75);
  ctx.lineTo(arrowX + arrowSize*0.4375, arrowY + arrowSize*0.75);
  ctx.lineTo(arrowX + arrowSize*0.4375, arrowY + arrowSize);
  ctx.lineTo(arrowX + arrowSize*0.5625, arrowY + arrowSize);
  ctx.lineTo(arrowX + arrowSize*0.5625, arrowY + arrowSize*0.75);
  ctx.lineTo(arrowX + arrowSize*0.6875, arrowY + arrowSize*0.75);
  ctx.lineTo(arrowX + arrowSize*0.6875, arrowY + arrowSize*0.5);
  ctx.lineTo(arrowX + arrowSize*0.5625, arrowY + arrowSize*0.5);
  ctx.lineTo(arrowX + arrowSize*0.5625, arrowY + arrowSize*0.25);
  ctx.lineTo(arrowX + arrowSize*0.625, arrowY + arrowSize*0.25);
  ctx.closePath();
  ctx.fill();
  
  // Small Components (Resistors & Capacitors)
  ctx.globalAlpha = 0.7;
  
  // Resistors
  const resistorWidth = s(20);
  const resistorHeight = s(8);
  ctx.fillStyle = colors.silver;
  
  // Top-left resistor
  ctx.fillRect(s(150), s(150), resistorWidth, resistorHeight);
  // Top-right resistor
  ctx.fillRect(s(850), s(150), resistorWidth, resistorHeight);
  // Bottom-left resistor
  ctx.fillRect(s(150), s(850), resistorWidth, resistorHeight);
  // Bottom-right resistor
  ctx.fillRect(s(850), s(850), resistorWidth, resistorHeight);
  
  // Capacitors (simplified as vertical lines)
  ctx.strokeStyle = colors.silver;
  ctx.lineWidth = s(3);
  
  // Top-left capacitor
  ctx.beginPath();
  ctx.moveTo(s(180), s(180));
  ctx.lineTo(s(180), s(196));
  ctx.moveTo(s(188), s(180));
  ctx.lineTo(s(188), s(196));
  ctx.stroke();
  
  // Top-right capacitor
  ctx.beginPath();
  ctx.moveTo(s(820), s(180));
  ctx.lineTo(s(820), s(196));
  ctx.moveTo(s(828), s(180));
  ctx.lineTo(s(828), s(196));
  ctx.stroke();
  
  // Bottom-left capacitor
  ctx.beginPath();
  ctx.moveTo(s(180), s(828));
  ctx.lineTo(s(180), s(844));
  ctx.moveTo(s(188), s(828));
  ctx.lineTo(s(188), s(844));
  ctx.stroke();
  
  // Bottom-right capacitor
  ctx.beginPath();
  ctx.moveTo(s(820), s(828));
  ctx.lineTo(s(820), s(844));
  ctx.moveTo(s(828), s(828));
  ctx.lineTo(s(828), s(844));
  ctx.stroke();
  
  ctx.globalAlpha = 1.0;
  
  return canvas;
}

function generateAllIconSizes() {
  const iconSizes = [
    { size: 1024, name: 'processor-icon-main' },
    { size: 512, name: 'processor-icon-512' },
    { size: 256, name: 'processor-icon-256' },
    { size: 128, name: 'processor-icon-128' },
    { size: 64, name: 'processor-icon-64' },
    { size: 32, name: 'processor-icon-32' },
    { size: 16, name: 'processor-icon-16' }
  ];
  
  const outputDir = path.join(__dirname, '../assets/images/processor-icons');
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log('🚀 Generating processor-style app icons...');
  
  iconSizes.forEach(({ size, name }) => {
    try {
      const canvas = createProcessorIcon(size);
      const buffer = canvas.toBuffer('image/png');
      const outputPath = path.join(outputDir, `${name}.png`);
      
      fs.writeFileSync(outputPath, buffer);
      console.log(`✅ Generated ${size}x${size} icon: ${name}.png`);
    } catch (error) {
      console.error(`❌ Error generating ${name}.png:`, error);
    }
  });
  
  // Generate iOS-specific icon sizes
  const iosSizes = [
    { size: 180, name: 'processor-icon-iphone-60@3x' },
    { size: 120, name: 'processor-icon-iphone-60@2x' },
    { size: 120, name: 'processor-icon-iphone-40@3x' },
    { size: 80, name: 'processor-icon-iphone-40@2x' },
    { size: 87, name: 'processor-icon-ipad-83.5@2x' },
    { size: 152, name: 'processor-icon-ipad-76@2x' },
    { size: 76, name: 'processor-icon-ipad-76@1x' },
    { size: 58, name: 'processor-icon-iphone-29@2x' },
    { size: 87, name: 'processor-icon-iphone-29@3x' },
    { size: 40, name: 'processor-icon-iphone-20@2x' },
    { size: 60, name: 'processor-icon-iphone-20@3x' }
  ];
  
  const iosDir = path.join(outputDir, 'ios');
  if (!fs.existsSync(iosDir)) {
    fs.mkdirSync(iosDir, { recursive: true });
  }
  
  console.log('\n📱 Generating iOS-specific icons...');
  iosSizes.forEach(({ size, name }) => {
    try {
      const canvas = createProcessorIcon(size);
      const buffer = canvas.toBuffer('image/png');
      const outputPath = path.join(iosDir, `${name}.png`);
      
      fs.writeFileSync(outputPath, buffer);
      console.log(`✅ Generated iOS ${size}x${size} icon: ${name}.png`);
    } catch (error) {
      console.error(`❌ Error generating ${name}.png:`, error);
    }
  });
  
  // Generate Android-specific icon sizes
  const androidSizes = [
    { size: 192, name: 'processor-icon-xxxhdpi' },
    { size: 144, name: 'processor-icon-xxhdpi' },
    { size: 96, name: 'processor-icon-xhdpi' },
    { size: 72, name: 'processor-icon-hdpi' },
    { size: 48, name: 'processor-icon-mdpi' }
  ];
  
  const androidDir = path.join(outputDir, 'android');
  if (!fs.existsSync(androidDir)) {
    fs.mkdirSync(androidDir, { recursive: true });
  }
  
  console.log('\n🤖 Generating Android-specific icons...');
  androidSizes.forEach(({ size, name }) => {
    try {
      const canvas = createProcessorIcon(size);
      const buffer = canvas.toBuffer('image/png');
      const outputPath = path.join(androidDir, `${name}.png`);
      
      fs.writeFileSync(outputPath, buffer);
      console.log(`✅ Generated Android ${size}x${size} icon: ${name}.png`);
    } catch (error) {
      console.error(`❌ Error generating ${name}.png:`, error);
    }
  });
  
  console.log('\n🎉 All processor-style app icons generated successfully!');
  console.log('\n📁 Icons saved to: assets/images/processor-icons/');
  console.log('\nNext steps:');
  console.log('1. Update app.config.ts to use the new processor icons');
  console.log('2. For iOS: Copy icons to Xcode project or use expo prebuild');
  console.log('3. For Android: Icons are ready for adaptive icon setup');
  console.log('4. Rebuild your app to see the new processor-style icons!');
}

// Run the generator
if (require.main === module) {
  // Check if canvas is available
  try {
    require('canvas');
    generateAllIconSizes();
  } catch (error) {
    console.log('❌ Canvas module not available. Installing canvas...');
    console.log('Run: npm install canvas');
    console.log('Then run this script again.');
  }
}

module.exports = { createProcessorIcon, generateAllIconSizes };