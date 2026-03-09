trackswitch.js
==============

[![Screenshot](/examples/screenshot.png)](https://audiolabs.github.io/trackswitch.js/)

Installation
------------

Install from npm:

    npm install trackswitch

ESM / TypeScript usage:

```ts
import { createTrackSwitch, type TrackSwitchInit } from 'trackswitch';
import 'trackswitch/dist/css/trackswitch.min.css';

const init: TrackSwitchInit = {
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
};

createTrackSwitch(document.getElementById('player')!, init);
```

Browser script-tag usage:

- `dist/css/trackswitch.min.css`
- `dist/js/trackswitch.min.js`

Initialization
--------------

```html
<link rel="stylesheet" href="dist/css/trackswitch.min.css">
<div id="player"></div>
<script src="dist/js/trackswitch.min.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  TrackSwitch.createTrackSwitch(document.getElementById('player'), {
    presetNames: ['All Tracks', 'Violins & Synths', 'Drums & Bass', 'Drums Only'],
    ui: [
      {
        type: 'image',
        src: 'mix.png',
        seekable: true,
        style: 'margin: 20px auto;',
      },
      {
        type: 'waveform',
        width: 1200,
        height: 150,
        maxZoom: 5, // optional minimum visible window in seconds
        waveformSource: 'audible', // or a track index (e.g. 1) for a fixed track waveform
      },
      {
        type: 'trackGroup',
        rowHeight: 44, // optional per-group track row min-height in px
        trackGroup: [
          {
            title: 'Violins',
            volume: 0.9, // optional per-track volume (0..1)
            pan: -0.2, // optional per-track pan (-1..1)
            image: 'violins.png',
            presets: [0, 1],
            sources: [{ src: 'violins.mp3', type: 'audio/mpeg' }],
          },
          {
            title: 'Synths',
            image: 'synth.png',
            presets: [0, 1],
            sources: [{ src: 'synth.mp3', type: 'audio/mpeg' }],
          },
          {
            title: 'Bass',
            image: 'bass.png',
            presets: [0, 2],
            sources: [{ src: 'bass.mp3', type: 'audio/mpeg' }],
          },
          {
            title: 'Drums',
            image: 'drums.png',
            presets: [0, 2, 3],
            sources: [{ src: 'drums.mp3', type: 'audio/mpeg' }],
          },
        ],
      },
      {
        type: 'sheetMusic',
        src: 'score.musicxml',
        measureCsv: 'score_measures.csv',
        maxWidth: 960,
        renderScale: 0.75,
        maxHeight: 360,
        followPlayback: true,
        cursorColor: '#999999',
        cursorAlpha: 0.1,
      },
      {
        type: 'warpingMatrix',
        height: 240,
        globalScoreBPM: 60,
      },
    ],
    features: {
      mode: 'default',
      globalVolume: true,
      trackMixControls: true, // optional per-track volume/pan sliders in track rows
      looping: true,
      presets: true,
    },
  });
});
</script>
```

Programmatic API
----------------

`TrackSwitch.createTrackSwitch(rootElement, init)` returns a controller.

Main methods:

- `load`, `destroy`
- `togglePlay`, `play`, `pause`, `stop`
- `seekTo`, `seekRelative`
- `setRepeat`, `setVolume`, `setTrackVolume`, `setTrackPan`
- `setLoopPoint`, `toggleLoop`, `clearLoop`
- `toggleSolo`, `applyPreset`
- `getState`, `on`, `off`

Events:

- `loaded` -> `{ longestDuration }`
- `error` -> `{ message }`
- `position` -> `{ position, duration }`
- `trackState` -> `{ index, state: { solo, volume, pan } }`

`getState()` returns player loading/playback state, feature flags, and per-track `solo`/`volume`/`pan` state.
Track pan uses Web Audio `StereoPannerNode` (equal-power panning law) when supported.

When `features.muteOtherPlayerInstances` is enabled, starting playback in one player pauses other players on the page.

Alignment Modes
---------------

`features.mode` supports:

- `default` (existing behavior)
- `alignment` (reference timeline + one active solo track at a time)

`alignment` requires:

- `alignment` config with:
  - `csv: string`
  - `referenceTimeColumn: string` (CSV column used as the reference time axis; can be an abstract axis such as seconds or measures)
  - `outOfRange?: 'clamp' | 'linear'` (default `clamp`)
- per-track alignment columns on `tracks[*].alignment.column`
  - optional `tracks[*].alignment.synchronizedSources` enables the global `SYNC` control in the main bar

Alignment mode behavior:

- In `alignment`, the configured `referenceTimeColumn` defines the reference timeline axis
- In `alignment`, timeline duration is derived from the maximum value in `referenceTimeColumn`
- `seekTo`/seekbar/timer/`position` events stay on reference time in `alignment`
- `alignment` starts with `SYNC` off and single-track solo behavior (`features.exclusiveSolo`) enforced automatically
- `alignment`: switching solo track remaps position and restarts playback on the newly active track timeline
- `alignment`: enabling global `SYNC` allows multi-track listening again, switches synced tracks to synchronized sources, and locks non-synced tracks muted
- `alignment`: with `SYNC` off, fixed waveforms (`waveformSource: <trackIndex>`) render on their native track timeline and their waveform seek overlays (playhead + loop markers/region) use that same local axis; interactions are converted to reference time internally
- `alignment`: with `SYNC` on, synced-track timeline mapping is bypassed (identity) and fixed waveforms return to shared reference-axis behavior
- `alignment`: waveform containers show a top-right timer badge in `current / duration` format; fixed-source waveforms use the track-local axis when `SYNC` is off
- `alignment`: optional `sheetMusic` UI entries render MusicXML via OpenSheetMusicDisplay and highlight the currently mapped measure using a measure-cursor overlay
- `alignment`: clicking a rendered sheet-music measure seeks playback to that measure start on the reference timeline (resolved from `measureCsv`)
- `alignment`: `sheetMusic` supports optional `maxWidth` (container max-width px), `renderScale` (OSMD zoom), and `maxHeight` (px) for internal score scrolling
- `alignment`: `sheetMusic` supports optional `followPlayback` (default `true`) to auto-scroll vertically and keep the current highlighted measure in view
- `alignment`: optional `warpingMatrix` UI entries render two linked panels: the warping-path graph plus a local-tempo graph
- `alignment`: the tempo panel enforces a strictly monotonic warping path, fills gaps by linear interpolation on the reference-time frame grid, computes frame-wise beat-duration ratios, smooths them with a Hann window, and converts the result back to tempo percent with `100` meaning equal local speed to the reference
- `alignment`: the tempo panel uses a fixed logarithmic y-axis from `10` to `1000`, keeps the dashed `y = 100` reference line and centered vertical playhead guide, and continues to use active-track time on the x-axis with an adjustable moving window
- `alignment`: if `warpingMatrix.globalScoreBPM` is set, the tempo plot shows BPM ticks on the left and percent ticks on the right; if it is not set, the player tries to derive BPM from the first loaded `sheetMusic` score and otherwise falls back to percent-only labels
- `alignment`: the tempo panel renders one active-track curve with configurable smoothing half-window `k` (default `5`), supports click-to-seek, hides the curve and shows `Warping path cannot be made strictly monotonous` when no usable strict path can be derived, and switches to a visible dimmed non-interactive state while global `SYNC` is enabled
- Waveform zoom is configured per waveform via `maxZoom`, expressed as the minimum visible window in seconds (for example `5` or `0.5`); wheel/pinch zoom is enabled only when the active waveform duration exceeds that value

Examples
--------

### Configuration

See [configuration examples](https://audiolabs.github.io/trackswitch.js/configuration.html).

### Usage scenarios

See [examples](https://audiolabs.github.io/trackswitch.js/examples.html).

Maintenance
-----------

Useful repo maintenance checks:

- `npm run audit:dead` - unused exports and files in the library source
- `npm run audit:dup` - duplicated TypeScript and CSS blocks
- `npm run audit:smells` - structural code smells in `src/`
- `npm run audit:css` - CSS selectors that are not referenced by the player code
- `npm run audit` - run the full audit suite

The CSS audit writes a JSON report to `node_modules/.cache/trackswitch-css-audit.json`.

Keyboard Shortcuts
------------------

- `F1` - Open or close the keyboard shortcut help overlay
- `Space` - Play / Pause
- `Escape` - Stop and reset position
- `R` - Toggle repeat
- `← / →` - Seek backward / forward 2 seconds
- `Shift + ← / →` - Seek backward / forward 5 seconds
- `Home` - Jump to start
- `↑ / ↓` - Increase / decrease volume by 10% (when `globalVolume` is enabled)
- `A` - Set loop point A (when `looping` is enabled)
- `B` - Set loop point B (when `looping` is enabled)
- `L` - Toggle loop (when `looping` is enabled)
- `C` - Clear loop points (when `looping` is enabled)

When multiple players exist on a page, the last-clicked player receives keyboard input.
The `F1` help overlay only lists shortcuts that apply to the current player configuration.

Whats included
--------------

    dist/
    ├── css/
    │   └── trackswitch.min.css
    └── js/
        ├── trackswitch.js
        └── trackswitch.min.js

Development
-----------

    npm install
    npm run build

Build scripts:

- `npm run build` - Full build (clean, compile, minify)
- `npm run build:css` - Compile and minify CSS only
- `npm run build:js` - Build the ESM package entry and browser bundles
- `npm run build:types` - Generate `.d.ts` files for the package entry
- `npm run clean` - Remove `dist/` folder

Citation
--------

If you use this software in a scientific publication, please make sure to cite the following publication

Werner, Nils, et al. **"trackswitch.js: A Versatile Web-Based Audio Player for Presenting Scientific Results."** 3rd web audio conference, London, UK. 2017.

    @inproceedings{werner2017trackswitchjs,
      title={trackswitch.js: A Versatile Web-Based Audio Player for Presenting Scientific Results},
      author={Nils Werner and Stefan Balke and Fabian-Rober Stöter and Meinard Müller and Bernd Edler},
      booktitle={3rd web audio conference, London, UK},
      year={2017},
      organization={Citeseer}
    }
