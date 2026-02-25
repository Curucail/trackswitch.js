#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Read CSS source
const trackswitch = fs.readFileSync('css/trackswitch.css', 'utf8');

// Create dist directory if needed
const distDir = path.dirname('dist/tmp/concat.css');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync('dist/tmp/concat.css', trackswitch);
console.log('✓ Prepared CSS');
