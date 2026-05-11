#!/usr/bin/env node

const { loadImage, createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const pieceSet = process.argv[2] || 'cburnett';
const size = parseInt(process.argv[3]) || 200; // 200px high quality

const svgDir = path.join(__dirname, 'assets', 'pieces', pieceSet);
const pngDir = path.join(__dirname, 'assets', 'pieces-png', pieceSet);

if (!fs.existsSync(pngDir)) {
  fs.mkdirSync(pngDir, { recursive: true });
}

const pieces = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];

(async () => {
  for (const piece of pieces) {
    const svgPath = path.join(svgDir, `${piece}.svg`);
    const pngPath = path.join(pngDir, `${piece}.png`);

    try {
      const svgImage = await loadImage(svgPath);
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');

      // White background for better anti-aliasing
      ctx.fillStyle = 'transparent';
      ctx.fillRect(0, 0, size, size);

      // Render with high quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(svgImage, 0, 0, size, size);

      fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
      console.log(`✓ ${piece}.png (${size}x${size})`);
    } catch (err) {
      console.error(`✗ ${piece}: ${err.message}`);
    }
  }

  console.log(`\nConverted ${pieceSet} pieces to ${size}x${size} PNG`);
})();
