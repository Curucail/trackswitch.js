import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const rootDir = __dirname;
const buildTarget = process.env.TRACKSWITCH_BUILD_TARGET || 'browser';

const banner = [
    '/*!',
    ' * trackswitch.js (https://github.com/audiolabs/trackswitch.js)',
    ' * Copyright 2026 International Audio Laboratories Erlangen',
    ' * Licensed under MIT (https://github.com/audiolabs/trackswitch.js/blob/master/LICENSE)',
    ' */',
].join('\n');

export default defineConfig({
    build: buildTarget === 'esm'
        ? {
            outDir: 'dist/esm',
            emptyOutDir: false,
            target: 'es2017',
            sourcemap: false,
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
        }
        : buildTarget === 'interactive'
            ? {
                outDir: 'dist/js',
                emptyOutDir: false,
                target: 'es2017',
                sourcemap: false,
                lib: {
                    entry: resolve(rootDir, 'src/interactive-browser.ts'),
                    name: 'TrackSwitchInteractive',
                    formats: ['iife'],
                    fileName: () => 'trackswitch-interactive.js',
                },
                rollupOptions: {
                    output: {
                        banner,
                        inlineDynamicImports: true,
                    },
                },
            }
            : buildTarget === 'worker'
                ? {
                    outDir: 'dist/js',
                    emptyOutDir: false,
                    target: 'es2017',
                    sourcemap: false,
                    lib: {
                        entry: resolve(rootDir, 'src/interactive/worker/alignment-worker.ts'),
                        name: 'TrackSwitchAlignmentWorker',
                        formats: ['iife'],
                        fileName: () => 'trackswitch-alignment-worker.js',
                    },
                    rollupOptions: {
                        output: {
                            banner,
                            inlineDynamicImports: true,
                        },
                    },
                }
                : buildTarget === 'css'
                    ? {
                        outDir: 'dist/css',
                        emptyOutDir: false,
                        target: 'es2017',
                        sourcemap: false,
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
                    }
        : {
            outDir: 'dist',
            emptyOutDir: false,
            target: 'es2017',
            sourcemap: false,
            assetsInlineLimit: Number.MAX_SAFE_INTEGER,
            lib: {
                entry: resolve(rootDir, 'src/browser.ts'),
                name: 'TrackSwitch',
                formats: ['iife'],
                fileName: () => 'trackswitch.js',
            },
            rollupOptions: {
                output: {
                    banner,
                    inlineDynamicImports: true,
                },
            },
        },
});
