import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const cssRoots = ['css'];
const codeRoots = ['src/ui', 'src/controller', 'src/input', 'src/engine'];
const reportDir = path.join(rootDir, 'node_modules', '.cache');
const reportPath = path.join(reportDir, 'trackswitch-css-audit.json');

const cssClassPattern = /\.([_a-zA-Z][-_a-zA-Z0-9]*)/g;
const cssSelectorBlockPattern = /([^{}]+)\{/g;
const htmlClassPattern = /class="([^"]+)"/g;
const selectorCallPattern = /\.(?:closest|matches|querySelector|querySelectorAll)\((['"`])([\s\S]*?)\1\)/g;
const classListPattern = /\.classList\.(?:add|remove|toggle|contains)\(([\s\S]*?)\)/g;
const classNameAssignmentPattern = /\.className\s*=\s*(['"`])([\s\S]*?)\1/g;
const setAttributeClassPattern = /\.setAttribute\(\s*(['"`])class\1\s*,\s*(['"`])([\s\S]*?)\2\s*\)/g;
const attrClassPattern = /\.attr\(\s*(['"`])class\1\s*,\s*(['"`])([\s\S]*?)\2\s*\)/g;
const stringLiteralPattern = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;

async function listFiles(dir, suffixes) {
  const entries = await readDirSafe(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath, suffixes));
      continue;
    }

    if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readDirSafe(dir) {
  const { readdir } = await import('node:fs/promises');
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function addReference(map, className, reference) {
  const existing = map.get(className);
  if (existing) {
    existing.add(reference);
    return;
  }

  map.set(className, new Set([reference]));
}

function extractClassesFromSelector(selectorText) {
  const classes = new Set();
  let match;

  while ((match = cssClassPattern.exec(selectorText)) !== null) {
    classes.add(match[1]);
  }

  return classes;
}

function extractClassesFromFileContents(filePath, contents, usedByClass, dynamicReferences, knownClasses) {
  let match;

  while ((match = htmlClassPattern.exec(contents)) !== null) {
    const classes = match[1].split(/\s+/).map((value) => value.trim()).filter(Boolean);
    for (const className of classes) {
      addReference(usedByClass, className, `${filePath}:class`);
    }
  }

  while ((match = selectorCallPattern.exec(contents)) !== null) {
    const selector = match[2];
    for (const className of extractClassesFromSelector(selector)) {
      addReference(usedByClass, className, `${filePath}:selector`);
    }
  }

  while ((match = classListPattern.exec(contents)) !== null) {
    const argumentList = match[1];
    let foundString = false;
    let stringMatch;
    while ((stringMatch = stringLiteralPattern.exec(argumentList)) !== null) {
      foundString = true;
      const value = stringMatch[2];
      if (value.includes('.') || value.includes('#') || value.includes('[')) {
        for (const className of extractClassesFromSelector(value)) {
          addReference(usedByClass, className, `${filePath}:classList`);
        }
        continue;
      }

      for (const className of value.split(/\s+/).map((item) => item.trim()).filter(Boolean)) {
        addReference(usedByClass, className, `${filePath}:classList`);
      }
    }

    if (!foundString) {
      dynamicReferences.push(`${filePath}:classList(${argumentList.trim().slice(0, 80)})`);
    }
  }

  while ((match = classNameAssignmentPattern.exec(contents)) !== null) {
    for (const className of match[2].split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
      addReference(usedByClass, className, `${filePath}:className`);
    }
  }

  while ((match = setAttributeClassPattern.exec(contents)) !== null) {
    for (const className of match[3].split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
      addReference(usedByClass, className, `${filePath}:setAttribute`);
    }
  }

  while ((match = attrClassPattern.exec(contents)) !== null) {
    for (const className of match[3].split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
      addReference(usedByClass, className, `${filePath}:attr`);
    }
  }

  while ((match = stringLiteralPattern.exec(contents)) !== null) {
    const tokens = match[2].split(/[^_a-zA-Z0-9-]+/).map((value) => value.trim()).filter(Boolean);
    for (const token of tokens) {
      if (knownClasses.has(token)) {
        addReference(usedByClass, token, `${filePath}:string`);
      }
    }
  }
}

async function main() {
  const cssFiles = (await Promise.all(cssRoots.map((dir) => listFiles(path.join(rootDir, dir), ['.css'])))).flat();
  const codeFiles = (await Promise.all(codeRoots.map((dir) => listFiles(path.join(rootDir, dir), ['.ts'])))).flat();

  const cssByClass = new Map();
  for (const filePath of cssFiles) {
    const contents = await readFile(filePath, 'utf8');
    let match;
    while ((match = cssSelectorBlockPattern.exec(contents)) !== null) {
      const selectorGroup = match[1].trim();
      if (!selectorGroup || selectorGroup.startsWith('@')) {
        continue;
      }

      for (const selector of selectorGroup.split(',')) {
        for (const className of extractClassesFromSelector(selector)) {
          addReference(cssByClass, className, filePath);
        }
      }
    }
  }

  const usedByClass = new Map();
  const dynamicReferences = [];
  const knownClasses = new Set(cssByClass.keys());
  for (const filePath of codeFiles) {
    const contents = await readFile(filePath, 'utf8');
    extractClassesFromFileContents(filePath, contents, usedByClass, dynamicReferences, knownClasses);
  }

  const used = [];
  const deadCandidates = [];

  for (const [className, cssRefs] of [...cssByClass.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const usageRefs = usedByClass.get(className);
    const record = {
      className,
      css: [...cssRefs].sort(),
      references: usageRefs ? [...usageRefs].sort() : [],
    };

    if (usageRefs && usageRefs.size > 0) {
      used.push(record);
      continue;
    }

    deadCandidates.push(record);
  }

  const report = {
    scannedCssFiles: cssFiles.length,
    scannedCodeFiles: codeFiles.length,
    cssClassCount: cssByClass.size,
    usedClassCount: used.length,
    deadCandidateCount: deadCandidates.length,
    dynamicReferenceCount: dynamicReferences.length,
    deadCandidates,
    dynamicReferences: dynamicReferences.sort(),
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`Scanned ${report.scannedCssFiles} CSS files and ${report.scannedCodeFiles} TS files.`);
  console.log(`Found ${report.cssClassCount} CSS class selectors.`);
  console.log(`Confirmed ${report.usedClassCount} class selectors from static code references.`);
  console.log(`Flagged ${report.deadCandidateCount} CSS classes as dead candidates.`);
  if (report.dynamicReferenceCount > 0) {
    console.log(`Recorded ${report.dynamicReferenceCount} dynamic classList usages for manual review.`);
  }
  console.log(`Wrote JSON report to ${reportPath}`);

  if (deadCandidates.length > 0) {
    console.log('\nTop dead candidates:');
    for (const candidate of deadCandidates.slice(0, 20)) {
      console.log(`- .${candidate.className} (${candidate.css.join(', ')})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
