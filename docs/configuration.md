---
title: trackswitch.js
---

- [Quick Start](#quick-start)
- [Configuration Shape](#configuration-shape)
- [Initialization Requirements](#initialization-requirements)
- [Top-Level Options](#top-level-options)
- [UI Elements](#ui-elements)
  - [Track Group and Track Options](#track-group-and-track-options)
  - [Image UI Element](#image-ui-element)
  - [Waveform UI Element](#waveform-ui-element)
  - [Sheet Music UI Element](#sheet-music-ui-element)
  - [Warping Matrix UI Element](#warping-matrix-ui-element)
- [Features](#features)
- [Alignment Mode](#alignment-mode)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Looping Behavior](#looping-behavior)
- [Programmatic API](#programmatic-api)
- [Utility Exports](#utility-exports)
- [Validation and Common Errors](#validation-and-common-errors)

# Quick Start

If you are new to trackswitch.js, use this as a starting point:

```javascript
TrackSwitch.createTrackSwitch(rootElement, {
  presetNames: ['All Tracks', 'Vocals'],
  ui: [
    { type: 'image', src: 'cover.jpg', seekable: true },
    { type: 'waveform', width: 1200, height: 150 },
    {
      type: 'trackGroup',
      rowHeight: 44,
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
```

For a non-technical walkthrough, see [getting-started.md](getting-started.md).

# Configuration Shape

```javascript
TrackSwitch.createTrackSwitch(rootElement, {
  presetNames: ['All Tracks', 'Preset 1'],
  ui: [
    { type: 'image', src: 'cover.jpg', seekable: true },
    { type: 'waveform', width: 1200, height: 150 },
    {
      type: 'trackGroup',
      rowHeight: 40,
      trackGroup: [
        {
          title: 'Track 1',
          presets: [0, 1],
          sources: [{ src: 'track1.mp3' }],
          alignment: {
            column: 't1_sec',
            synchronizedSources: [{ src: 'track1_synced.mp3' }],
          },
        },
      ],
    },
    {
      type: 'sheetMusic',
      src: 'score.musicxml',
      measureCsv: 'score_measures.csv',
    },
    { type: 'warpingMatrix', height: 240 },
  ],
  alignment: {
    csv: 'dtw_alignment.csv',
    referenceTimeColumn: 't_ref_sec',
    outOfRange: 'clamp',
  },
  features: {
    mode: 'default',
    globalVolume: true,
    trackMixControls: true,
    looping: true,
    presets: true,
  },
});
```

# Initialization Requirements

Use:

```javascript
TrackSwitch.createTrackSwitch(rootElement, init)
```

Required minimum:

- `init.ui` must include at least one element with `type: 'trackGroup'`
- each `trackGroup` must contain at least one valid track
- each track must define at least one valid `sources[].src`

# Top-Level Options

- `presetNames?: string[]`
  - Friendly names for preset indices (`0`, `1`, ...)
  - Missing names fall back to `Preset {index}`
- `ui: TrackSwitchUiElement[]` (required)
  - Defines all visible player sections and all tracks
- `features?: Partial<TrackSwitchFeatures>`
  - Enables/disables behavior and controls
- `alignment?: TrackAlignmentConfig`
  - Required when `features.mode` is `'alignment'`

# UI Elements

`ui` is rendered in array order. Supported element types:

- `image`
- `perTrackImage`
- `waveform`
- `trackGroup`
- `sheetMusic`
- `warpingMatrix`

## Track Group and Track Options

Tracks live in `ui` entries with `type: 'trackGroup'`:

```javascript
{
  type: 'trackGroup',
  rowHeight: 44,
  trackGroup: [
    {
      title: 'Drums',
      solo: false,
      volume: 1,
      pan: 0,
      image: 'drums.png',
      style: 'border-left: 3px solid #4f8dc9;',
      presets: [0, 2],
      seekMarginLeft: 3,
      seekMarginRight: 4,
      sources: [{ src: 'drums.mp3' }],
      alignment: {
        column: 't2_sec',
        synchronizedSources: [{ src: 'drums_synced.mp3' }],
      },
    },
  ],
}
```

Track group fields:

- `rowHeight?: number` (pixels, rounded to nearest integer, minimum `1`)
- `trackGroup: TrackDefinition[]` (required, non-empty)

Track fields:

- `title?: string`
- `solo?: boolean`
- `volume?: number` (`0..1`, default `1`)
- `pan?: number` (`-1..1`, default `0`)
- `image?: string`
- `style?: string`
- `presets?: number[]`
- `seekMarginLeft?: number`
- `seekMarginRight?: number`
- `sources: TrackSourceDefinition[]` (required)
- `alignment?: { column?: string; synchronizedSources?: TrackSourceDefinition[] }`

Track notes:

- Track `id` values are not supported.
- Track index is the order inside `ui[].trackGroup[]`.
- In non-exclusive mode (`features.exclusiveSolo: false`), if no track `solo` state is explicitly configured, all tracks start enabled.
- `seekMarginLeft` / `seekMarginRight` are accepted in the track definition for compatibility; seek margin behavior is primarily used by seekable UI elements (`image`, `waveform`).

Source fields (`sources[]` and `alignment.synchronizedSources[]`):

- `src: string` (required)
- `type?: string` (optional MIME type override)
- `startOffsetMs?: number`
  - positive: trims the start
  - negative: pads silence at start
- `endOffsetMs?: number`
  - positive: trims the end
  - negative: pads silence at end

Source loading notes:

- If multiple `sources` are listed, the first playable source is used.
- In alignment mode, `synchronizedSources` enables the global `SYNC` button.

Preset behavior:

- Preset indices are `0`-based.
- Preset count is derived from the highest index used in tracks.
- Preset `0` is auto-applied on initialization when presets exist.
- Preset selector is visible only if there are at least 2 presets and `features.presets` is `true`.

## Image UI Element

```javascript
{ type: 'image', src: 'cover.jpg', seekable: true, style: 'margin: 12px auto;' }
```

Fields:

- `src: string`
- `seekable?: boolean`
- `style?: string`
- `seekMarginLeft?: number`
- `seekMarginRight?: number`

Notes:

- Seek margins are clamped to `0..100` percent.
- For seekable images, `seekMarginLeft + seekMarginRight` must be less than `100`.

## Per-Track Image UI Element

```javascript
{ type: 'perTrackImage', seekable: false, style: 'margin: 12px auto;' }
```

Fields:

- `seekable?: boolean`
- `style?: string`
- `seekMarginLeft?: number`
- `seekMarginRight?: number`

What it does:

- Shows the currently selected track cover (`ui[].trackGroup[].image`) when exactly one track is active.
- If no selected track image is available, this UI element is hidden.
- Works in both `default` and `alignment` mode.

Notes:

- `perTrackImage` is independent from regular `image`.
- Both `image` and `perTrackImage` may be `seekable: true`.
- Seek margins are clamped to `0..100` percent.
- For seekable per-track images, `seekMarginLeft + seekMarginRight` must be less than `100`.
- `perTrackImage` requires `features.exclusiveSolo: true`.

## Waveform UI Element

```javascript
{ type: 'waveform', width: 1200, height: 150, waveformBarWidth: 2, maxZoom: 5, waveformSource: 'audible', timer: true }
```

Fields:

- `width?: number` (default `1200`)
- `height?: number` (default `150`)
- `waveformBarWidth?: number` (default `1`)
- `maxZoom?: number` (default `5`)
- `waveformSource?: 'audible' | number` (default `'audible'`)
- `timer?: boolean`
- `style?: string`
- `seekMarginLeft?: number`
- `seekMarginRight?: number`

Normalization and behavior:

- Invalid `waveformBarWidth` values are normalized to `1`.
- `maxZoom` is the minimum visible waveform window in seconds.
- `maxZoom: 0.5` allows zooming in to a half-second excerpt.
- `maxZoom <= 0` disables waveform zoom.
- `waveformSource: 'audible'` uses current audible mix.
- `waveformSource: <trackIndex>` renders a fixed track waveform.
- `seekMarginLeft + seekMarginRight` must be less than `100`.
- `timer` default depends on mode if omitted:
  - `default` mode: off
  - `alignment` mode: on
- If any waveform UI element exists, waveform rendering is forced on (`features.waveform = true`).
- When zoomed in, the top-left overlay shows a draggable waveform minimap instead of a numeric zoom badge.

## Sheet Music UI Element

```javascript
{
  type: 'sheetMusic',
  src: 'score.musicxml',
  measureCsv: 'score_measures.csv',
  maxWidth: 960,
  maxHeight: 360,
  renderScale: 0.75,
  followPlayback: true,
  cursorColor: '#999999',
  cursorAlpha: 0.1,
}
```

Fields:

- `src: string` (MusicXML URL)
- `measureCsv: string` (CSV with `start` and `measure` columns)
- `maxWidth?: number`
- `maxHeight?: number`
- `renderScale?: number`
- `followPlayback?: boolean` (default `true`)
- `style?: string`
- `cursorColor?: string`
- `cursorAlpha?: number` (`0..1`, default `0.1`)

Behavior:

- `maxWidth` / `maxHeight` are rounded and ignored if `< 1`.
- `renderScale` must be finite and `> 0`.
- `measureCsv` supports comma or semicolon delimiter.
- Clicking a rendered measure seeks to mapped reference time.
- If MusicXML fails to load, only the sheet panel fails.
- If measure CSV fails, score can still render but measure sync is disabled.

## Warping Matrix UI Element

```javascript
{ type: 'warpingMatrix', height: 240, tempoSmoothingHalfWindowPoints: 3, style: 'margin: 12px 0;' }
```

Fields:

- `height?: number`
- `style?: string`
- `tempoSmoothingHalfWindowPoints?: number`

Behavior:

- Visible only in `alignment` mode.
- Renders two linked plots:
  - left: warping path (reference time vs track time)
  - right: local tempo deviation (percent, with baseline at `100`)
- Tempo plot uses active-track time on x-axis and can seek on click.
- Tempo smoothing uses central differences over `k` neighbors on each side; default `k = 5`.
- While global `SYNC` is on, the panel is visibly dimmed and non-interactive.

# Features

Defaults:

- `mode: 'default'`
- `exclusiveSolo: false`
- `muteOtherPlayerInstances: true`
- `globalVolume: false`
- `trackMixControls: false`
- `repeat: false`
- `tabView: false`
- `iosAudioUnlock: true`
- `keyboard: true`
- `looping: false`
- `seekBar: true`
- `timer: true`
- `presets: true`
- `waveform: true`

Feature reference:

| Feature key | What it does | Non-dev note |
| --- | --- | --- |
| `mode` (`'default'`/`'alignment'`) | Selects timeline behavior | Use `default` unless you have timing-mapping CSV data |
| `exclusiveSolo` | Single-solo behavior in track buttons | Only one track can be active at a time |
| `muteOtherPlayerInstances` | Pauses other trackswitch players on same page when this one starts | Helpful when multiple demos exist on one page |
| `globalVolume` | Shows and enables main volume slider | Turn on if audience needs quick loudness control |
| `trackMixControls` | Shows per-track volume/pan controls | Useful when users compare stem balances |
| `repeat` | Starts with repeat enabled | Independent from loop A/B region |
| `tabView` | Applies tab-like row styling | Visual preference only |
| `iosAudioUnlock` | Performs iOS playback unlock attempt on load | Keep enabled for safest mobile behavior |
| `keyboard` | Enables keyboard shortcuts | Good for desktop demos and accessibility |
| `looping` | Shows loop controls and enables loop shortcuts | Needed for A/B loop practice/listening |
| `seekBar` | Shows main seekbar | Turn off only if you provide another seekable UI |
| `timer` | Shows main time display | Useful for precise listening comparisons |
| `presets` | Enables preset selector behavior | Requires at least 2 preset groups |
| `waveform` | Enables waveform interactions/rendering | If waveform UI is present, this is forced to `true` |

Normalization rules:

- Unknown feature keys throw an error.
- Invalid `mode` values fall back to `'default'`.
- `exclusiveSolo: true` forces `presets: false`.
- In `alignment` mode, runtime enforces `exclusiveSolo: true` and `presets: false`.

Solo interaction behavior:

- In non-exclusive mode (`exclusiveSolo: false`), if no track is selected, playback is silent.
- `Shift + click` keeps exclusive-select behavior, except when the clicked track is already the only selected track; in that case, all tracks are selected.

# Alignment Mode

Alignment config (`init.alignment`):

- `csv: string` (required)
- `referenceTimeColumn: string` (required)
- `outOfRange?: 'clamp' | 'linear'` (default `clamp`)

Per-track alignment config lives at:

- `ui[].trackGroup[].alignment.column` (required in alignment mode)
- `ui[].trackGroup[].alignment.synchronizedSources?`

Alignment requirements:

- `features.mode` must be `'alignment'`
- `init.alignment` must be present and valid
- every track in `ui[].trackGroup[]` must provide `alignment.column`

Alignment behavior summary:

- `referenceTimeColumn` defines the public timeline axis.
- Seekbar/timer/events use reference time.
- Initial state starts with `SYNC` off and single-solo behavior.
- Switching solo track remaps position through alignment mapping.
- Enabling global `SYNC` uses synchronized sources where available.
- Fixed-source waveforms (`waveformSource: number`) use local track axis while `SYNC` is off.

# Keyboard Shortcuts

When `features.keyboard` is `true`:

- `F1` - open/close the keyboard shortcut help overlay
- `Space` - play/pause
- `Escape` - stop + reset position
- `R` - toggle repeat
- `← / →` - seek `-2s / +2s`
- `Shift + ← / →` - seek `-5s / +5s`
- `Home` - jump to start
- `↑ / ↓` - volume up/down (`globalVolume` only)
- `1`..`0` - control tracks `1`..`10`
  - exclusive solo mode: activate selected track
  - non-exclusive mode: toggle selected track mute/solo state

When `features.looping` is `true`:

- `A` - set loop point A
- `B` - set loop point B
- `L` - toggle loop
- `C` - clear loop points

Keyboard input goes to the last interacted player instance.

The `F1` help overlay only shows shortcuts that are relevant to the current enabled feature set.

# Looping Behavior

When looping is enabled, users can set loops via:

- loop buttons
- keyboard shortcuts (`A`, `B`, `L`, `C`)
- right-click drag on seekable controls (`seekbar`, seekable image, waveform)

Loop behavior:

- Minimum A/B distance: `100ms`
- Loop playback takes precedence over full-track repeat
- Loop region and markers are drawn in seek UI

# Programmatic API

`createTrackSwitch(...)` returns a `TrackSwitchController`.

Controller methods:

- `load(): Promise<void>`
- `destroy(): void`
- `togglePlay(): void`
- `play(): void`
- `pause(): void`
- `stop(): void`
- `seekTo(seconds: number): void`
- `seekRelative(seconds: number): void`
- `setRepeat(enabled: boolean): void`
- `setVolume(volumeZeroToOne: number): void`
- `setTrackVolume(trackIndex: number, volumeZeroToOne: number): void`
- `setTrackPan(trackIndex: number, panMinusOneToOne: number): void`
- `setLoopPoint(marker: 'A' | 'B'): boolean`
- `toggleLoop(): boolean`
- `clearLoop(): void`
- `toggleSolo(trackIndex: number, exclusive?: boolean): void`
- `applyPreset(presetIndex: number): void`
- `getState(): TrackSwitchSnapshot`
- `on(eventName, handler): () => void`
- `off(eventName, handler): void`

Events:

- `loaded` payload: `{ longestDuration: number }`
- `error` payload: `{ message: string }`
- `position` payload: `{ position: number, duration: number }`
- `trackState` payload: `{ index: number, state: { solo: boolean, volume: number, pan: number } }`

`getState()` includes:

- loading flags (`isLoaded`, `isLoading`, `isDestroyed`)
- `longestDuration`
- normalized `features`
- playback `state`
- per-track states (`solo`, `volume`, `pan`)

# Utility Exports

Named exports from package entrypoint:

- `normalizeFeatures`, `defaultFeatures`
- `createInitialPlayerState`, `playerStateReducer`
- `WaveformEngine`
- `inferSourceMimeType`, `formatSecondsToHHMMSSmmm`, `parsePresetIndices`

# Validation and Common Errors

These are common runtime errors and what to check:

1. `TrackSwitch requires at least one ui entry with type "trackGroup" and non-empty trackGroup.`
Fix: add at least one `ui` element with `type: 'trackGroup'` and at least one track.

2. `Each ui trackGroup must contain at least one track.`
Fix: ensure every `trackGroup` array is non-empty.

3. `Each track in ui trackGroup must define at least one valid source src.`
Fix: ensure each track has `sources: [{ src: '...' }]`.

4. `Invalid init key: ...`, `Invalid alignment key: ...`, `Invalid ui.<type> key: ...`, `Invalid track key: ...`, `Invalid track alignment key: ...`, or `Invalid source key: ...`
Fix: remove unknown keys and use only documented options for that section.

5. `Invalid ui element type: ...`
Fix: use only `image`, `perTrackImage`, `waveform`, `trackGroup`, `sheetMusic`, `warpingMatrix`.

6. `Invalid feature key: ...`
Fix: use only documented `features` keys.

7. `Invalid init configuration: perTrackImage requires features.exclusiveSolo to be true.`
Fix: enable `features.exclusiveSolo` (default mode) or remove `perTrackImage`.

8. `Invalid ui.image configuration: seekMarginLeft + seekMarginRight must be less than 100.` (same rule for `ui.perTrackImage` and `ui.waveform`)
Fix: reduce one or both margins so the sum is `< 100`.

9. `Alignment mode requires init.alignment configuration.`
Fix: add `alignment` object when `features.mode = 'alignment'`.

10. `Alignment configuration requires alignment.referenceTimeColumn.`
Fix: set `alignment.referenceTimeColumn`.

11. `Alignment mode requires alignment.column for every track. Missing trackIndex ...`
Fix: set `ui[].trackGroup[].alignment.column` for every track.

12. `Alignment CSV is missing configured referenceTimeColumn: ...` or `Alignment CSV is missing configured column: ...`
Fix: verify CSV headers match your `referenceTimeColumn` and track columns.
