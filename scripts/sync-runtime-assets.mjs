import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distJsDir = resolve(rootDir, "dist/js");

mkdirSync(distJsDir, { recursive: true });

copyFileSync(
  resolve(rootDir, "synctoolbox-dist/synctoolbox-1.4.2-py3-none-any.whl"),
  resolve(distJsDir, "synctoolbox-1.4.2-py3-none-any.whl"),
);
copyFileSync(
  resolve(rootDir, "libtsm-dist/libtsm-1.1.2-py3-none-any.whl"),
  resolve(distJsDir, "libtsm-1.1.2-py3-none-any.whl"),
);
cpSync(
  resolve(rootDir, "node_modules/@spotify/basic-pitch/model"),
  resolve(distJsDir, "basic-pitch"),
  { recursive: true },
);
