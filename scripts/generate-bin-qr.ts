import QRCode from 'qrcode';
import path from 'path';

async function generateQR(token: string, filename: string) {
  const outputPath = path.resolve(__dirname, `../${filename}`);
  try {
    await QRCode.toFile(outputPath, token, {
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 400,
      margin: 2
    });
    console.log(`✅ QR Code generated for token "${token}" at: ${outputPath}`);
  } catch (err) {
    console.error('❌ Error generating QR Code:', err);
  }
}

// Generate for our first test bin
generateQR('BIN-TR-001', 'test-qr-bin-1.png');
