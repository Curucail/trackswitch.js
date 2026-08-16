trackswitch
==============

[![npm version](https://img.shields.io/npm/v/trackswitch)](https://www.npmjs.com/package/trackswitch)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/demo-live-black)](https://audiolabs.github.io/trackswitch.js/)

**trackswitch** is a web-based player for exploring related music representations — audio recordings, MIDI, sheet music and analysis results — in one interface.

It is built on three concepts. **Timelines** are the coordinate systems of individual media, expressed in seconds, measures or ticks. **Markers** identify discrete positions on a timeline and are grouped into marker sequences, such as beats, measures or structural boundaries. **Alignments** pair markers on different timelines as anchors, and interpolate between them to project any position from one timeline onto another.

Audio can be heard in two ways: *comparative listening*, where one track sounds at a time and listeners switch between alternatives without interrupting playback, and *simultaneous listening*, where tracks sharing a timeline mix together. Performances on distinct timelines are compared rather than mixed, unless time-scale-modified renditions are supplied, which the Sync control then plays together.

Live Demo
-------------

- See what **trackswitch** can do on our demo website: https://audiolabs.github.io/trackswitch.js/

Installation
------------

Install from npm:

```bash
npm install trackswitch
```

Or download the browser bundle from GitHub Releases:

```text
trackswitch-release/
├── dist/
│   └── js/
│       └── trackswitch.js
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

Or build locally:

1. Clone Repo
2. `npm install`
3. `npm run build`

Quick Setup
-----------
Take a look at the [Tutorials & Use Cases](https://audiolabs.github.io/trackswitch.js/use-cases/) for complete, working configuration examples.

For further information on integrating the player into an ESM / React project, see [Documentation](https://audiolabs.github.io/trackswitch.js/documentation.html)

Features
-----------------

### Default Mode

- Multitrack audio playback
- Play, pause, stop, seek, and repeat controls
- Global volume control
- Looping controls
- Annotation marker navigation by previous/next or searchable sequence, ID, and label
- Per-track solo, volume, and pan controls
- Presets for common track combinations
- (Seekable) images and per-track images
- Interactive waveforms with zoom support and optional playback-follow modes
- Interactive Sheet music (musicxml) display with playback-following cursor
- Keyboard shortcuts

### Aligned timelines (Sync mode)

- Compare different performances of the same piece across their own timelines
- Every timeline related to one reference timeline through alignment anchors
- Marker sequences projected between timelines
- Optional synchronized playback for mixing performances together
- Alignment warping path and local tempo deviation visualizations

Programmatic API
----------------

`TrackSwitch.createDefaultTrackSwitch(rootElement, init)` and `TrackSwitch.createTrackSwitchSyncPlayer(rootElement, init)` return controllers for playback, seeking, looping, presets, and track state. This means that the player can be controlled by your application, independently from the end user.

Citation
--------

If you use trackswitch in scientific work, please cite:

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
