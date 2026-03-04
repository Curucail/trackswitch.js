---
title: trackswitch.js
---

- [Initialization Requirements](#initialization-requirements)
- [Configuration](#configuration)
  - [Tracks](#tracks)
  - [Presets](#presets)
  - [UI Elements](#ui-elements)
  - [Player Features](#player-features)
  - [Alignment](#alignment)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Looping](#looping)
  - [Programmatic API](#programmatic-api)
  - [Utility Exports](#utility-exports)

# Initialization Requirements

Use `TrackSwitch.createTrackSwitch(rootElement, init)`.

- `init.tracks` is required.
- `init.tracks` must contain at least one track.

If `tracks` is missing or empty, trackswitch throws:

```text
TrackSwitch requires init.tracks with at least one track.
```

# Configuration

Basic shape:

```javascript
TrackSwitch.createTrackSwitch(rootElement, {
  tracks: [
    {
      title: 'Drums',
      sources: [{ src: 'drums.mp3' }],
      alignment: {
        column: 't1_sec',
      },
    },
  ],
  presetNames: ['All Tracks'],
  ui: [
    { type: 'image', src: 'cover.jpg', seekable: true },
    { type: 'waveform', width: 1200, height: 150 },
    { type: 'sheetMusic', src: 'score.musicxml', measureCsv: 'score_measures.csv', maxWidth: 960, renderScale: 0.75, maxHeight: 360, followPlayback: true },
    {
      type: 'warpingMatrix',
      height: 240,
    },
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
  },
});
```

## Tracks

`tracks` is an array of stems.

Track fields:

- `title?: string`
- `solo?: boolean`
- `volume?: number` (`0..1`, defaults to `1`)
- `pan?: number` (`-1..1`, defaults to `0`)
- `image?: string`
- `style?: string`
- `presets?: number[]`
- `sources: TrackSourceDefinition[]` (required)
- `alignment?: { column?: string; sources?: TrackSourceDefinition[] }`

Notes:

- Custom track `id` values are not supported.
- Track index is inferred from the order tracks appear in each `ui.trackGroup`.

Source fields:

- `src: string` (required)
- `type?: string` (optional MIME type)
- `startOffsetMs?: number` (positive trims start, negative pads start)
- `endOffsetMs?: number` (positive trims end, negative pads end)

Note: when a track has multiple `sources`, the first playable source is used.
In `alignment`, `alignment.synchronizedSources` enables the global `SYNC` button in the main control bar.

Per-track volume and pan controls:

- Enable via `features.trackMixControls: true`
- Track volume uses `0..1` (`1` is unchanged level)
- Track pan uses `-1..1` (`-1` full left, `1` full right)
- Track pan uses Web Audio `StereoPannerNode` (equal-power panning law) when supported

## Presets

Use `presetNames` and per-track `presets` indices.

```javascript
TrackSwitch.createTrackSwitch(rootElement, {
  presetNames: ['All', 'Vocals'],
  tracks: [
    { title: 'Vocals', presets: [0, 1], sources: [{ src: 'vocals.mp3' }] },
    { title: 'Drums', presets: [0], sources: [{ src: 'drums.mp3' }] },
  ],
});
```

Rules:

- Presets are 0-indexed.
- Preset count is derived from the highest track preset index.
- Missing names fall back to `Preset {index}`.
- Extra names are ignored.
- Preset `0` is auto-applied at initialization when presets exist.
- Applying a preset sets `solo` by membership.
- Preset selector is shown only when at least 2 presets exist and `features.presets` is `true`.

## UI Elements

Use `ui` to inject player visuals with minimal HTML.
Element order in the array is the rendered order.

Image element:

```javascript
{ type: 'image', src: 'cover.jpg', seekable: true, style: 'margin: 12px auto;' }
```

- Fields: `src`, `seekable?`, `style?`, `seekMarginLeft?`, `seekMarginRight?`
- At most one image can set `seekable: true`

Waveform element:

```javascript
{ type: 'waveform', width: 1200, height: 150, waveformBarWidth: 2, maxZoom: 20, waveformSource: 'audible', timer: true }
```

- Fields: `width?`, `height?`, `waveformBarWidth?`, `maxZoom?`, `waveformSource?`, `timer?`, `style?`, `seekMarginLeft?`, `seekMarginRight?`
- Defaults: `width: 1200`, `height: 150`, `waveformBarWidth: 1`
- Invalid `waveformBarWidth` values are normalized to `1`
- `maxZoom` controls maximum per-waveform zoom factor and defaults to `20`
- `maxZoom` accepts either a factor (`20`) or percentage string (`'2000%'`), where `100% = 1x`
- Zoom is enabled per waveform only when `maxZoom > 1` (or `> '100%'`); `maxZoom: 1` / `maxZoom: '100%'` disables zoom for that waveform
- `waveformSource` controls what gets visualized:
  - `'audible'` (default): render the current audible mix based on solo state
  - non-negative integer: render that specific track index waveform regardless of solo state
- `timer` controls the waveform's top-right `current / duration` badge:
  - `alignment` mode default: enabled when omitted
  - `default` mode default: disabled when omitted
  - explicit `timer: true` or `timer: false` always overrides the mode default
- If at least one waveform UI element is configured, waveform rendering is enabled
- Each waveform container supports independent zoom (desktop wheel and mobile pinch) when that waveform's `maxZoom` is greater than `1`

Sheet music element:

```javascript
{
  type: 'sheetMusic',
  src: 'score.musicxml',
  measureCsv: 'score_measures.csv',
  maxWidth: 960,
  renderScale: 0.75,
  maxHeight: 360,
  followPlayback: true,
  style: 'margin: 12px 0;',
  cursorColor: '#999999',
  cursorAlpha: 0.1,
}
```

- Fields: `src` (MusicXML URL), `measureCsv` (time-to-measure map CSV URL), `maxWidth?` (container max width in px), `renderScale?` (OSMD zoom factor), `maxHeight?` (viewport max height in px), `followPlayback?` (auto-follow highlighted measure), `style?`, `cursorColor?`, `cursorAlpha?`
- `maxWidth` accepts finite numbers, is rounded to an integer, and values `< 1` are ignored
- Sheet music width is responsive: it uses available player width up to `maxWidth`
- `renderScale` accepts finite numbers `> 0`; values `< 1` render smaller notation, values `> 1` render larger notation
- `maxHeight` accepts finite numbers, is rounded to an integer, and values `< 1` are ignored
- When `maxHeight` is set, the sheet-music viewport becomes internally scrollable (vertical + horizontal as needed)
- `followPlayback` defaults to `true`; with measure sync active it auto-scrolls vertically only when the current measure leaves the viewport
- `cursorAlpha` is normalized to `[0, 1]` and defaults to `0.1`
- Measure map CSV requires `start` and `measure` columns (comma or semicolon delimiter)
- Measure highlighting is intended for `alignment` mode and uses reference timeline position
- Clicking a measure in the rendered sheet seeks to that measure's mapped reference start time from `measureCsv`
- If MusicXML fails to load, only the sheet music panel fails (audio player continues)
- If measure CSV fails, score rendering still works but measure highlighting is disabled

Warping matrix element:

```javascript
{
  type: 'warpingMatrix',
  height: 240,
  style: 'margin: 12px 0;',
}
```

- Fields: `height?` (panel height in px), `style?`
- Rendering is active in `alignment` mode only; outside `alignment` the element stays hidden
- The UI renders two linked panels: left `warping path` and right `local tempo deviation`
- Left panel uses reference timeline on x-axis and track timeline on y-axis, with current reference indicator per track
- Right panel uses active-track time on x and local tempo in percent on y, where `100` means equal local speed to reference
- Tempo is computed directly from DTW points via finite differences: `tempoPercent = ((j[k+w] - j[k-w]) / (i[k+w] - i[k-w])) * 100`; samples with non-positive denominator are skipped
- Right panel has a gray dashed baseline at `y = 100`
- Right panel uses active-track time on its x-axis and displays a centered moving track-time window (adjustable via the tempo controls)
- Right panel renders a single active-track curve, includes a fixed dashed vertical center playhead guide, and switches to a visible dimmed non-interactive state when global `SYNC` is enabled
- Local tempo uses central finite differences with half-window `w = 1`
- Clicking the left panel (drag supported) or right panel (single-click) seeks on the reference timeline

## Player Features

Feature defaults:

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

Normalization rules:

- `exclusiveSolo: true` forces `presets: false`
- A configured waveform UI element forces `waveform: true`
- In `alignment`, single-track solo behavior is enforced automatically at startup

`mode` values:

- `default` - existing timeline behavior
- `alignment` - reference timeline behavior with CSV mapping

## Alignment

Alignment config lives at `init.alignment`.

- `csv: string` - URL/path to a numeric CSV file with header row
- `referenceTimeColumn: string` - CSV column used as the reference timeline axis (can be an abstract axis such as seconds or measures)
- `outOfRange?: 'clamp' | 'linear'` - defaults to `clamp`

Per-track alignment fields live on `tracks[*].alignment`:

- `column: string` - CSV column name for that track timeline
- `sources?: TrackSourceDefinition[]` - optional synchronized source set used by the global `SYNC` toggle

Legacy fallback:

- `alignment.mappings` is still accepted when no track defines `alignment.column`

`alignment` requirements:

- `features.mode` must be `alignment`
- `alignment` must be present and valid
- preferred mapping style: every track defines `tracks[*].alignment.column`

Behavior:

- `alignment` uses `referenceTimeColumn` as the reference axis
- `alignment` timeline duration is the maximum value in `referenceTimeColumn`
- Public timing (`seekTo`, seekbar, timer, `position` event) stays on reference time in `alignment`
- `alignment` starts with `SYNC` disabled and single-track solo mode enforced
- `alignment`: switching active solo track remaps playback position via CSV and restarts from the mapped position
- `alignment`: enabling global `SYNC` switches synced tracks to synchronized sources, re-enables multi-track listening, and locks non-synced tracks out
- `alignment`: with `SYNC` off, fixed-track waveforms (`waveformSource: <trackIndex>`) render on native track time and their waveform seek overlays (playhead + loop markers/region) use that local axis
- `alignment`: with `SYNC` on, fixed-track waveforms return to shared reference-axis behavior; synced tracks bypass CSV mapping (identity)
- `alignment`: waveform containers default to rendering a top-right timer badge in `current / duration` format; fixed-track waveforms use local track time while `SYNC` is off
- `alignment`: sheet-music UI elements (`type: 'sheetMusic'`) highlight the currently mapped measure from `measureCsv` on the reference axis
- `alignment`: `sheetMusic.followPlayback` (default `true`) auto-scrolls the internal sheet viewport vertically when the highlighted measure moves outside the visible area
- `alignment`: `warpingMatrix` UI elements render a warping-path panel plus a local-tempo-deviation panel; the tempo panel uses active-track x-axis time and becomes dimmed/non-interactive while `SYNC` is enabled

Cross-player behavior:

- When `muteOtherPlayerInstances` is `true`, starting playback in one player pauses other players on the same page

## Keyboard Shortcuts

When `features.keyboard` is enabled:

- `Space` - play/pause
- `Escape` - stop and reset position
- `R` - toggle repeat
- `ArrowLeft` / `ArrowRight` - seek -/+ 2 seconds
- `Shift + ArrowLeft` / `Shift + ArrowRight` - seek -/+ 5 seconds
- `Home` - jump to start
- `ArrowUp` / `ArrowDown` - adjust volume (when `globalVolume` is enabled)
- `1`-`0` - control tracks 1-10:
  - if `exclusiveSolo` is `true`: switch to the selected track
  - if `exclusiveSolo` is `false`: toggle the selected track mute state

When `features.looping` is enabled:

- `A` - set loop point A
- `B` - set loop point B
- `L` - toggle loop on/off
- `C` - clear loop points

Keyboard input is scoped to the last interacted player instance.

## Looping

When looping is enabled, loop regions can be set by:

- Loop buttons
- Keyboard shortcuts (`A`, `B`, `L`, `C`)
- Right-click drag on seekable controls (seekbar, seekable image, waveform)

Behavior:

- Minimum A/B distance is 100 ms
- Loop region is drawn in the UI
- If loop is active, loop playback takes precedence over full-track repeat
- Keyboard seek-left/right wraps within active loop boundaries

## Programmatic API

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

`getState()` snapshot highlights:

- `isLoaded`, `isLoading`, `isDestroyed`
- `longestDuration`
- `features`
- `state` (`playing`, `repeat`, `position`, `startTime`, `currentlySeeking`, `loop`, `volume`)
- `tracks` (array of `{ solo, volume, pan }`)

## Utility Exports

Advanced named exports available from the package entrypoint:

- `normalizeFeatures`, `defaultFeatures`
- `createInitialPlayerState`, `playerStateReducer`
- `WaveformEngine`
- `inferSourceMimeType`, `formatSecondsToHHMMSSmmm`, `parsePresetIndices`
