import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const syncPairs = [
  {
    source: resolve(rootDir, "dist/trackswitch.js"),
    target: resolve(rootDir, "docs/js/trackswitch.js"),
  },
  {
    source: resolve(rootDir, "dist/css/trackswitch.min.css"),
    target: resolve(rootDir, "docs/css/trackswitch.min.css"),
  },
  {
    source: resolve(rootDir, "dist/js/trackswitch-interactive.js"),
    target: resolve(rootDir, "docs/js/trackswitch-interactive.js"),
  },
  {
    source: resolve(rootDir, "dist/js/trackswitch-alignment-worker.js"),
    target: resolve(rootDir, "docs/js/trackswitch-alignment-worker.js"),
  },
  {
    source: resolve(rootDir, "dist/js/synctoolbox-1.4.2-py3-none-any.whl"),
    target: resolve(rootDir, "docs/js/synctoolbox-1.4.2-py3-none-any.whl"),
  },
  {
    source: resolve(rootDir, "dist/js/libtsm-1.1.2-py3-none-any.whl"),
    target: resolve(rootDir, "docs/js/libtsm-1.1.2-py3-none-any.whl"),
  },
  {
    source: resolve(rootDir, "dist/js/basic-pitch"),
    target: resolve(rootDir, "docs/js/basic-pitch"),
  },
  {
    source: resolve(rootDir, "examples/default/data"),
    target: resolve(rootDir, "docs/assets/multitracks"),
  },
  {
    source: resolve(rootDir, "examples/alignment/data"),
    target: resolve(rootDir, "docs/assets/alignment"),
  },
];

for (const { source, target } of syncPairs) {
  if (!existsSync(source)) {
    throw new Error(`Missing source directory: ${source}`);
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}
