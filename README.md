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
      },
    ],
    features: {
      mode: 'default',
      globalvolume: true,
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
- `toggleMute`, `toggleSolo`, `applyPreset`
- `getState`, `on`, `off`

Events:

- `loaded` -> `{ longestDuration }`
- `error` -> `{ message }`
- `position` -> `{ position, duration }`
- `trackState` -> `{ index, state: { mute, solo } }`

`getState()` returns player loading/playback state, feature flags, and per-track `mute`/`solo` state.

When `features.globalsolo` is enabled, starting playback in one player pauses other players on the page.

Alignment Modes
---------------

`features.mode` supports:

- `default` (existing behavior)
- `alignment_solo` (reference timeline + one active solo track at a time)
- `alignment_multi` (normal multitrack playback; tracks are expected to be pre-synchronized externally)

`alignment_solo` requires:

- `features.onlyradiosolo: true`
- `alignment` config with:
  - `csv: string`
  - `mappings: Array<{ trackIndex: number; column: string }>` (must cover all tracks)
  - `outOfRange?: 'clamp' | 'linear'` (default `clamp`)

Alignment mode behavior:

- In `alignment_solo`, the longest track is used as the reference timeline axis
- `seekTo`/seekbar/timer/`position` events stay on reference time in `alignment_solo`
- `alignment_solo`: switching solo track remaps position and restarts playback on the newly active track timeline
- `alignment_multi`: playback behavior is the same as `default`; no alignment CSV mapping or in-engine stretching/pitch shifting is applied

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
- `↑ / ↓` - Increase / decrease volume by 10% (when `globalvolume` is enabled)
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
