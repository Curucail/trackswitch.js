import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(join(tmpdir(), 'trackswitch-warping-matrix-test-'));
const outfile = join(tempDir, 'warping-matrix-test.mjs');

try {
    await build({
        entryPoints: [resolve(rootDir, 'test/warping-matrix.test.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        outfile,
    });

    await import(pathToFileURL(outfile).href);
} finally {
    await rm(tempDir, { recursive: true, force: true });
}
