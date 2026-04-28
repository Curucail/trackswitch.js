import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const pythonRuntimeAssets = [
  {
    source: 'synctoolbox-dist/synctoolbox-1.4.2-py3-none-any.whl',
    dist: 'dist/js/synctoolbox-1.4.2-py3-none-any.whl',
    docs: 'docs/js/synctoolbox-1.4.2-py3-none-any.whl',
  },
];

export const runtimeAssets = [
  {
    source: 'node_modules/@spotify/basic-pitch/model',
    dist: 'dist/js/basic-pitch',
    docs: 'docs/js/basic-pitch',
  },
];

export const docsAssets = [
  {
    source: 'dist/trackswitch.js',
    docs: 'docs/js/trackswitch.js',
  },
  {
    source: 'dist/css/trackswitch.min.css',
    docs: 'docs/css/trackswitch.min.css',
  },
  {
    source: 'dist/js/trackswitch-interactive.js',
    docs: 'docs/js/trackswitch-interactive.js',
  },
  {
    source: 'dist/js/trackswitch-alignment-worker.js',
    docs: 'docs/js/trackswitch-alignment-worker.js',
  },
  ...pythonRuntimeAssets.map(({ dist, docs }) => ({
    source: dist,
    docs,
  })),
  ...runtimeAssets.map(({ dist, docs }) => ({
    source: dist,
    docs,
  })),
  {
    source: 'examples/default/data',
    docs: 'docs/assets/multitracks',
  },
  {
    source: 'examples/alignment/data',
    docs: 'docs/assets/alignment',
  },
];

export function fromRoot(path) {
  return resolve(rootDir, path);
}
