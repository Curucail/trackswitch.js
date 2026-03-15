trackswitch.js
==============

[![npm version](https://img.shields.io/npm/v/trackswitch)](https://www.npmjs.com/package/trackswitch)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/demo-live-black)](https://audiolabs.github.io/trackswitch.js/)

**trackswitch.js** is a web-based multitrack audio player for presenting scientific results. It supports playing multiple audio files simultaneously, enabling users to mix multiple tracks to their liking. 

In Alignment mode, users can listen to different performances of the same musical piece, which are synchronized to a reference timeline such that they can be compared side-by-side. Additionally, sheet music can be rendered and used to seek through the performances by clicking on individual measures.
In the optional "Sync" mode, performances can be listened to simultaneously (synchronized audio files for each performance have to be configured before, e.g. by using a time-scale modification algorithm). 

Live Demo
-------------

- See what **trackswitch.js** can do on our demo website: https://audiolabs.github.io/trackswitch.js/

Screenshots
-----------
### Default Mode
[![Screenshot](examples/default/screenshot.png)](https://audiolabs.github.io/trackswitch.js/)
### Alignment Mode
[![Screenshot](examples/alignment/screenshot.png)](https://audiolabs.github.io/trackswitch.js/)




Installation
------------

Install from npm:

```bash
npm install trackswitch
```

Or download directly from Github Releases:

```text
dist/
├── css/
│   └── trackswitch.min.css
├── js/
    └── trackswitch.min.js
```

Or build locally:

1. Clone Repo
2. `npm install`
3. `npm run build`

Quick Setup
-----------

### From ESM / TypeScript project

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

### From HTML

```html
<link rel="stylesheet" href="dist/css/trackswitch.min.css">
<script src="dist/js/trackswitch.min.js"></script>
<div id="player"></div>

<script>
document.addEventListener('DOMContentLoaded', function () {
  TrackSwitch.createTrackSwitch(document.getElementById('player'), {
    ui: [
      {
        type: 'trackGroup',
        trackGroup: [
          {
            title: 'Track 1',
            sources: [{ src: 'track1.mp3', type: 'audio/mpeg' }],
          },
        ],
      },
    ],
  });
});
</script>
```

Take a look into the ```examples/``` folder for minimal working templates.

Features
-----------------

### Default Mode

- Multitrack audio playback
- Play, pause, stop, seek, and repeat controls
- Global volume control
- Looping controls
- Per-track solo, volume, and pan controls
- Presets for common track combinations
- (Seekable) images and per-track images
- Interactive waveforms with zoom support and optional playback-follow modes
- Interactive Sheet music (musicxml) display with playback-following cursor
- Keyboard shortcuts

### Alignment mode

- Compare different performances of the same piece
- Different timelines for each track synchronized to a shared reference timeline
- Optional sync mode for mixing synchronized performances together
- Alignment warping path and local tempo deviation visualizations

Programmatic API
----------------

`TrackSwitch.createTrackSwitch(rootElement, init)` returns a controller for playback, seeking, looping, presets, and track state. This means that the player can be controlled by your application, independently from the end user.

Further Links
-------------
- [Documentation](https://audiolabs.github.io/trackswitch.js/configuration.html)
- [Example usages](https://audiolabs.github.io/trackswitch.js/examples.html)


Citation
--------

If you use trackswitch.js in scientific work, please cite:

Werner, Nils, et al. **"trackswitch.js: A Versatile Web-Based Audio Player for Presenting Scientific Results."** 3rd Web Audio Conference, London, UK. 2017.

```bibtex
@inproceedings{werner2017trackswitchjs,
  title={trackswitch.js: A Versatile Web-Based Audio Player for Presenting Scientific Results},
  author={Nils Werner and Stefan Balke and Fabian-Rober Stöter and Meinard Müller and Bernd Edler},
  booktitle={3rd web audio conference, London, UK},
  year={2017},
  organization={Citeseer}
}
```
