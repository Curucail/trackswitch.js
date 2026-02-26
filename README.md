trackswitch.js
==============

[![Screenshot](/examples/screenshot.png)](https://audiolabs.github.io/trackswitch.js/)

Installation
------------

This tool can be installed using

    npm install trackswitch

alternatively you can manually download and include [`dist/css/trackswitch.min.css`](https://raw.githubusercontent.com/audiolabs/trackswitch.js/gh-pages/dist/css/trackswitch.min.css) and
[`dist/js/trackswitch.min.js`](https://raw.githubusercontent.com/audiolabs/trackswitch.js/gh-pages/dist/js/trackswitch.min.js).

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
    ui: {
      images: [
        {
          src: 'mix.png',
          seekable: true,
          style: 'margin: 20px auto;',
        },
      ],
      waveforms: [
        {
          width: 1200,
          height: 150,
        },
      ],
    },
  });
});
</script>
```

Breaking migration notes:

- Old jQuery plugin initialization: `$('.player').trackSwitch()` becomes `TrackSwitch.createTrackSwitch(playerElement, init)`.
- Declarative `<ts-track>`, `<ts-source>`, and `preset-names` markup are no longer supported.
- `init.tracks` is required and must contain at least one track.

Errors thrown by the JS-only migration:

```text
TrackSwitch JS-only mode requires init.tracks with at least one track.
```

```text
Declarative markup has been removed. Remove `preset-names`, `<ts-track>`, and `<ts-source>` markup and pass all track data via TrackSwitch.createTrackSwitch(rootElement, init).
```


## Whats included

    dist/
    ├── css/
    │   ├── trackswitch.min.css
    └── js/
        ├── trackswitch.js
        └── trackswitch.min.js


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


Examples
--------

### Configuration

See [configuration examples](https://audiolabs.github.io/trackswitch.js/configuration.html).

### Usage scenarios

See [examples](https://audiolabs.github.io/trackswitch.js/examples.html).


Keyboard Shortcuts
------------------

trackswitch.js includes comprehensive keyboard shortcuts for controlling playback.

### Playback Controls
- **Space** - Play / Pause
- **Escape** - Stop playback and reset to beginning
- **R** - Toggle repeat mode

### Seeking
- **← / →** - Seek backward/forward 2 seconds
- **Shift + ← / →** - Seek backward/forward 5 seconds
- **Home** - Jump to start

### Volume
- **↑ / ↓** - Increase/decrease volume by 10% (when `globalvolume` is enabled)

When multiple players exist on a page, the last-clicked player receives keyboard input.


Development
-----------

    npm install
    npm run build

This will bundle TypeScript and minify CSS/JS into the `dist/` folder.

### Build Scripts

- `npm run build` - Full build (clean, compile, minify)
- `npm run build:css` - Compile and minify CSS only
- `npm run build:js` - Bundle and minify JS only
- `npm run clean` - Remove `dist/` folder
