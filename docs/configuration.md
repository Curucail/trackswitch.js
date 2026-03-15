- [Quick Reference](#quick-reference)
  - [Default Mode](#default-mode)
  - [Alignment Mode](#alignment-mode)
- [Player-Wide Settings](#player-wide-settings)
  - [`ui`](#ui)
  - [`presetNames`](#presetnames)
  - [`features`](#features)
  - [`alignment`](#alignment)
- [Track Settings](#track-settings)
  - [`trackGroup`](#trackgroup)
  - [Track Options](#track-options)
  - [Audio Source Options](#audio-source-options)
  - [Track Alignment Options](#track-alignment-options)
- [Visualizations](#visualizations)
  - [`image`](#image)
  - [`perTrackImage`](#pertrackimage)
  - [`waveform`](#waveform)
  - [`sheetMusic`](#sheetmusic)
  - [`warpingMatrix`](#warpingmatrix)
- [Keyboard and Loop Controls](#keyboard-and-loop-controls)
- [Things to Check](#things-to-check)

## Quick Reference

### Default Mode

```javascript
TrackSwitch.createTrackSwitch(rootElement, {
  presetNames: ['Full Mix', 'Strings', 'Rhythm'],
  ui: [
    {
      type: 'image',
      src: 'cover.jpg',
      seekable: true,
      seekMarginLeft: 5,
      seekMarginRight: 5,
      style: 'margin: 0;',
    },
    {
      type: 'waveform',
      height: 160,
      waveformBarWidth: 2,
      maxZoom: 5,
      waveformSource: 'audible',
      playbackFollowMode: 'center',
      timer: false,
      seekMarginLeft: 3,
      seekMarginRight: 4,
      style: 'margin: 0;',
    },
    {
      type: 'trackGroup',
      rowHeight: 44,
      trackGroup: [
        {
          title: 'Violins',
          solo: true,
          volume: 0.9,
          pan: -0.2,
          image: 'violins.png',
          style: 'border-left: 3px solid #4f8dc9;',
          presets: [0, 1],
          sources: [
            { src: 'violins.mp3', type: 'audio/mpeg', startOffsetMs: 0, endOffsetMs: 0 },
            { src: 'violins.ogg', type: 'audio/ogg' },
          ],
        },
        {
          title: 'Drums',
          solo: false,
          volume: 1,
          pan: 0,
          image: 'drums.png',
          style: 'border-left: 3px solid #ed8c01;',
          presets: [0, 2],
          sources: [{ src: 'drums.mp3', type: 'audio/mpeg', startOffsetMs: -120, endOffsetMs: 250 }],
        },
      ],
    },
    {
      type: 'sheetMusic',
      src: 'score.musicxml',
      measureColumn: 'measure',
      maxWidth: 960,
      maxHeight: 360,
      renderScale: 0.75,
      followPlayback: true,
      cursorColor: '#999999',
      cursorAlpha: 0.1,
      style: 'margin: 0;',
    },
  ],
  alignment: {
    csv: 'alignment.csv',
    referenceTimeColumn: 'score_time_sec',
  },
  features: {
    mode: 'default',
    exclusiveSolo: false,
    muteOtherPlayerInstances: true,
    globalVolume: true,
    trackMixControls: true,
    repeat: false,
    tabView: false,
    iosAudioUnlock: true,
    keyboard: true,
    looping: true,
    seekBar: true,
    timer: true,
    presets: true,
    customizablePanelOrder: true,
  },
});
```

### Alignment Mode

```javascript
TrackSwitch.createTrackSwitch(rootElement, {
  ui: [
    {
      type: 'image',
      src: 'score-overview.jpg',
      seekable: false,
      seekMarginLeft: 0,
      seekMarginRight: 0,
      style: 'margin: 0;',
    },
    {
      type: 'perTrackImage',
      seekable: true,
      seekMarginLeft: 4,
      seekMarginRight: 4,
      style: 'margin: 0;',
    },
    {
      type: 'waveform',
      height: 160,
      waveformBarWidth: 3,
      maxZoom: 8,
      waveformSource: 0,
      playbackFollowMode: 'jump',
      timer: true,
      seekMarginLeft: 3,
      seekMarginRight: 4,
      style: 'margin: 0;',
    },
    {
      type: 'trackGroup',
      rowHeight: 44,
      trackGroup: [
        {
          title: 'Performance A',
          solo: true,
          volume: 1,
          pan: 0,
          image: 'performance-a.png',
          style: 'border-left: 3px solid #4f8dc9;',
          sources: [{ src: 'performance-a.mp3', type: 'audio/mpeg', startOffsetMs: 0, endOffsetMs: 0 }],
          alignment: {
            column: 'perf_a_sec',
            synchronizedSources: [
              { src: 'performance-a-synced.mp3', type: 'audio/mpeg', startOffsetMs: 0, endOffsetMs: 0 },
            ],
          },
        },
        {
          title: 'Performance B',
          solo: false,
          volume: 0.92,
          pan: 0.1,
          image: 'performance-b.png',
          style: 'border-left: 3px solid #6c757d;',
          sources: [{ src: 'performance-b.mp3', type: 'audio/mpeg', startOffsetMs: 50, endOffsetMs: 0 }],
          alignment: {
            column: 'perf_b_sec',
            synchronizedSources: [{ src: 'performance-b-synced.mp3', type: 'audio/mpeg' }],
          },
        },
      ],
    },
    {
      type: 'sheetMusic',
      src: 'score.musicxml',
      measureColumn: 'measure',
      maxWidth: 960,
      maxHeight: 360,
      renderScale: 0.75,
      followPlayback: true,
      cursorColor: '#999999',
      cursorAlpha: 0.1,
      style: 'margin: 0;',
    },
    {
      type: 'warpingMatrix',
      height: 240,
      tempoSmoothingSeconds: 5,
      globalScoreBPM: 60,
      style: 'margin: 0;',
    },
  ],
  alignment: {
    csv: 'alignment.csv',
    referenceTimeColumn: 'score_time_sec',
    referenceTimeColumnSync: 'synced_time_sec',
    outOfRange: 'clamp',
  },
  features: {
    mode: 'alignment',
    exclusiveSolo: true,
    muteOtherPlayerInstances: true,
    globalVolume: true,
    trackMixControls: true,
    repeat: false,
    tabView: false,
    iosAudioUnlock: true,
    keyboard: true,
    looping: true,
    seekBar: true,
    timer: true,
    presets: false,
    customizablePanelOrder: false,
  },
});
```

## Player-Wide Settings

### `ui`

`ui` is required. It decides which sections appear in the player and in what order they appear.

Use it to add any of these section types:

- `trackGroup`
- `image`
- `perTrackImage`
- `waveform`
- `sheetMusic`
- `warpingMatrix`

At least one `trackGroup` section is required because that is where the tracks live.

### `presetNames`

Use `presetNames` to create ensembles and name your track combinations.

Example:

```javascript
presetNames: ['Full Mix', 'Vocals Only', 'Backing Track']
```

Notes:

- Preset numbers start at `0`.
- Presets only appear in the ui when you have at least two usable preset choices.
- Tracks decide which presets they belong to through each track's `presets` setting.
- If you use presets, `presetNames` assigns names to preset IDs in numerical order.

### `features`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode?` | `'default' | 'alignment'` | `'default'` | Chooses between a standard multitrack player and an aligned performance comparison player. |
| `exclusiveSolo?` | `boolean` | `false` | Listen to one track at a time only instead of mixing several tracks together. |
| `muteOtherPlayerInstances?` | `boolean` | `true` | Stops another player on the same page when this one starts playing. |
| `globalVolume?` | `boolean` | `false` | Shows a main volume control for the whole player. |
| `trackMixControls?` | `boolean` | `false` | Shows per-track volume and pan controls. |
| `customizablePanelOrder?` | `boolean` | `false` | Lets listeners rearrange the visible UI elements. Affects the visible sections on the page, not the track order itself. |
| `repeat?` | `boolean` | `false` | Starts with repeat already turned on. |
| `tabView?` | `boolean` | `false` | Changes the look of the track rows to a tab-like style. |
| `iosAudioUnlock?` | `boolean` | `true` | Helps playback start more reliably on iPhone and iPad. Recommended to leave this on. |
| `keyboard?` | `boolean` | `true` | Enable keyboard shortcuts. |
| `looping?` | `boolean` | `false` | Show loop tools and allow A/B looping. |
| `seekBar?` | `boolean` | `true` | Show the main seekbar. |
| `timer?` | `boolean` | `true` | Show the main time display. |
| `presets?` | `boolean` | `true` | Show preset switching UI element when presets are available. |

### `alignment`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `csv` | `string` | `-` | The timing data file used to connect the different performances. |
| `referenceTimeColumn` | `string` | `-` | The csv column to determine the main shared timeline used by the player. A usual setup would be to align tracks to a reference timeline calculated from the score. |
| `referenceTimeColumnSync?` | `string` | none | The csv column to determine the shared timeline when Sync is turned on in alignment mode. |
| `outOfRange?` | `'clamp' | 'linear'` | `'clamp'` | What the player should do when playback reaches a part of the timing map that has no matching value. |

## Track Settings

### `trackGroup`

Use `type: 'trackGroup'` to add one or more tracks to the player.

Example:

```javascript
{
  type: 'trackGroup',
  rowHeight: 44,
  trackGroup: [
    {
      title: 'Drums',
      image: 'drums.png',
      presets: [0, 2],
      sources: [{ src: 'drums.mp3' }],
    },
  ],
}
```

Section options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `rowHeight?` | `number` | none | Sets the height of the track rows. |
| `trackGroup` | `object[]` | `-` | The list of tracks shown in this section. |

Notes:

- You can use more than one `trackGroup` section.
- `ui` order controls where each `trackGroup` appears on the page.

### Track Options

Each entry inside `trackGroup` can use these options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title?` | `string` | none | Name shown in the track list. |
| `solo?` | `boolean` | `false` | Starting on/off state for that track. |
| `volume?` | `number` | `1` | Starting track volume. Starts at `1` if you do not set it. |
| `pan?` | `number` | `0` | Starting left-right placement. Starts at `0` if you do not set it. |
| `image?` | `string` | none | Image used by `perTrackImage` and other track-based visuals. |
| `presets?` | `number[]` | none | Decides which presets include this track. |
| `sources` | `object[]` | `-` | Audio files for this track. |
| `alignment?` | `object` | none | Alignment settings for this track in an aligned comparison player. |
| `style?` | `string` | none | Lets you give that track row its own visual styling. |

### Audio Source Options

Each entry inside `sources` and `alignment.synchronizedSources` can use these options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | `-` | Audio file to use. |
| `type?` | `string` | none | Optional file-type hint. If you omit it, trackswitch.js recognizes these source file extensions automatically: `.aac`, `.aif`, `.aiff`, `.au`, `.flac`, `.m4a`, `.mp1`, `.mp2`, `.mp3`, `.mp4`, `.mpeg`, `.mpg`, `.oga`, `.ogg`, `.wav`, `.webm`. |
| `startOffsetMs?` | `number` | `0` | Trims or pads the beginning of the file. Positive values trim. Negative values add silence. |
| `endOffsetMs?` | `number` | `0` | Trims or pads the end of the file. Positive values trim. Negative values add silence. |

Notes:

- Every track needs at least one `src`.
- If you list several source files, the player uses the first one that works for the listener's browser.

### Track Alignment Options

Each track can also use an `alignment` block:

```javascript
trackGroup: [
    {
      title: 'Drums',
      sources: [{ src: 'drums.mp3' }],
      alignment: {
        column: 'perf_a_sec',
        synchronizedSources: [{ src: 'performance-a-synced.mp3' }],
      }
    },
  ],
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `column?` | `string` | none | The timing-data column for that performance. |
| `synchronizedSources?` | `object[]` | none | Extra audio files used when Sync is turned on. |

Notes:

- Use these options only in alignment mode.
- `synchronizedSources` are what make mixed synced playback possible.
- Sync is only available when the player also has a shared sync timeline through `referenceTimeColumnSync`.

## Visualizations

### `image`

Use `type: 'image'` for one main image, such as cover art, a diagram, or a screenshot.

Example:

```javascript
{
  type: 'image',
  src: 'cover.jpg',
  seekable: true,
  seekMarginLeft: 5,
  seekMarginRight: 5,
  style: 'margin: 12px auto;',
}
```

Section options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | `-` | The image file to show. |
| `seekable?` | `boolean` | `false` | Lets listeners click the image to jump to a different point in the audio. |
| `seekMarginLeft?` | `number` | `0` | Leaves a non-seekable area on the left side of the image. |
| `seekMarginRight?` | `number` | `0` | Leaves a non-seekable area on the right side of the image. |
| `style?` | `string` | none | Lets you fine-tune the look of the section with CSS. |

### `perTrackImage`

Use `type: 'perTrackImage'` to show the image for the currently active track.

Example:

```javascript
{
  type: 'perTrackImage',
  seekable: false,
  style: 'margin: 12px auto;',
}
```

Section options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `seekable?` | `boolean` | `false` | Lets listeners click the current track image to jump in time. |
| `seekMarginLeft?` | `number` | `0` | Leaves a non-seekable area on the left side of the image. |
| `seekMarginRight?` | `number` | `0` | Leaves a non-seekable area on the right side of the image. |
| `style?` | `string` | none | Lets you fine-tune the look or spacing of the section with CSS. |

Notes:

- Only works if `exclusiveSolo` is `true`.
- This section uses each track's `image` attribute.

### `waveform`

Use `type: 'waveform'` to show an interactive waveform.

Example:

```javascript
{
  type: 'waveform',
  height: 150,
  waveformBarWidth: 2,
  maxZoom: 5,
  waveformSource: 'audible',
  playbackFollowMode: 'center',
  timer: true,
  style: 'margin: 16px 0;',
}
```

Section options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `height?` | `number` | `150` | Height of the waveform. |
| `waveformBarWidth?` | `number` | `1` | Thickness of the waveform bars. |
| `maxZoom?` | `number` | `5` | The closest zoom level listeners can reach, in seconds. Smaller numbers allow tighter zoom. |
| `waveformSource?` | `'audible' | number | number[]` | `'audible'` | Chooses which sound the waveform represents. |
| `playbackFollowMode?` | `'off' | 'center' | 'jump'` | `'off'` | Decides whether the waveform view follows playback automatically. |
| `timer?` | `boolean` | Standard: `false`; Alignment: `true` | Shows a small time label inside the waveform panel. |
| `seekMarginLeft?` | `number` | `0` | Leaves a non-seekable area on the left side. |
| `seekMarginRight?` | `number` | `0` | Leaves a non-seekable area on the right side. |
| `style?` | `string` | none | Lets you fine-tune the look or spacing of the section with CSS. |

Notes:

- If you leave out `timer`, the waveform timer is off in a standard player and on in an alignment player.
- When listeners zoom in, the waveform shows a small overview map for quick navigation.

### `sheetMusic`

Use `type: 'sheetMusic'` to show a MusicXML score.

Example:

```javascript
{
  type: 'sheetMusic',
  src: 'score.musicxml',
  measureColumn: 'measure',
  maxWidth: 960,
  maxHeight: 360,
  renderScale: 0.75,
  followPlayback: true,
  cursorColor: '#999999',
  cursorAlpha: 0.1,
  style: 'margin: 20px auto;',
}
```

Section options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | `-` | The MusicXML file to show. |
| `measureColumn?` | `string` | none | The column in the alignment data that contains measure numbers for score following. |
| `maxWidth?` | `number` | none | The widest the score area should become. |
| `maxHeight?` | `number` | none | The tallest the score area should become. |
| `renderScale?` | `number` | auto | Determines the size of rendered score elements. |
| `followPlayback?` | `boolean` | `true` | Keeps the score view moving with playback. |
| `cursorColor?` | `string` | `'#999999'` | Color of the playback follow cursor. |
| `cursorAlpha?` | `number` | `0.1` | Transparency of the playback follow cursor. |
| `style?` | `string` | none | Lets you fine-tune the look or spacing of the section with CSS. |

Notes:

- The score can still be shown without measure syncing.
- If `measureColumn` is set and matching alignment data is available, listeners can click measures to jump through the music.

### `warpingMatrix`

Use `type: 'warpingMatrix'` to show interactive warping path and local tempo deviation graphs in alignment mode.

Example:

```javascript
{
  type: 'warpingMatrix',
  height: 240,
  tempoSmoothingSeconds: 5,
  globalScoreBPM: 60,
  style: 'margin: 12px 0;',
}
```

Section options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `height?` | `number` | auto | Height of the chart area. |
| `tempoSmoothingSeconds?` | `number` | `5` | How much the local tempo deviation graph should be smoothed. Tempo Deviation is computed as a central differences variant of the warping path. Larger values give a smoother curve. |
| `globalScoreBPM?` | `number` | none | Adds a global BPM to the tempo chart using this score tempo. If at least one score sheet is added somewhere in the player, the BPM is determined automatically from the MusicXML score (also dynamically changing BPM in the score is considered). |
| `style?` | `string` | none | Lets you fine-tune the look or spacing of the section with CSS. |

Notes:

- This section is only useful in alignment mode.
- It shows two views: the timing relationship between the active track and the reference timeline, and the local tempo deviation of the active track over time.
- This section is only enabled in unsynced alignment mode.

## Keyboard and Loop Controls

When `features.keyboard` is on, you can use keyboard shortcuts:

| Keys | Action |
| --- | --- |
| `F1` | Open or close the shortcut help panel |
| `Space` | Play or pause |
| `Escape` | Stop and return to the start |
| `R` | Toggle repeat |
| `Left / Right` | Jump backward or forward by 2 seconds |
| `Shift + Left / Shift + Right` | Jump backward or forward by 5 seconds |
| `Home` | Go to the start |
| `Up / Down` | Change global volume when `globalVolume` is on |
| `1` to `0` | Control tracks 1 to 10 |

When `features.looping` is on, you can also use:

| Keys | Action |
| --- | --- |
| `A` | Set loop point A |
| `B` | Set loop point B |
| `L` | Turn the loop on or off |
| `C` | Clear the loop |

Looping is also available through the loop buttons. On seekable controls, loop regions can be marked directly using right-click on mouse.

## Things to Check

- `ui` must contain at least one `trackGroup`.
- Every track must have at least one audio file in `sources`.
- Seekable `image`, `perTrackImage`, and `waveform` sections need `seekMarginLeft + seekMarginRight` to stay below `100`.
- `perTrackImage` is meant for setups where one track is active at a time (`exclusiveSolo: true`).
- Presets are only shown in the UI when you have at least two preset choices.
- `sheetMusic.measureColumn` only works for clickable measure syncing when matching alignment data is also available.
- `warpingMatrix` works for unsynced alignment mode only, not default mode.
- In alignment mode, each track needs its own `alignment.column`.
