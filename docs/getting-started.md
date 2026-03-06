---
title: trackswitch.js
---

# Getting Started

This page is for first-time users who want a working player quickly.

## Before you start

You need:

- A website where you can add HTML/JS
- Audio files (`.mp3` or `.wav`)
- A folder structure where your page can reach those files

Optional but recommended:

- A cover image (`.jpg` or `.png`)
- A waveform in the UI (helps users navigate long audio)

## Fastest setup

Install from npm:

```bash
npm install trackswitch
```

Then use this minimal player:

```html
<link rel="stylesheet" href="trackswitch.min.css" />
<div id="player"></div>
<script src="trackswitch.min.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  TrackSwitch.createTrackSwitch(document.getElementById('player'), {
    presetNames: ['All Tracks', 'Vocals'],
    ui: [
      { type: 'image', src: 'cover.jpg', seekable: true },
      { type: 'waveform', width: 1200, height: 150 },
      {
        type: 'trackGroup',
        trackGroup: [
          { title: 'Vocals', presets: [0, 1], sources: [{ src: 'vocals.mp3' }] },
          { title: 'Drums', presets: [0], sources: [{ src: 'drums.mp3' }] },
        ],
      },
    ],
    features: {
      mode: 'default',
      globalVolume: true,
      trackMixControls: true,
      looping: true,
      presets: true,
    },
  });
});
</script>
```

## Which mode should you use?

Use `features.mode: 'default'` when:

- You just want normal multitrack playback
- Tracks are already aligned in normal playback time

Use `features.mode: 'alignment'` when:

- You compare different performances/versions with timing differences
- You have a mapping CSV that links track timelines to one reference timeline

If you are unsure, start with `default`.

## Common first-time mistakes

1. The player does not appear.
Fix: make sure `ui` contains at least one `{ type: 'trackGroup', trackGroup: [...] }` with valid sources.

2. Audio does not play.
Fix: check file paths and browser console errors; each track needs at least one valid `sources[].src`.

3. Preset dropdown is missing.
Fix: you need at least 2 preset indices across tracks and `features.presets: true`.

4. Alignment mode fails to load.
Fix: in `alignment` mode, `alignment.csv`, `alignment.referenceTimeColumn`, and each track's `alignment.column` are required.

5. Cover image is not seekable.
Fix: set `seekable: true` on the `ui` image element you want to scrub on (for example `type: 'image'` or `type: 'perTrackImage'`). `perTrackImage` also requires `features.exclusiveSolo: true`.

## Where to go next

- Beginner-first walkthrough and examples: this page
- Full option reference: [configuration.md](configuration.md)
- Real-world usage scenarios: [examples.md](examples.md)
