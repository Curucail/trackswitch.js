import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const pythonRuntimeAssets = [
	{
		source: "synctoolbox-dist/synctoolbox-1.4.2-py3-none-any.whl",
		dist: "dist/js/synctoolbox-1.4.2-py3-none-any.whl",
		docs: "docs/js/synctoolbox-1.4.2-py3-none-any.whl",
	},
];

export const runtimeAssets = [];

export const docsAssets = [
	{
		source: "dist/js/trackswitch-player.js",
		docs: "docs/js/trackswitch-player.js",
	},
	{
		source: "dist/js/trackswitch-alignment-player.js",
		docs: "docs/js/trackswitch-alignment-player.js",
	},
	{
		source: "dist/css/trackswitch.min.css",
		docs: "docs/css/trackswitch.min.css",
	},
	{
		source: "dist/js/trackswitch-alignment-interactive.js",
		docs: "docs/js/trackswitch-alignment-interactive.js",
	},
	{
		source: "dist/js/trackswitch-interactive-worker.js",
		docs: "docs/js/trackswitch-interactive-worker.js",
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
		source: "examples/default/data",
		docs: "docs/assets/multitracks",
	},
	{
		source: "examples/alignment/data",
		docs: "docs/assets/alignment",
	},
];

export function fromRoot(path) {
	return resolve(rootDir, path);
}
