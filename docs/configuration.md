- [Quick Start](#quick-start)
  - [Default Mode](#default-mode)
  - [Alignment Mode](#alignment-mode)
- [Player-Wide Settings](#player-wide-settings)
  - [`ui`](#ui)
  - [`presetNames`](#presetnames)
  - [`features`](#features)
  - [`alignment`](#alignment)
- [Track Settings](#track-settings)
  - [Track Options](#track-options)
  - [Audio Source Options](#audio-source-options)
  - [Track Alignment Options](#track-alignment-options)
- [UI Elements](#ui-elements)
  - [`trackGroup`](#trackgroup)
  - [`image`](#image)
  - [`perTrackImage`](#pertrackimage)
  - [`waveform`](#waveform)
  - [`sheetMusic`](#sheetmusic)
  - [`warpingMatrix`](#warpingmatrix)
- [Keyboard and Loop Controls](#keyboard-and-loop-controls)
- [Things to Check](#things-to-check)

## Quick Start

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
      maxZoom: 5,
      waveformSource: 'audible',
      playbackFollowMode: 'center',
      style: 'margin: 0;',
    },
    {
      type: 'trackGroup',
      rowHeight: 44,
      trackGroup: [
        {
          title: 'Violins',
          volume: 0.9,
          pan: -0.2,
          image: 'violins.png',
          presets: [0, 1],
          sources: [{ src: 'violins.mp3' }],
        },
        {
          title: 'Drums',
          volume: 1,
          pan: 0,
          image: 'drums.png',
          presets: [0, 2],
          sources: [{ src: 'drums.mp3' }],
        },
      ],
    },
  ],
  features: {
    globalVolume: true,
    trackMixControls: true,
    looping: true,
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
      type: 'perTrackImage',
      seekable: true,
      seekMarginLeft: 4,
      seekMarginRight: 4,
      style: 'margin: 0;',
    },
    {
      type: 'waveform',
      height: 160,
      waveformSource: 0,
      timer: true,
      style: 'margin: 0;',
    },
    {
      type: 'trackGroup',
      rowHeight: 44,
      trackGroup: [
        {
          title: 'Performance A',
          image: 'performance-a.png',
          sources: [{ src: 'performance-a.mp3' }],
          alignment: {
            column: 'perf_a_sec',
            synchronizedSources: [{ src: 'performance-a-synced.mp3' }],
          },
        },
        {
          title: 'Performance B',
          image: 'performance-b.png',
          sources: [{ src: 'performance-b.mp3' }],
          alignment: {
            column: 'perf_b_sec',
            synchronizedSources: [{ src: 'performance-b-synced.mp3' }],
          },
        },
      ],
    },
    {
      type: 'sheetMusic',
      src: 'score.musicxml',
      measureColumn: 'measure',
      followPlayback: true,
      style: 'margin: 0;',
    },
    {
      type: 'warpingMatrix',
      height: 240,
      tempoSmoothingSeconds: 5,
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
    globalVolume: true,
    trackMixControls: true,
    looping: true,
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

Use `presetNames` to give friendly names to your saved track combinations.

Example:

```javascript
presetNames: ['Full Mix', 'Vocals Only', 'Backing Track']
```

Notes:

- Preset numbers start at `0`.
- Presets only appear in the ui when you have at least two usable preset choices.
- Tracks decide which presets they belong to through each track's `presets` setting.
- If you use presets, `presetNames` should be listed in the same order.

### `features`

Use `features` to turn player tools on or off.

Default settings:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode?` | `'default' | 'alignment'` | `'default'` | Chooses between a standard multitrack player and an aligned comparison player. |
| `exclusiveSolo?` | `boolean` | `false` | Keeps listening to one track at a time instead of mixing several tracks together. |
| `muteOtherPlayerInstances?` | `boolean` | `true` | Stops another player on the same page when this one starts playing. |
| `globalVolume?` | `boolean` | `false` | Shows a main volume control for the whole player. |
| `trackMixControls?` | `boolean` | `false` | Shows per-track volume and pan controls. |
| `customizablePanelOrder?` | `boolean` | `false` | Lets listeners rearrange the visible sections. |
| `repeat?` | `boolean` | `false` | Starts with repeat already turned on. |
| `tabView?` | `boolean` | `false` | Changes the look of the track rows to a tab-like style. |
| `iosAudioUnlock?` | `boolean` | `true` | Helps playback start more reliably on iPhone and iPad. |
| `keyboard?` | `boolean` | `true` | Turns keyboard shortcuts on. |
| `looping?` | `boolean` | `false` | Shows loop tools and allows A/B looping. |
| `seekBar?` | `boolean` | `true` | Shows the main seek bar. |
| `timer?` | `boolean` | `true` | Shows the main time display. |
| `presets?` | `boolean` | `true` | Shows preset switching when presets are available. |
| `waveform?` | `boolean` | `true` | Keeps waveform display and interaction available. |

Notes:

- `mode: 'default'` is the normal multitrack player.
- `mode: 'alignment'` is for comparing matched performances on a shared timeline.
- In alignment mode, the player works one track at a time by default, with optional sync when synced files are available.
- `customizablePanelOrder` affects the visible sections on the page, not the track order itself.

### `alignment`

| Option | Type | Description |
| --- | --- | --- |
| `csv` | `string` | The timing data file used to connect the different performances. |
| `referenceTimeColumn` | `string` | The csv column to determine the main shared timeline used by the player. |
| `referenceTimeColumnSync?` | `string` | The csv column to determine the shared timeline when Sync is turned on in alignment mode. |
| `outOfRange?` | `'clamp' | 'linear'` | What the player should do when playback reaches a part of the timing map that has no matching value. |

## Track Settings

### Track Options

Each entry inside `trackGroup` can use these options:

| Option | Type | Description |
| --- | --- | --- |
| `title?` | `string` | Name shown in the track list. |
| `solo?` | `boolean` | Starting on/off state for that track. |
| `volume?` | `number` | Starting track volume. |
| `pan?` | `number` | Starting left-right placement. |
| `image?` | `string` | Image used by `perTrackImage` and other track-based visuals. |
| `style?` | `string` | Lets you give that track row its own visual styling. |
| `presets?` | `number[]` | Decides which presets include this track. |
| `sources` | `object[]` | Audio files for this track. |
| `alignment?` | `object` | Alignment settings for this track in an aligned comparison player. |

Notes:

- `volume` starts at `1` if you do not set it.
- `pan` starts at `0` if you do not set it.
- In a regular multitrack player, tracks normally start available for listening unless you set them differently.
- In a one-track-at-a-time player, only one track stays active at once.

### Audio Source Options

Each entry inside `sources` and `alignment.synchronizedSources` can use these options:

| Option | Type | Description |
| --- | --- | --- |
| `src` | `string` | Audio file to use. |
| `type?` | `string` | Optional file-type hint. |
| `startOffsetMs?` | `number` | Trims or pads the beginning of the file. Positive values trim. Negative values add silence. |
| `endOffsetMs?` | `number` | Trims or pads the end of the file. Positive values trim. Negative values add silence. |

Notes:

- Every track needs at least one `src`.
- If you list several source files, the player uses the first one that works for the listener's browser.

### Track Alignment Options

Each track can also use an `alignment` block:

```javascript
alignment: {
  column: 'perf_a_sec',
  synchronizedSources: [{ src: 'performance-a-synced.mp3' }],
}
```

| Option | Type | Description |
| --- | --- | --- |
| `column?` | `string` | The timing-data column for that performance. |
| `synchronizedSources?` | `object[]` | Extra audio files used when Sync is turned on. |

Notes:

- Use these options only in alignment mode.
- `synchronizedSources` are what make mixed synced playback possible.
- Sync is only available when the player also has a shared sync timeline through `referenceTimeColumnSync`.

## UI Elements

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

| Option | Type | Description |
| --- | --- | --- |
| `rowHeight?` | `number` | Sets the height of the track rows. |
| `trackGroup` | `object[]` | The list of tracks shown in this section. |

Notes:

- You can use more than one `trackGroup` section.
- `ui` order controls where each `trackGroup` appears on the page.

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

| Option | Type | Description |
| --- | --- | --- |
| `src` | `string` | The image file to show. |
| `seekable?` | `boolean` | Lets listeners click the image to jump to a different point in the audio. |
| `seekMarginLeft?` | `number` | Leaves a non-seekable area on the left side of the image. |
| `seekMarginRight?` | `number` | Leaves a non-seekable area on the right side of the image. |
| `style?` | `string` | Lets you fine-tune the look or spacing of the section. |

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

| Option | Type | Description |
| --- | --- | --- |
| `seekable?` | `boolean` | Lets listeners click the current track image to jump in time. |
| `seekMarginLeft?` | `number` | Leaves a non-seekable area on the left side of the image. |
| `seekMarginRight?` | `number` | Leaves a non-seekable area on the right side of the image. |
| `style?` | `string` | Lets you fine-tune the look or spacing of the section. |

Notes:

- Only works if `exclusiveSolo` is `true`.
- This section uses each track's `image`.
- It appears when one active track has an image to show.

### `waveform`

Use `type: 'waveform'` to show an interactive waveform.

Example:

```javascript
{
  type: 'waveform',
  width: 1200,
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

| Option | Type | Description |
| --- | --- | --- |
| `width?` | `number` | Starting width of the waveform. |
| `height?` | `number` | Height of the waveform. |
| `waveformBarWidth?` | `number` | Thickness of the waveform bars. |
| `maxZoom?` | `number` | The closest zoom level listeners can reach, in seconds. Smaller numbers allow tighter zoom. |
| `waveformSource?` | `'audible' | number | number[]` | Chooses which sound the waveform represents. |
| `playbackFollowMode?` | `'off' | 'center' | 'jump'` | Decides whether the waveform view follows playback automatically. |
| `timer?` | `boolean` | Shows a small time label inside the waveform panel. |
| `seekMarginLeft?` | `number` | Leaves a non-seekable area on the left side. |
| `seekMarginRight?` | `number` | Leaves a non-seekable area on the right side. |
| `style?` | `string` | Lets you fine-tune the look or spacing of the section. |

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

| Option | Type | Description |
| --- | --- | --- |
| `src` | `string` | The MusicXML file to show. |
| `measureColumn?` | `string` | The column in the alignment data that contains measure numbers. |
| `maxWidth?` | `number` | The widest the score area should become. |
| `maxHeight?` | `number` | The tallest the score area should become. |
| `renderScale?` | `number` | Overall score size. |
| `followPlayback?` | `boolean` | Keeps the score view moving with playback. |
| `cursorColor?` | `string` | Color of the playback cursor. |
| `cursorAlpha?` | `number` | Transparency of the playback cursor. |
| `style?` | `string` | Lets you fine-tune the look or spacing of the section. |

Notes:

- The score can still be shown without measure syncing.
- If `measureColumn` is set and matching alignment data is available, listeners can click measures to jump through the music.

### `warpingMatrix`

Use `type: 'warpingMatrix'` to show alignment charts.

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

| Option | Type | Description |
| --- | --- | --- |
| `height?` | `number` | Height of the chart area. |
| `tempoSmoothingSeconds?` | `number` | How broad the tempo reading should feel. Larger values give a smoother curve. |
| `globalScoreBPM?` | `number` | Adds a BPM reading to the tempo chart using this score tempo. |
| `style?` | `string` | Lets you fine-tune the look or spacing of the section. |

Notes:

- This section is only useful in alignment mode.
- It shows two views: the timing relationship between the active track and the shared timeline, and the local tempo change over time.
- When Sync is turned on, this section is dimmed and does not accept interaction.

## Keyboard and Loop Controls

When `features.keyboard` is on, listeners can use:

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

When `features.looping` is on, listeners can also use:

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
- `perTrackImage` is meant for setups where one track is active at a time.
- Presets are most useful when you have at least two preset choices and clear `presetNames`.
- `sheetMusic.measureColumn` only works for clickable measure syncing when matching alignment data is also available.
- `warpingMatrix` is for alignment players, not standard multitrack players.
- In alignment mode, each track needs its own `alignment.column`.
