#!/usr/bin/env node

/**
 * Generate platform-specific icons from source PNG
 *
 * This script generates:
 * - icon.ico for Windows (from icon.png)
 *
 * Note: icon.icns for macOS already exists and is manually maintained
 * for optimal quality control of multi-resolution icns format.
 */

const path = require('path');
const fs = require('fs');
const png2icons = require('png2icons');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const SOURCE_PNG = path.join(RESOURCES_DIR, 'icon.png');
const OUTPUT_ICO = path.join(RESOURCES_DIR, 'icon.ico');

async function generateIcons() {
  console.log('📦 Generating platform-specific icons...\n');

  // Verify source PNG exists
  if (!fs.existsSync(SOURCE_PNG)) {
    console.error(`❌ Error: Source icon not found at ${SOURCE_PNG}`);
    process.exit(1);
  }

  console.log(`✓ Source PNG found: ${SOURCE_PNG}`);

  try {
    // Read source PNG
    const input = fs.readFileSync(SOURCE_PNG);

    // Generate Windows ICO
    console.log('🔨 Generating icon.ico for Windows...');
    const icoBuffer = png2icons.createICO(input, png2icons.BICUBIC, 0, false);

    if (!icoBuffer) {
      throw new Error('Failed to generate ICO buffer');
    }

    fs.writeFileSync(OUTPUT_ICO, icoBuffer);
    console.log(`✓ Generated: ${OUTPUT_ICO}`);

    console.log('\n✅ Icon generation complete!');
    console.log('\nGenerated files:');
    console.log(`  - ${path.relative(process.cwd(), OUTPUT_ICO)} (Windows)`);
    console.log('\nExisting files (manually maintained):');
    console.log(`  - resources/icon.icns (macOS)`);
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
