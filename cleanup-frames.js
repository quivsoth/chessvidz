#!/usr/bin/env node

/**
 * Cleanup orphaned frame files from interrupted renders
 * Run this periodically or when disk space gets tight
 */

const fs = require('fs');
const path = require('path');

const framesDir = path.join(__dirname, 'frames');

if (!fs.existsSync(framesDir)) {
  console.log('✓ No frames directory found');
  process.exit(0);
}

// Clean up loose PNG files at root level (orphans from old code or crashes)
const rootFiles = fs.readdirSync(framesDir)
  .filter(f => f.endsWith('.png'));

if (rootFiles.length > 0) {
  console.log(`🗑  Found ${rootFiles.length} orphaned frame files...`);
  rootFiles.forEach(f => fs.unlinkSync(path.join(framesDir, f)));
  console.log(`✓ Deleted ${rootFiles.length} orphaned frames`);
}

// Clean up empty worker subdirectories
const subdirs = fs.readdirSync(framesDir)
  .filter(f => {
    const fullPath = path.join(framesDir, f);
    return fs.statSync(fullPath).isDirectory();
  });

let cleanedDirs = 0;
subdirs.forEach(dir => {
  const dirPath = path.join(framesDir, dir);
  const files = fs.readdirSync(dirPath);

  if (files.length === 0) {
    fs.rmdirSync(dirPath);
    cleanedDirs++;
  } else {
    console.warn(`⚠️  Worker directory ${dir} still has ${files.length} files`);
  }
});

if (cleanedDirs > 0) {
  console.log(`✓ Removed ${cleanedDirs} empty worker directories`);
}

const remaining = fs.readdirSync(framesDir);
if (remaining.length === 0) {
  console.log('✓ Frames directory is clean');
} else {
  console.log(`⚠️  ${remaining.length} items remain in frames/`);
}
