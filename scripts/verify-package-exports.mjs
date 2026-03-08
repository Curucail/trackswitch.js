import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const moduleEntry = await import('trackswitch');

if (typeof moduleEntry.createTrackSwitch !== 'function') {
  throw new Error('Package entrypoint does not expose createTrackSwitch.');
}

const cssPath = require.resolve('trackswitch/dist/css/trackswitch.min.css');
const browserBundlePath = require.resolve('trackswitch/dist/js/trackswitch.min.js');

if (!cssPath.endsWith('dist/css/trackswitch.min.css')) {
  throw new Error('CSS asset path does not resolve correctly.');
}

if (!browserBundlePath.endsWith('dist/js/trackswitch.min.js')) {
  throw new Error('Browser bundle path does not resolve correctly.');
}

const dom = new JSDOM('<!doctype html><div id="root"></div>');
const root = dom.window.document.getElementById('root');

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
globalThis.HTMLImageElement = dom.window.HTMLImageElement;

moduleEntry.createTrackSwitch(root, {
  ui: [
    {
      type: 'trackGroup',
      trackGroup: [
        {
          title: 'Track 1',
          sources: [{ src: 'track1.mp3' }],
        },
      ],
    },
  ],
});

console.log('package exports ok');
