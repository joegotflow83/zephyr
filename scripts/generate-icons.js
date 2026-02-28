#!/usr/bin/env node

/**
 * Generate platform-specific icons from source PNG
 *
 * This script generates:
 * - icon.ico for Windows (from icon.png)
 * - icon.icns for macOS (from icon.png, with standard macOS padding applied)
 *
 * macOS icons require ~12% padding on each side so the artwork occupies ~76%
 * of the canvas — matching the visual weight of standard macOS app icons.
 */

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const png2icons = require('png2icons');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const SOURCE_PNG = path.join(RESOURCES_DIR, 'icon.png');
const OUTPUT_ICO = path.join(RESOURCES_DIR, 'icon.ico');
const OUTPUT_ICNS = path.join(RESOURCES_DIR, 'icon.icns');

/** Parse a PNG file into raw RGBA pixel rows. Returns { width, height, pixels }. */
function parsePNG(buffer) {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.slice(0, 8).equals(PNG_SIG)) throw new Error('Not a PNG file');

  let pos = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];

  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.slice(pos + 4, pos + 8).toString('ascii');
    const data = buffer.slice(pos + 8, pos + 8 + length);
    pos += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8) throw new Error(`Unsupported bit depth: ${bitDepth}`);
      if (colorType !== 6) throw new Error(`Only RGBA (color type 6) supported, got ${colorType}`);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const channels = 4;
  const stride = width * channels;
  const pixels = [];
  let offset = 0;
  let prevRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filterType = raw[offset++];
    const row = Buffer.from(raw.slice(offset, offset + stride));
    offset += stride;

    if (filterType === 1) {
      for (let x = channels; x < stride; x++) row[x] = (row[x] + row[x - channels]) & 0xff;
    } else if (filterType === 2) {
      for (let x = 0; x < stride; x++) row[x] = (row[x] + prevRow[x]) & 0xff;
    } else if (filterType === 3) {
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? row[x - channels] : 0;
        row[x] = (row[x] + ((left + prevRow[x]) >> 1)) & 0xff;
      }
    } else if (filterType === 4) {
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? row[x - channels] : 0;
        const up = prevRow[x];
        const upLeft = x >= channels ? prevRow[x - channels] : 0;
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        const pr = (pa <= pb && pa <= pc) ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 0xff;
      }
    }

    pixels.push(row);
    prevRow = row;
  }

  return { width, height, pixels };
}

/** Scale pixel rows using nearest-neighbor interpolation. */
function scaleNearest(pixels, srcW, srcH, dstW, dstH) {
  const result = [];
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.floor(y * srcH / dstH);
    const row = Buffer.alloc(dstW * 4);
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.floor(x * srcW / dstW);
      pixels[srcY].copy(row, x * 4, srcX * 4, srcX * 4 + 4);
    }
    result.push(row);
  }
  return result;
}

/** Encode pixel rows to PNG buffer. */
function encodePNG(width, height, pixels) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (const row of pixels) {
    raw[offset++] = 0; // filter type: None
    row.copy(raw, offset);
    offset += row.length;
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  function makeChunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([typeBytes, data]);
    const crcVal = Buffer.alloc(4);
    crcVal.writeUInt32BE(crc32(crcInput) >>> 0);
    return Buffer.concat([len, typeBytes, data, crcVal]);
  }

  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** CRC-32 implementation (required for PNG chunks). */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Add macOS-standard padding to a PNG buffer.
 * Artwork is scaled to occupy ~76% of the canvas (12% padding each side),
 * matching the visual weight of standard macOS app icons.
 */
function addMacosPadding(inputBuffer, paddingFraction = 0.12) {
  const { width, height, pixels } = parsePNG(inputBuffer);
  const padding = Math.round(width * paddingFraction);
  const artSize = width - 2 * padding;

  const scaled = scaleNearest(pixels, width, height, artSize, artSize);

  const canvasPixels = [];
  const emptyRow = Buffer.alloc(width * 4);
  for (let y = 0; y < height; y++) {
    if (y < padding || y >= padding + artSize) {
      canvasPixels.push(Buffer.from(emptyRow));
    } else {
      const row = Buffer.alloc(width * 4);
      scaled[y - padding].copy(row, padding * 4);
      canvasPixels.push(row);
    }
  }

  return encodePNG(width, height, canvasPixels);
}

async function generateIcons() {
  console.log('📦 Generating platform-specific icons...\n');

  if (!fs.existsSync(SOURCE_PNG)) {
    console.error(`❌ Error: Source icon not found at ${SOURCE_PNG}`);
    process.exit(1);
  }

  console.log(`✓ Source PNG found: ${SOURCE_PNG}`);

  try {
    const input = fs.readFileSync(SOURCE_PNG);

    // Generate Windows ICO
    console.log('🔨 Generating icon.ico for Windows...');
    const icoBuffer = png2icons.createICO(input, png2icons.BICUBIC, 0, false);
    if (!icoBuffer) throw new Error('Failed to generate ICO buffer');
    fs.writeFileSync(OUTPUT_ICO, icoBuffer);
    console.log(`✓ Generated: ${OUTPUT_ICO}`);

    // Generate macOS ICNS with standard padding
    console.log('🔨 Generating icon.icns for macOS (with standard padding)...');
    const paddedPng = addMacosPadding(input, 0.12);
    const icnsBuffer = png2icons.createICNS(paddedPng, png2icons.BICUBIC, 0);
    if (!icnsBuffer) throw new Error('Failed to generate ICNS buffer');
    fs.writeFileSync(OUTPUT_ICNS, icnsBuffer);
    console.log(`✓ Generated: ${OUTPUT_ICNS}`);

    console.log('\n✅ Icon generation complete!');
    console.log('\nGenerated files:');
    console.log(`  - ${path.relative(process.cwd(), OUTPUT_ICO)} (Windows)`);
    console.log(`  - ${path.relative(process.cwd(), OUTPUT_ICNS)} (macOS, artwork at 76% canvas)`);
    console.log('\nExisting files (used as-is):');
    console.log(`  - resources/icon.png (Linux)`);

  } catch (error) {
    console.error('\n❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateIcons();
}

module.exports = { generateIcons };
