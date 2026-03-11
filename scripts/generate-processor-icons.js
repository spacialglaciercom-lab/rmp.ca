/**
 * Generate processor-style app icons in multiple sizes for iOS
 * Converts SVG to PNG at various resolutions
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// iOS App Icon sizes (in pixels)
const iosIconSizes = [
  { size: 20, scale: [1, 2, 3], name: "iphone-notification" },
  { size: 29, scale: [1, 2, 3], name: "iphone-settings" },
  { size: 40, scale: [1, 2, 3], name: "iphone-spotlight" },
  { size: 60, scale: [2, 3], name: "iphone-app" },
  { size: 76, scale: [1, 2], name: "ipad-app" },
  { size: 83.5, scale: [2], name: "ipad-pro-app" },
  { size: 1024, scale: [1], name: "app-store" },
];

// Android Adaptive Icon sizes
const androidIconSizes = [
  { size: 48, density: "mdpi" },
  { size: 72, density: "hdpi" },
  { size: 96, density: "xhdpi" },
  { size: 144, density: "xxhdpi" },
  { size: 192, density: "xxxhdpi" },
];

async function generateProcessorIcons() {
  try {
    const svgPath = path.join(__dirname, "../assets/images/processor-icon.svg");
    const outputDir = path.join(__dirname, "../assets/images/generated-icons");

    // Create output directories
    const iosDir = path.join(outputDir, "ios");
    const androidDir = path.join(outputDir, "android");

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    if (!fs.existsSync(iosDir)) {
      fs.mkdirSync(iosDir, { recursive: true });
    }
    if (!fs.existsSync(androidDir)) {
      fs.mkdirSync(androidDir, { recursive: true });
    }

    console.log("🚀 Generating processor-style app icons...");

    // Generate iOS icons
    console.log("📱 Generating iOS icons...");
    for (const icon of iosIconSizes) {
      for (const scale of icon.scale) {
        const actualSize = Math.round(icon.size * scale);
        const outputPath = path.join(
          iosDir,
          `processor-icon-${icon.name}-${scale}x.png`,
        );

        await sharp(svgPath)
          .resize(actualSize, actualSize, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toFile(outputPath);

        console.log(
          `✅ Generated ${actualSize}x${actualSize} iOS icon: ${path.basename(outputPath)}`,
        );
      }
    }

    // Generate Android icons
    console.log("🤖 Generating Android icons...");
    for (const icon of androidIconSizes) {
      const outputPath = path.join(
        androidDir,
        `processor-icon-${icon.density}.png`,
      );

      await sharp(svgPath)
        .resize(icon.size, icon.size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toFile(outputPath);

      console.log(
        `✅ Generated ${icon.size}x${icon.size} Android icon: ${path.basename(outputPath)}`,
      );
    }

    // Generate main app icon (1024x1024)
    const mainIconPath = path.join(
      __dirname,
      "../assets/images/processor-icon-main.png",
    );
    await sharp(svgPath)
      .resize(1024, 1024, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(mainIconPath);

    console.log(
      `✅ Generated main 1024x1024 app icon: processor-icon-main.png`,
    );

    // Generate iOS App Icon JSON configuration
    const iosConfig = generateiOSAppIconConfig();
    const iosConfigPath = path.join(
      iosDir,
      "AppIcon.appiconset",
      "Contents.json",
    );

    if (!fs.existsSync(path.dirname(iosConfigPath))) {
      fs.mkdirSync(path.dirname(iosConfigPath), { recursive: true });
    }

    fs.writeFileSync(iosConfigPath, JSON.stringify(iosConfig, null, 2));
    console.log(`✅ Generated iOS AppIcon.appiconset configuration`);

    console.log("\n🎉 All processor-style icons generated successfully!");
    console.log("\nNext steps:");
    console.log("1. Replace your existing app icons with the generated ones");
    console.log("2. Update app.config.ts to point to the new icon files");
    console.log("3. Rebuild your iOS/Android app to see the new icons");
  } catch (error) {
    console.error("❌ Error generating icons:", error);
    process.exit(1);
  }
}

function generateiOSAppIconConfig() {
  const images = [];

  // iPhone notification icons
  images.push({
    idiom: "iphone",
    scale: "2x",
    size: "20x20",
    filename: "processor-icon-iphone-notification-2x.png",
  });
  images.push({
    idiom: "iphone",
    scale: "3x",
    size: "20x20",
    filename: "processor-icon-iphone-notification-3x.png",
  });

  // iPhone settings icons
  images.push({
    idiom: "iphone",
    scale: "2x",
    size: "29x29",
    filename: "processor-icon-iphone-settings-2x.png",
  });
  images.push({
    idiom: "iphone",
    scale: "3x",
    size: "29x29",
    filename: "processor-icon-iphone-settings-3x.png",
  });

  // iPhone spotlight icons
  images.push({
    idiom: "iphone",
    scale: "2x",
    size: "40x40",
    filename: "processor-icon-iphone-spotlight-2x.png",
  });
  images.push({
    idiom: "iphone",
    scale: "3x",
    size: "40x40",
    filename: "processor-icon-iphone-spotlight-3x.png",
  });

  // iPhone app icons
  images.push({
    idiom: "iphone",
    scale: "2x",
    size: "60x60",
    filename: "processor-icon-iphone-app-2x.png",
  });
  images.push({
    idiom: "iphone",
    scale: "3x",
    size: "60x60",
    filename: "processor-icon-iphone-app-3x.png",
  });

  // iPad app icons
  images.push({
    idiom: "ipad",
    scale: "1x",
    size: "76x76",
    filename: "processor-icon-ipad-app-1x.png",
  });
  images.push({
    idiom: "ipad",
    scale: "2x",
    size: "76x76",
    filename: "processor-icon-ipad-app-2x.png",
  });

  // iPad Pro app icons
  images.push({
    idiom: "ipad",
    scale: "2x",
    size: "83.5x83.5",
    filename: "processor-icon-ipad-pro-app-2x.png",
  });

  // App Store icon
  images.push({
    idiom: "ios-marketing",
    scale: "1x",
    size: "1024x1024",
    filename: "processor-icon-app-store-1x.png",
  });

  return {
    images: images,
    info: {
      author: "xcode",
      version: 1,
    },
  };
}

// Run the generator
if (require.main === module) {
  generateProcessorIcons().catch(console.error);
}

module.exports = { generateProcessorIcons };
