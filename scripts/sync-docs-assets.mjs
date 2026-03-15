import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const syncPairs = [
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
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}
