import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(resolve(rootDir, "package.json"), "utf8"),
);

const banner = [
  "/*!",
  ` * trackswitch.js v${packageJson.version} (https://github.com/audiolabs/trackswitch.js)`,
  " * Copyright 2026 International Audio Laboratories Erlangen",
  " * Licensed under MIT (https://github.com/audiolabs/trackswitch.js/blob/master/LICENSE)",
  " */",
].join("\n");

function collectTypeScriptEntryPoints(directory) {
  const entryPoints = [];
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      entryPoints.push(...collectTypeScriptEntryPoints(absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) {
      continue;
    }

    entryPoints.push(absolutePath);
  }

  return entryPoints.sort();
}

function collectJavaScriptOutputs(directory, extensions = [".js"]) {
  const outputs = [];
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      outputs.push(...collectJavaScriptOutputs(absolutePath, extensions));
      continue;
    }

    if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      outputs.push(absolutePath);
    }
  }

  return outputs.sort();
}

function addExtensionToRelativeSpecifier(specifier, extension) {
  if (!specifier.startsWith(".") || /\.[a-z0-9]+$/i.test(specifier)) {
    return specifier;
  }

  return `${specifier}${extension}`;
}

function rewriteEsmImportSpecifiers(directory) {
  const outputFiles = collectJavaScriptOutputs(directory, [".js"]);

  for (const outputFile of outputFiles) {
    const source = readFileSync(outputFile, "utf8");
    const rewritten = source
      .replace(/(from\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_match, prefix, quote, specifier) => {
        return `${prefix}${quote}${addExtensionToRelativeSpecifier(specifier, ".js")}${quote}`;
      })
      .replace(/(import\()(['"])(\.{1,2}\/[^'"]+)\2(\))/g, (_match, prefix, quote, specifier, suffix) => {
        return `${prefix}${quote}${addExtensionToRelativeSpecifier(specifier, ".js")}${quote}${suffix}`;
      });

    if (rewritten !== source) {
      writeFileSync(outputFile, rewritten, "utf8");
    }
  }
}

function rewriteCjsRequireSpecifiers(directory) {
  const outputFiles = collectJavaScriptOutputs(directory, [".cjs"]);

  for (const outputFile of outputFiles) {
    const source = readFileSync(outputFile, "utf8");
    const rewritten = source.replace(
      /(require\()(['"])(\.{1,2}\/[^'"]+)\2(\))/g,
      (_match, prefix, quote, specifier, suffix) => {
        return `${prefix}${quote}${addExtensionToRelativeSpecifier(specifier, ".cjs")}${quote}${suffix}`;
      },
    );

    if (rewritten !== source) {
      writeFileSync(outputFile, rewritten, "utf8");
    }
  }
}

const sourceEntryPoints = collectTypeScriptEntryPoints(resolve(rootDir, "src"));

const browserCommonOptions = {
  entryPoints: [resolve(rootDir, "src/index.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "TrackSwitch",
  target: "es2017",
  banner: { js: banner },
};

const esmCommonOptions = {
  entryPoints: sourceEntryPoints,
  bundle: false,
  platform: "browser",
  format: "esm",
  target: "es2017",
  banner: { js: banner },
  outbase: resolve(rootDir, "src"),
  outdir: resolve(rootDir, "dist/esm"),
};

const cjsCommonOptions = {
  entryPoints: sourceEntryPoints,
  bundle: false,
  platform: "browser",
  format: "cjs",
  target: "es2017",
  banner: { js: banner },
  outbase: resolve(rootDir, "src"),
  outdir: resolve(rootDir, "dist/cjs"),
  outExtension: { ".js": ".cjs" },
};

const minifyOnly = process.argv.includes("--minify-only");
const watch = process.argv.includes("--watch");

const buildConfigs = minifyOnly
  ? [
      {
        ...browserCommonOptions,
        minify: true,
        outfile: resolve(rootDir, "dist/js/trackswitch.min.js"),
      },
    ]
  : [
      {
        ...esmCommonOptions,
      },
      {
        ...cjsCommonOptions,
      },
      {
        ...browserCommonOptions,
        outfile: resolve(rootDir, "dist/js/trackswitch.js"),
      },
      {
        ...browserCommonOptions,
        minify: true,
        outfile: resolve(rootDir, "dist/js/trackswitch.min.js"),
      },
    ];

if (watch) {
  const contexts = await Promise.all(buildConfigs.map((options) => context(options)));
  await Promise.all(contexts.map((buildContext) => buildContext.watch()));
  rewriteEsmImportSpecifiers(resolve(rootDir, "dist/esm"));
  rewriteCjsRequireSpecifiers(resolve(rootDir, "dist/cjs"));

  const dispose = async () => {
    await Promise.all(contexts.map((buildContext) => buildContext.dispose()));
    process.exit(0);
  };

  process.on("SIGINT", dispose);
  process.on("SIGTERM", dispose);

  await new Promise(() => {});
} else {
  await Promise.all(buildConfigs.map((options) => build(options)));
  rewriteEsmImportSpecifiers(resolve(rootDir, "dist/esm"));
  rewriteCjsRequireSpecifiers(resolve(rootDir, "dist/cjs"));
}
