trackswitch.js
==============

[![Screenshot](/examples/screenshot.png)](https://audiolabs.github.io/trackswitch.js/)

Installation
------------

Install from npm:

    npm install trackswitch

For manual usage, include:

- `dist/css/trackswitch.min.css`
- `dist/js/trackswitch.min.js`

Initialization
--------------

```html
<div id="player"></div>
<script src="dist/js/trackswitch.min.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  TrackSwitch.createTrackSwitch(document.getElementById('player'), {
    presetNames: ['All Tracks', 'Violins & Synths', 'Drums & Bass', 'Drums Only'],
    tracks: [
      {
        title: 'Violins',
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
        maxZoom: '2000%', // optional per-waveform zoom cap (20x)
        waveformSource: 'audible', // or a track index (e.g. 1) for a fixed track waveform
      },
      {
        type: 'sheetmusic',
        src: 'score.musicxml',
        measureCsv: 'score_measures.csv',
        maxWidth: 960,
        renderScale: 0.75,
        maxHeight: 360,
        followPlayback: true,
        cursorColor: '#999999',
        cursorAlpha: 0.1,
      },
    ],
    features: {
      mode: 'default',
      globalVolume: true,
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
- `setRepeat`, `setVolume`
- `setLoopPoint`, `toggleLoop`, `clearLoop`
- `toggleSolo`, `applyPreset`
- `getState`, `on`, `off`

Events:

- `loaded` -> `{ longestDuration }`
- `error` -> `{ message }`
- `position` -> `{ position, duration }`
- `trackState` -> `{ index, state: { solo } }`

`getState()` returns player loading/playback state, feature flags, and per-track `solo` state.

When `features.muteOtherPlayerInstances` is enabled, starting playback in one player pauses other players on the page.

Alignment Modes
---------------

`features.mode` supports:

- `default` (existing behavior)
- `alignment` (reference timeline + one active solo track at a time)

`alignment` requires:

- `alignment` config with:
  - `csv: string`
  - `referenceTimeColumn?: string` (optional CSV column to use as the reference time axis)
  - `outOfRange?: 'clamp' | 'linear'` (default `clamp`)
- per-track alignment columns on `tracks[*].alignment.column`
  - optional `tracks[*].alignment.synchronizedSources` enables the global `SYNC` control in the main bar

Alignment mode behavior:

- In `alignment`, the longest track is used as the reference timeline axis
- `seekTo`/seekbar/timer/`position` events stay on reference time in `alignment`
- `alignment` starts with `SYNC` off and single-track solo behavior (`features.radiosolo`) enforced automatically
- `alignment`: switching solo track remaps position and restarts playback on the newly active track timeline
- `alignment`: enabling global `SYNC` allows multi-track listening again, switches synced tracks to synchronized sources, and locks non-synced tracks muted
- `alignment`: with `SYNC` off, fixed waveforms (`waveformSource: <trackIndex>`) render on their native track timeline and their waveform seek overlays (playhead + loop markers/region) use that same local axis; interactions are converted to reference time internally
- `alignment`: with `SYNC` on, synced-track timeline mapping is bypassed (identity) and fixed waveforms return to shared reference-axis behavior
- `alignment`: waveform containers show a top-right timer badge in `current / duration` format; fixed-source waveforms use the track-local axis when `SYNC` is off
- `alignment`: optional `sheetmusic` UI entries render MusicXML via OpenSheetMusicDisplay and highlight the currently mapped measure using a measure-cursor overlay
- `alignment`: clicking a rendered sheet-music measure seeks playback to that measure start on the reference timeline (resolved from `measureCsv`)
- `alignment`: `sheetmusic` supports optional `maxWidth` (container max-width px), `renderScale` (OSMD zoom), and `maxHeight` (px) for internal score scrolling
- `alignment`: `sheetmusic` supports optional `followPlayback` (default `true`) to auto-scroll vertically and keep the current highlighted measure in view
- Waveform zoom is configured per waveform via `maxZoom`; wheel/pinch zoom is enabled only when `maxZoom > 1` (or `> '100%'`)

Legacy note:

- `alignment.mappings` is still accepted when no track provides `alignment.column`

Examples
--------

### Configuration

See [configuration examples](https://audiolabs.github.io/trackswitch.js/configuration.html).

### Usage scenarios

See [examples](https://audiolabs.github.io/trackswitch.js/examples.html).

Keyboard Shortcuts
------------------

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
- `npm run build:js` - Bundle and minify JS only
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
