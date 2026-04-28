import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'vite';

const rootDir = __dirname;
const buildTarget = process.env.TRACKSWITCH_BUILD_TARGET || 'browser';

const banner = [
    '/*!',
    ' * trackswitch.js (https://github.com/audiolabs/trackswitch.js)',
    ' * Copyright 2026 International Audio Laboratories Erlangen',
    ' * Licensed under MIT (https://github.com/audiolabs/trackswitch.js/blob/master/LICENSE)',
    ' */',
].join('\n');

const commonBuild = {
    emptyOutDir: false,
    target: 'es2017',
    sourcemap: false,
} as const;

const iifeOutput = {
    banner,
    inlineDynamicImports: true,
} as const;

const buildTargets = {
    browser: {
        build: {
            ...commonBuild,
            outDir: 'dist',
            assetsInlineLimit: Number.MAX_SAFE_INTEGER,
            lib: {
                entry: resolve(rootDir, 'src/browser.ts'),
                name: 'TrackSwitch',
                formats: ['iife'],
                fileName: () => 'trackswitch.js',
            },
            rollupOptions: {
                output: iifeOutput,
            },
        },
    },
    interactive: {
        build: {
            ...commonBuild,
            outDir: 'dist/js',
            lib: {
                entry: resolve(rootDir, 'src/interactive-browser.ts'),
                name: 'TrackSwitchInteractive',
                formats: ['iife'],
                fileName: () => 'trackswitch-interactive.js',
            },
            rollupOptions: {
                output: iifeOutput,
            },
        },
    },
    worker: {
        build: {
            ...commonBuild,
            outDir: 'dist/js',
            lib: {
                entry: resolve(rootDir, 'src/interactive/worker/alignment-worker.ts'),
                name: 'TrackSwitchAlignmentWorker',
                formats: ['iife'],
                fileName: () => 'trackswitch-alignment-worker.js',
            },
            rollupOptions: {
                output: iifeOutput,
            },
        },
    },
    css: {
        build: {
            ...commonBuild,
            outDir: 'dist/css',
            lib: {
                entry: resolve(rootDir, 'src/style-entry.ts'),
                formats: ['es'],
                fileName: () => 'trackswitch-style-entry.js',
            },
            rollupOptions: {
                output: {
                    assetFileNames: () => 'trackswitch.min.css',
                },
            },
        },
    },
    esm: {
        build: {
            ...commonBuild,
            outDir: 'dist/esm',
            lib: {
                entry: {
                    index: resolve(rootDir, 'src/index.ts'),
                    element: resolve(rootDir, 'src/element.ts'),
                    react: resolve(rootDir, 'src/react.ts'),
                    vue: resolve(rootDir, 'src/vue.ts'),
                    svelte: resolve(rootDir, 'src/svelte.ts'),
                    interactive: resolve(rootDir, 'src/interactive.ts'),
                },
                formats: ['es'],
            },
            rollupOptions: {
                external: ['react', 'vue'],
                output: {
                    banner,
                    entryFileNames: '[name].js',
                    chunkFileNames: 'chunks/[name]-[hash].js',
                    assetFileNames: 'assets/[name]-[hash][extname]',
                },
            },
        },
    },
} satisfies Record<string, UserConfig>;

if (!Object.hasOwn(buildTargets, buildTarget)) {
    throw new Error('Unknown TRACKSWITCH_BUILD_TARGET: ' + buildTarget);
}

export default defineConfig(buildTargets[buildTarget as keyof typeof buildTargets]);
