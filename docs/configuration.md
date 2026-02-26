---
title: trackswitch.js
---

- [Breaking Change: Declarative Markup Removed](#breaking-change-declarative-markup-removed)
- [Initialization](#initialization)
- [Configuration](#configuration)
  - [Tracks](#tracks)
  - [Track Properties](#track-properties)
  - [Presets](#presets)
  - [UI Elements](#ui-elements)
  - [Player Features](#player-features)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Loop/Section Repeat](#loopsection-repeat)

# Breaking Change: Declarative Markup Removed

trackswitch.js is now **JS-only** for track/preset setup.

- `<ts-track>` and `<ts-source>` are no longer supported.
- `preset-names` markup is no longer supported.
- You must pass `tracks` (and optional `presetNames`, `features`, `ui`) to `TrackSwitch.createTrackSwitch(...)`.

If legacy markup is detected, trackswitch throws:

```text
Declarative markup has been removed. Remove `preset-names`, `<ts-track>`, and `<ts-source>` markup and pass all track data via TrackSwitch.createTrackSwitch(rootElement, init).
```

If `tracks` is missing or empty, trackswitch throws:

```text
TrackSwitch JS-only mode requires init.tracks with at least one track.
```

# Initialization

Include Font Awesome, trackswitch CSS/JS, and provide a minimal mount node:

```html
<link href="https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css" rel="stylesheet" />
<link rel="stylesheet" href="trackswitch.min.css" />

<div id="player"></div>

<script src="trackswitch.min.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
    TrackSwitch.createTrackSwitch(document.getElementById('player'), {
        tracks: [
            {
                title: 'Violins',
                image: 'violins.png',
                sources: [{ src: 'violins.mp3', type: 'audio/mpeg' }],
            },
            {
                title: 'Synth',
                image: 'synth.png',
                sources: [{ src: 'synth.mp3', type: 'audio/mpeg' }],
            },
            {
                title: 'Bass',
                image: 'bass.png',
                sources: [{ src: 'bass.mp3', type: 'audio/mpeg' }],
            },
            {
                title: 'Drums',
                image: 'drums.png',
                sources: [{ src: 'drums.mp3', type: 'audio/mpeg' }],
            },
        ],
        ui: [
            {
                type: 'image',
                src: 'mix.png',
                seekable: true,
                style: 'margin: 16px auto;',
            },
            {
                type: 'waveform',
                width: 1200,
                height: 150,
                style: 'margin: 16px auto;',
            },
        ],
    });
});
</script>
```

Migration (breaking): the legacy initialization call still changes from jQuery to `TrackSwitch.createTrackSwitch(playerElement, init)`, but now `init.tracks` is required.

# Configuration

## Tracks

`tracks` is required and contains one object per stem.

```javascript
const init = {
    tracks: [
        {
            title: 'Violins',
            sources: [{ src: 'violins.mp3' }],
        },
        {
            title: 'Synth',
            sources: [{ src: 'synth.mp3' }],
        },
        {
            title: 'Bass',
            sources: [{ src: 'bass.mp3' }],
        },
        {
            title: 'Drums',
            sources: [{ src: 'drums.mp3' }],
        },
    ],
};
```

Each track requires at least one source:

```javascript
{
  title: 'Track name',
  sources: [
    { src: 'track.mp3', type: 'audio/mpeg' },
    { src: 'track.mp4', type: 'audio/mp4' },
  ],
}
```

## Track Properties

Per-track options:

- `id` (`string`)
- `title` (`string`)
- `muted` (`boolean`) - initial mute state
- `solo` (`boolean`) - initial solo state
- `image` (`string`) - poster image used when this track is the only soloed track
- `style` (`string`) - inline style for the rendered track row
- `presets` (`number[]`) - preset membership indices
- `sources` (`TrackSourceDefinition[]`) - audio sources (required)

Per-source options:

- `src` (`string`) - required
- `type` (`string`) - optional MIME type
- `startOffsetMs` (`number`) - positive trims start, negative pads start with silence
- `endOffsetMs` (`number`) - positive trims end, negative pads end with silence

Example with styling and offsets:

```javascript
TrackSwitch.createTrackSwitch(playerElement, {
    tracks: [
        {
            title: 'Violins',
            style: 'background-color: #156090;',
            solo: true,
            sources: [{ src: 'violins.mp3', startOffsetMs: -250 }],
        },
        {
            title: 'Synth',
            style: 'background-color: #15737D;',
            sources: [{ src: 'synth.mp3', startOffsetMs: 120, endOffsetMs: 80 }],
        },
        {
            title: 'Bass',
            style: 'background-color: #158769;',
            muted: true,
            sources: [{ src: 'bass.mp3' }],
        },
        {
            title: 'Drums',
            style: 'background-color: #159858;',
            muted: true,
            sources: [{ src: 'drums.mp3' }],
        },
    ],
});
```

## Presets

Use `presetNames` together with per-track `presets` arrays.

```javascript
TrackSwitch.createTrackSwitch(playerElement, {
    presetNames: ['All Tracks', 'Violins & Synths', 'Drums & Bass', 'Drums Only'],
    tracks: [
        { title: 'Violins', presets: [0, 1], sources: [{ src: 'violins.mp3' }] },
        { title: 'Synths', presets: [0, 1], sources: [{ src: 'synth.mp3' }] },
        { title: 'Bass', presets: [0, 2], sources: [{ src: 'bass.mp3' }] },
        { title: 'Drums', presets: [0, 2, 3], sources: [{ src: 'drums.mp3' }] },
    ],
});
```

Preset rules:

- Preset indices are 0-indexed.
- Preset count is derived from the highest index used by tracks.
- If a name is missing, a fallback like `Preset 2` is used.
- Extra names beyond derived count are ignored.
- Preset `0` is auto-applied during initialization when presets exist.
- Selecting a preset sets solo states by membership and clears all mute states.
- The preset dropdown appears only when at least 2 presets exist and `features.presets` is `true`.

## UI Elements

Use `ui` for non-track visual elements so HTML can stay minimal.
`ui` is an ordered array, so element order in the array is the rendered order.

### Seekable / Non-Seekable Images

```javascript
TrackSwitch.createTrackSwitch(playerElement, {
    tracks: tracks,
    ui: [
        {
            type: 'image',
            src: 'mix.png',
            seekable: true,
            seekMarginLeft: 10,
            seekMarginRight: 10,
        },
        {
            type: 'image',
            src: 'cover.jpg',
        },
    ],
});
```

Image UI rules:

- At most one image may set `seekable: true`.
- More than one seekable image throws: `TrackSwitch UI config supports at most one seekable image.`

### Waveform Canvases

```javascript
TrackSwitch.createTrackSwitch(playerElement, {
    tracks: tracks,
    ui: [
        {
            type: 'waveform',
            width: 1200,
            height: 200,
            waveformBarWidth: 2,
            style: 'margin: 20px auto; max-width: 1000px;',
            seekMarginLeft: 3,
            seekMarginRight: 3,
        },
        {
            type: 'waveform',
            width: 1200,
            height: 110,
            waveformBarWidth: 5,
            style: 'margin: 10px auto; max-width: 1000px;',
        },
    ],
});
```

Waveform UI rules:

- Defaults: `width: 1200`, `height: 150`.
- Default `waveformBarWidth` is `1`.
- Use `ui` array entries with `type: 'waveform'`.
- Providing at least one waveform entry in `ui` implicitly enables waveform rendering.
- Invalid or `< 1` `waveformBarWidth` is reset to `1`.

## Player Features

Configure behavior with `features`:

```javascript
TrackSwitch.createTrackSwitch(playerElement, {
    tracks: tracks,
    features: {
        mute: true,
        solo: true,
        globalsolo: true,
        globalvolume: false,
        repeat: false,
        radiosolo: false,
        onlyradiosolo: false,
        tabview: false,
        iosunmute: true,
        keyboard: true,
        looping: true,
        seekbar: true,
        timer: true,
        presets: true,
        waveform: true,
    },
});
```

Defaults:

- `mute`: `true`
- `solo`: `true`
- `globalsolo`: `true`
- `globalvolume`: `false`
- `repeat`: `false`
- `radiosolo`: `false`
- `onlyradiosolo`: `false`
- `tabview`: `false`
- `iosunmute`: `true`
- `keyboard`: `true`
- `looping`: `false`
- `seekbar`: `true`
- `timer`: `true`
- `presets`: `true`
- `waveform`: `true`

Normalization rules:

- If both `mute` and `solo` are false, `solo` is forced to true.
- `onlyradiosolo: true` forces `mute: false` and `radiosolo: true`.
- `radiosolo` or `onlyradiosolo` forces `presets: false`.
- `ui` forces `waveform: true` when at least one waveform element is configured.

## Keyboard Shortcuts

When `features.keyboard` is enabled:

- `Space` - play/pause
- `Escape` - stop and reset position
- `R` - toggle repeat
- `ArrowLeft` / `ArrowRight` - seek -/+ 2s
- `Shift + ArrowLeft` / `Shift + ArrowRight` - seek -/+ 5s
- `Home` - jump to start
- `ArrowUp` / `ArrowDown` - adjust volume (when `globalvolume` is enabled)

Loop shortcuts (when `features.looping` is enabled):

- `A` - set loop point A
- `B` - set loop point B
- `L` - toggle loop
- `C` - clear loop

Keyboard input is scoped to the last interacted player instance.

## Loop/Section Repeat

When `features.looping` is enabled, you can define loop regions via:

1. Keyboard (`A`, `B`, `L`, `C`)
2. Loop buttons in the control bar
3. Right-click drag on seekbar, seekable image, or waveform

Behavior:

- A minimum A/B distance of 100ms is enforced.
- Active loop regions are shown visually.
- Looping takes precedence over full-track repeat.
- Keyboard seeks wrap within active loop boundaries.
