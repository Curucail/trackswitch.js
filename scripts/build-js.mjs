import { readFileSync } from "node:fs";
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

const commonOptions = {
  entryPoints: [resolve(rootDir, "src/index.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "TrackSwitch",
  target: "es2017",
  banner: { js: banner },
};

const minifyOnly = process.argv.includes("--minify-only");
const watch = process.argv.includes("--watch");

const buildConfigs = minifyOnly
  ? [
      {
        ...commonOptions,
        minify: true,
        outfile: resolve(rootDir, "dist/js/trackswitch.min.js"),
      },
    ]
  : [
      {
        ...commonOptions,
        outfile: resolve(rootDir, "dist/js/trackswitch.js"),
      },
      {
        ...commonOptions,
        minify: true,
        outfile: resolve(rootDir, "dist/js/trackswitch.min.js"),
      },
    ];

if (watch) {
  const contexts = await Promise.all(buildConfigs.map((options) => context(options)));
  await Promise.all(contexts.map((buildContext) => buildContext.watch()));

  const dispose = async () => {
    await Promise.all(contexts.map((buildContext) => buildContext.dispose()));
    process.exit(0);
  };

  process.on("SIGINT", dispose);
  process.on("SIGTERM", dispose);

  await new Promise(() => {});
} else {
  await Promise.all(buildConfigs.map((options) => build(options)));
}
