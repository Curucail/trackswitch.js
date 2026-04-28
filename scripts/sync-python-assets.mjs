import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fromRoot, pythonRuntimeAssets } from './build-assets.mjs';

for (const { source, dist } of pythonRuntimeAssets) {
  const target = fromRoot(dist);

  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(fromRoot(source), target, { recursive: true });
}
