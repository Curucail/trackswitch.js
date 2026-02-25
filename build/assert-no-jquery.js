#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const roots = [
  path.resolve(__dirname, '../src'),
  path.resolve(__dirname, '../docs'),
  path.resolve(__dirname, '../examples'),
];

const ignoredPaths = new Set([]);
const fileExtensions = new Set(['.ts', '.js', '.md', '.html', '.css', '.yml', '.yaml']);

const forbiddenPatterns = [
  { label: 'jQuery global', regex: /\bjQuery\b|\bJQuery\b/g },
  { label: 'jQuery-style invocation', regex: /\$\s*\(/g },
  { label: 'jQuery CDN', regex: /code\.jquery\.com\/jquery/gi },
];

function walkDir(dir, files) {
  if (!fs.existsSync(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (ignoredPaths.has(absolutePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      walkDir(absolutePath, files);
      continue;
    }

    const ext = path.extname(entry.name);
    if (fileExtensions.has(ext)) {
      files.push(absolutePath);
    }
  }
}

function findLineNumber(content, offset) {
  return content.slice(0, offset).split('\n').length;
}

const files = [];
roots.forEach((root) => walkDir(root, files));

const failures = [];

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf8');

  for (const pattern of forbiddenPatterns) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(content);
    while (match) {
      failures.push({
        filePath,
        label: pattern.label,
        line: findLineNumber(content, match.index),
        fragment: match[0],
      });
      match = pattern.regex.exec(content);
    }
  }
}

if (failures.length > 0) {
  console.error('Found forbidden jQuery references:');
  for (const failure of failures) {
    console.error(`${failure.filePath}:${failure.line} [${failure.label}] ${failure.fragment}`);
  }
  process.exit(1);
}

console.log('No jQuery references found in src/docs/examples.');
