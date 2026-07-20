---
layout: default
title: Documentation
description: Configuration reference for trackswitch.js
permalink: /documentation.html
body_class: docs-page docs-page--config
toc_script: true
---

# Documentation

- [Introduction](#introduction)
- [Quick setup](#quick-setup)
- [Configuration shape](#configuration-shape)
- [Data](#data)
  - [`media`](#media)
  - [`alignment`](#alignment)
  - [`markers`](#markers)
  - [`presets`](#presets)
- [Views](#views)
  - [`image`](#image)
  - [`perTrackImage`](#pertrackimage)
  - [`waveform`](#waveform)
  - [`midi`](#midi)
  - [`sheetMusic`](#sheetmusic)
  - [`warpingMatrix`](#warpingmatrix)
  - [`text`](#text)
  - [`trackList`](#tracklist)
- [Features](#features)
- [Keyboard and loop controls](#keyboard-and-loop-controls)
- [Things to check](#things-to-check)

## Introduction

TrackSwitch is a web-based multitrack audio player for presenting scientific results. Different from ordinary multitrack audio players, trackswitch allows each track to live on its own abstract timeline. This feature allows for a variety of interesting use cases that need some form of aligned audio data. For example, it can be used for comparing different performances of the same piece of music.

The simplest TrackSwitch player is a normal multitrack audio player. In this case, all audio tracks
share the same timeline and can play simultaneously:

```json
{
  "media": {
    "drums": { "type": "audio", "src": "drums.mp3", "title": "Drums" },
    "bass": { "type": "audio", "src": "bass.mp3", "title": "Bass" }
  },
  "views": [
    { "type": "waveform", "sourceTracks": "audible" },
    { "type": "trackList", "tracks": ["drums", "bass"] }
  ]
}
```

For comparative listening, tracks and visual media can also live on separate, abstract
timelines. A timeline is just an ordered coordinate system: it can be seconds, measures in sheet music,
MIDI ticks, or any other unit that makes sense for the material. Add an
`alignment` CSV to connect those timelines. TrackSwitch then projects seeking, playback
positions, loops, markers, and visual cursors through the same alignment graph.

The player configuration is split into data and views. Data describes what exists: audio tracks,
visual media, abstract timelines, alignment data, annotation markers, presets, and
player-wide feature switches. Views describe how that data should appear on the page:
waveforms, images, MIDI piano rolls, sheet music, text, track lists, and warping
visualizations.

Markers are the central concept behind that graph. Alignment CSV rows become dense
correspondence markers between timelines. Authored marker CSV files become annotation
markers such as section labels, beats, events, or analysis points. Runtime markers such as
the playhead and loop points use the same projection path, so a marker placed on one
timeline can be rendered or navigated from another aligned view.

## Quick setup

Use the first row to choose the player type and the second row to choose the integration
method.

<div class="ts-doc-tabs" data-doc-matrix data-doc-matrix-version="default" data-doc-matrix-integration="html" markdown="1">
  <div class="ts-doc-tabs__list ts-doc-tabs__list--versions ts-doc-tabs__list--stacked" aria-label="Player type">
    <button class="ts-doc-tabs__tab is-active" type="button" aria-pressed="true" data-doc-matrix-control="version" data-doc-matrix-value="default">Default</button>
    <button class="ts-doc-tabs__tab" type="button" aria-pressed="false" data-doc-matrix-control="version" data-doc-matrix-value="aligned">Multiple timelines</button>
    <button class="ts-doc-tabs__tab" type="button" aria-pressed="false" data-doc-matrix-control="version" data-doc-matrix-value="interactive">Interactive sync</button>
  </div>
  <div class="ts-doc-tabs__list" aria-label="Integration method">
    <button class="ts-doc-tabs__tab is-active" type="button" aria-pressed="true" data-doc-matrix-control="integration" data-doc-matrix-value="html">HTML</button>
    <button class="ts-doc-tabs__tab" type="button" aria-pressed="false" data-doc-matrix-control="integration" data-doc-matrix-value="esm">ESM</button>
    <button class="ts-doc-tabs__tab" type="button" aria-pressed="false" data-doc-matrix-control="integration" data-doc-matrix-value="react">React</button>
    <button class="ts-doc-tabs__tab" type="button" aria-pressed="false" data-doc-matrix-control="integration" data-doc-matrix-value="vue">Vue</button>
    <button class="ts-doc-tabs__tab" type="button" aria-pressed="false" data-doc-matrix-control="integration" data-doc-matrix-value="svelte">Svelte</button>
  </div>
  <div class="ts-doc-tabs__panel is-active" data-doc-matrix-panel data-doc-matrix-version="default" data-doc-matrix-integration="html" markdown="1">

```html
<script src="dist/js/trackswitch.js"></script>

<trackswitch-player>
  <script type="application/json">
    {
      "media": {
        "drums": { "type": "audio", "src": "drums.mp3", "title": "Drums" },
        "bass": { "type": "audio", "src": "bass.mp3", "title": "Bass" },
        "synth": { "type": "audio", "src": "synth.mp3", "title": "Synth" }
      },
      "views": [
        { "type": "waveform", "sourceTracks": "audible" },
        { "type": "trackList", "tracks": ["drums", "bass", "synth"] }
      ],
      "features": {
        "globalVolume": true,
        "trackVolumeControls": true,
        "trackPanControls": true
      }
    }
  </script>
</trackswitch-player>
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="default" data-doc-matrix-integration="esm" hidden markdown="1">

```ts
import {
  defineTrackswitchDefaultElement,
  type TrackSwitchInit,
} from "trackswitch";

const config: TrackSwitchInit = {
  media: {
    drums: { type: "audio", src: "drums.mp3", title: "Drums" },
    bass: { type: "audio", src: "bass.mp3", title: "Bass" },
    synth: { type: "audio", src: "synth.mp3", title: "Synth" },
  },
  views: [
    { type: "waveform", sourceTracks: "audible" },
    { type: "trackList", tracks: ["drums", "bass", "synth"] },
  ],
  features: {
    globalVolume: true,
    trackVolumeControls: true,
    trackPanControls: true,
  },
};

defineTrackswitchDefaultElement();
const player = document.querySelector("trackswitch-player") as HTMLElement & {
  config: TrackSwitchInit;
};
player.config = config;
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="default" data-doc-matrix-integration="react" hidden markdown="1">

```tsx
import { useMemo } from "react";
import type { TrackSwitchInit } from "trackswitch";
import { TrackSwitchPlayer } from "trackswitch/react";

export function ExamplePlayer() {
  const config = useMemo<TrackSwitchInit>(() => {
    return {
      media: {
        drums: { type: "audio", src: "drums.mp3", title: "Drums" },
        bass: { type: "audio", src: "bass.mp3", title: "Bass" },
        synth: { type: "audio", src: "synth.mp3", title: "Synth" },
      },
      views: [
        { type: "waveform", sourceTracks: "audible" },
        { type: "trackList", tracks: ["drums", "bass", "synth"] },
      ],
      features: {
        globalVolume: true,
        trackVolumeControls: true,
        trackPanControls: true,
      },
    };
  }, []);

  return <TrackSwitchPlayer config={config} className="trackswitch-host" />;
}
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="default" data-doc-matrix-integration="vue" hidden markdown="1">

```vue
<script setup lang="ts">
import type { TrackSwitchInit } from "trackswitch";
import { TrackSwitchPlayer } from "trackswitch/vue";

const config: TrackSwitchInit = {
  media: {
    drums: { type: "audio", src: "drums.mp3", title: "Drums" },
    bass: { type: "audio", src: "bass.mp3", title: "Bass" },
    synth: { type: "audio", src: "synth.mp3", title: "Synth" },
  },
  views: [
    { type: "waveform", sourceTracks: "audible" },
    { type: "trackList", tracks: ["drums", "bass", "synth"] },
  ],
  features: {
    globalVolume: true,
    trackVolumeControls: true,
    trackPanControls: true,
  },
};
</script>

<template>
  <TrackSwitchPlayer :config="config" class="trackswitch-host" />
</template>
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="default" data-doc-matrix-integration="svelte" hidden markdown="1">

```svelte
<script lang="ts">
  import {
    useTrackswitch,
    type TrackswitchSvelteOptions,
  } from "trackswitch/svelte";

  const options: TrackswitchSvelteOptions = {
    config: {
      media: {
        drums: { type: "audio", src: "drums.mp3", title: "Drums" },
        bass: { type: "audio", src: "bass.mp3", title: "Bass" },
        synth: { type: "audio", src: "synth.mp3", title: "Synth" },
      },
      views: [
        { type: "waveform", sourceTracks: "audible" },
        { type: "trackList", tracks: ["drums", "bass", "synth"] },
      ],
      features: {
        globalVolume: true,
        trackVolumeControls: true,
        trackPanControls: true,
      },
    },
  };
</script>

<trackswitch-player use:useTrackswitch={options} class="trackswitch-host" />
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="aligned" data-doc-matrix-integration="html" hidden markdown="1">

```html
<script src="dist/js/trackswitch.js"></script>

<trackswitch-player>
  <script type="application/json">
    {
      "media": {
        "score": { "type": "musicxml", "src": "score.musicxml" },
        "notes": { "type": "midi", "src": "notes.mid" },
        "takeA": {
          "type": "audio",
          "src": "take-a.wav",
          "srcSynchronized": { "src": "take-a-synced.wav", "timeline": "takeA" },
          "title": "Take A"
        },
        "takeB": {
          "type": "audio",
          "src": "take-b.wav",
          "srcSynchronized": { "src": "take-b-synced.wav", "timeline": "takeB" },
          "title": "Take B"
        }
      },
      "alignment": {
        "src": "alignment.csv",
        "referenceTimeline": "score",
        "timelines": {
          "score": "measure",
          "notes": "midi_seconds",
          "takeA": "take_a_seconds",
          "takeB": "take_b_seconds"
        },
        "outside": "clamp"
      },
      "markers": {
        "sections": {
          "src": "sections.csv",
          "timeline": "score",
          "timeCol": "measure",
          "labelCol": "section"
        }
      },
      "views": [
        { "type": "sheetMusic", "mediaID": "score" },
        { "type": "midi", "mediaID": "notes", "timer": true },
        {
          "type": "waveform",
          "sourceTracks": ["takeA"],
          "timer": true,
          "alignedPlayhead": true,
          "markerLayers": [
            { "set": "sections", "color": "#ed8c01" },
            { "set": "alignment", "color": "#777", "foldToReference": true }
          ]
        },
        { "type": "waveform", "sourceTracks": ["takeB"], "timer": true },
        { "type": "warpingMatrix", "x": "takeA", "y": "takeB" },
        { "type": "trackList", "tracks": ["takeA", "takeB"] }
      ],
      "features": {
        "exclusiveSolo": true,
        "looping": true,
        "globalVolume": true
      }
    }
  </script>
</trackswitch-player>
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="aligned" data-doc-matrix-integration="esm" hidden markdown="1">

```ts
import {
  defineTrackswitchDefaultElement,
  type TrackSwitchInit,
} from "trackswitch";

const config: TrackSwitchInit = {
  media: {
    score: { type: "musicxml", src: "score.musicxml" },
    takeA: { type: "audio", src: "take-a.wav", title: "Take A" },
    takeB: { type: "audio", src: "take-b.wav", title: "Take B" },
  },
  alignment: {
    src: "alignment.csv",
    referenceTimeline: "score",
    timelines: {
      score: "measure",
      takeA: "take_a_seconds",
      takeB: "take_b_seconds",
    },
    outside: "clamp",
  },
  views: [
    { type: "sheetMusic", mediaID: "score" },
    { type: "waveform", sourceTracks: ["takeA"], alignedPlayhead: true },
    { type: "waveform", sourceTracks: ["takeB"], alignedPlayhead: true },
    { type: "warpingMatrix", x: "takeA", y: "takeB" },
    { type: "trackList", tracks: ["takeA", "takeB"] },
  ],
  features: { exclusiveSolo: true, looping: true },
};

defineTrackswitchDefaultElement();
const player = document.querySelector("trackswitch-player") as HTMLElement & {
  config: TrackSwitchInit;
};
player.config = config;
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="aligned" data-doc-matrix-integration="react" hidden markdown="1">

```tsx
import { useMemo } from "react";
import type { TrackSwitchInit } from "trackswitch";
import { TrackSwitchPlayer } from "trackswitch/react";

export function AlignedPlayer() {
  const config = useMemo<TrackSwitchInit>(() => ({
    media: {
      score: { type: "musicxml", src: "score.musicxml" },
      takeA: { type: "audio", src: "take-a.wav", title: "Take A" },
      takeB: { type: "audio", src: "take-b.wav", title: "Take B" },
    },
    alignment: {
      src: "alignment.csv",
      referenceTimeline: "score",
      timelines: {
        score: "measure",
        takeA: "take_a_seconds",
        takeB: "take_b_seconds",
      },
    },
    views: [
      { type: "sheetMusic", mediaID: "score" },
      { type: "waveform", sourceTracks: ["takeA"], alignedPlayhead: true },
      { type: "waveform", sourceTracks: ["takeB"], alignedPlayhead: true },
      { type: "trackList", tracks: ["takeA", "takeB"] },
    ],
    features: { exclusiveSolo: true, looping: true },
  }), []);

  return <TrackSwitchPlayer config={config} />;
}
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="aligned" data-doc-matrix-integration="vue" hidden markdown="1">

```vue
<script setup lang="ts">
import type { TrackSwitchInit } from "trackswitch";
import { TrackSwitchPlayer } from "trackswitch/vue";

const config: TrackSwitchInit = {
  media: {
    score: { type: "musicxml", src: "score.musicxml" },
    takeA: { type: "audio", src: "take-a.wav", title: "Take A" },
    takeB: { type: "audio", src: "take-b.wav", title: "Take B" },
  },
  alignment: {
    src: "alignment.csv",
    referenceTimeline: "score",
    timelines: {
      score: "measure",
      takeA: "take_a_seconds",
      takeB: "take_b_seconds",
    },
  },
  views: [
    { type: "sheetMusic", mediaID: "score" },
    { type: "waveform", sourceTracks: ["takeA"], alignedPlayhead: true },
    { type: "waveform", sourceTracks: ["takeB"], alignedPlayhead: true },
    { type: "trackList", tracks: ["takeA", "takeB"] },
  ],
  features: { exclusiveSolo: true, looping: true },
};
</script>

<template>
  <TrackSwitchPlayer :config="config" />
</template>
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="aligned" data-doc-matrix-integration="svelte" hidden markdown="1">

```svelte
<script lang="ts">
  import { useTrackswitch } from "trackswitch/svelte";
  import type { TrackSwitchInit } from "trackswitch";

  const config: TrackSwitchInit = {
    media: {
      score: { type: "musicxml", src: "score.musicxml" },
      takeA: { type: "audio", src: "take-a.wav", title: "Take A" },
      takeB: { type: "audio", src: "take-b.wav", title: "Take B" },
    },
    alignment: {
      src: "alignment.csv",
      referenceTimeline: "score",
      timelines: {
        score: "measure",
        takeA: "take_a_seconds",
        takeB: "take_b_seconds",
      },
    },
    views: [
      { type: "sheetMusic", mediaID: "score" },
      { type: "waveform", sourceTracks: ["takeA"], alignedPlayhead: true },
      { type: "waveform", sourceTracks: ["takeB"], alignedPlayhead: true },
      { type: "trackList", tracks: ["takeA", "takeB"] },
    ],
    features: { exclusiveSolo: true, looping: true },
  };
</script>

<trackswitch-player use:useTrackswitch={{ config }} />
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="interactive" data-doc-matrix-integration="html" hidden markdown="1">

```html
<script src="dist/js/trackswitch.js"></script>

<trackswitch-sync-interactive>
  <script type="application/json">
    {
      "workerUrl": "dist/js/trackswitch-interactive-worker.js"
    }
  </script>
</trackswitch-sync-interactive>
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="interactive" data-doc-matrix-integration="esm" hidden markdown="1">

```ts
import {
  defineTrackSwitchSyncInteractiveElement,
  type InteractiveTrackSwitchInit,
} from "trackswitch/interactive";

const config: InteractiveTrackSwitchInit = {
  workerUrl: "dist/js/trackswitch-interactive-worker.js",
};

defineTrackSwitchSyncInteractiveElement();
const player = document.querySelector("trackswitch-sync-interactive") as HTMLElement & {
  config: InteractiveTrackSwitchInit;
};
player.config = config;
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="interactive" data-doc-matrix-integration="react" hidden markdown="1">

```tsx
import { TrackSwitchSyncInteractive } from "trackswitch/react";
import type { InteractiveTrackSwitchInit } from "trackswitch/interactive";

const config: InteractiveTrackSwitchInit = {
  workerUrl: "dist/js/trackswitch-interactive-worker.js",
};

export function InteractivePlayer() {
  return <TrackSwitchSyncInteractive config={config} />;
}
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="interactive" data-doc-matrix-integration="vue" hidden markdown="1">

```vue
<script setup lang="ts">
import { TrackSwitchSyncInteractive } from "trackswitch/vue";
import type { InteractiveTrackSwitchInit } from "trackswitch/interactive";

const config: InteractiveTrackSwitchInit = {
  workerUrl: "dist/js/trackswitch-interactive-worker.js",
};
</script>

<template>
  <TrackSwitchSyncInteractive :config="config" />
</template>
```

  </div>
  <div class="ts-doc-tabs__panel" data-doc-matrix-panel data-doc-matrix-version="interactive" data-doc-matrix-integration="svelte" hidden markdown="1">

```svelte
<script lang="ts">
  import { useTrackswitch } from "trackswitch/svelte";
  import type { InteractiveTrackSwitchInit } from "trackswitch/interactive";

  const config: InteractiveTrackSwitchInit = {
    workerUrl: "dist/js/trackswitch-interactive-worker.js",
  };
</script>

<trackswitch-sync-interactive
  use:useTrackswitch={{ config, variant: "sync-interactive" }}
/>
```

  </div>
</div>

## Configuration shape

The top-level keys are:

| Key | Required | Description |
| --- | --- | --- |
| `media` | yes | Named audio, MIDI, and MusicXML resources. At least one audio entry is required. |
| `views` | yes | Ordered visual surfaces. At least one view is required. |
| `alignment` | no | Correspondence data connecting two or more timelines. |
| `markers` | no | Named annotation-marker CSV files. |
| `presets` | no | Named groups of audio tracks. |
| `features` | no | Player control and interaction switches. |

Unknown keys are rejected. The old `ui`, `trackGroup`, `sources`, `presetNames`, and
separate default/sync schemas are no longer supported.

## Data

Data keys define the player model. Views reference these IDs later.

### `media`

`media` is a map of stable IDs to source entries. Audio media become playable tracks.
MIDI and MusicXML media are visual resources and do not create audio output.

```json
{
  "media": {
    "violin": {
      "type": "audio",
      "src": "violin.mp3",
      "title": "Violin",
      "image": "violin.png",
      "solo": true,
      "volume": 0.9,
      "pan": -0.2,
      "startOffsetMs": 100,
      "endOffsetMs": 50
    },
    "notes": { "type": "midi", "src": "notes.mid" },
    "score": { "type": "musicxml", "src": "score.musicxml" }
  }
}
```

Audio media options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `"audio"` | - | Marks the entry as a playable audio track. |
| `src` | `string` | - | Audio file URL. |
| `title?` | `string` | media ID | Name shown in track lists. |
| `image?` | `string` | none | Image used by `perTrackImage` and track-based visuals. |
| `solo?` | `boolean` | `false` | Initial on/off state for this track. |
| `volume?` | `number` | `1` | Initial track volume. |
| `pan?` | `number` | `0` | Initial stereo pan. |
| `startOffsetMs?` | `number` | `0` | Trims or pads the beginning. Positive trims; negative adds silence. |
| `endOffsetMs?` | `number` | `0` | Trims or pads the end. Positive trims; negative adds silence. |
| `srcSynchronized?` | `object` | none | Optional pre-warped audio source for aligned playback. |
| `style?` | `string` | none | Inline CSS for that track row. |

`srcSynchronized` names an already synchronized audio file and the local timeline it
belongs to:

```json
{
  "srcSynchronized": { "src": "violin-synchronized.wav", "timeline": "violin" }
}
```

MIDI and MusicXML entries accept only `type` and `src`:

```json
{
  "media": {
    "notes": { "type": "midi", "src": "notes.mid" },
    "score": { "type": "musicxml", "src": "score.musicxml" }
  }
}
```

### `alignment`

Use `alignment` when media do not share one timeline. The CSV contains corresponding
positions across abstract timelines.

```json
{
  "alignment": {
    "src": "alignment.csv",
    "referenceTimeline": "score",
    "timelines": {
      "score": "measure",
      "notes": "midi_seconds",
      "takeA": "take_a_seconds",
      "takeB": "take_b_seconds"
    },
    "outside": "clamp",
    "duplicatePlacements": "average"
  }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | - | CSV file containing timing correspondences. |
| `referenceTimeline` | `string` | - | Timeline used by the main timer, seek bar, loop points, and shared navigation. |
| `timelines` | `Record<string, string>` | - | Maps timeline IDs to CSV column names. |
| `outside?` | `"clamp" \| "linear" \| "error"` | `"error"` | Behavior when projection reaches an unmapped range. |
| `duplicatePlacements?` | `"average" \| "error"` | `"error"` | Behavior when multiple rows map to the same timeline position. |

Timeline IDs usually match media IDs. If a timeline ID names a MusicXML media entry, it is
displayed in measures. Audio, MIDI, and standalone timelines use seconds. `referenceTimeline`
must be one of the keys in `timelines`.

### `markers`

Markers add sparse authored positions to the player. Use them for musical sections,
analysis events, lyrics, beats, or any other meaningful points in time.

```json
{
  "markers": {
    "sections": {
      "src": "sections.csv",
      "timeline": "takeA",
      "timeCol": "start",
      "labelCol": "label"
    }
  }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | - | CSV file containing marker data. |
| `timeline?` | `string` | reference timeline | Timeline used by `timeCol`. |
| `timeCol` | `string` | - | CSV column containing marker positions. |
| `labelCol?` | `string` | none | CSV column containing marker labels. |

Previous/next marker navigation uses only annotation sets authored on tracks that are
currently audible. Track selection and per-track volume changes update the available
navigation targets immediately.

Views render marker sets through `markerLayers`:

```json
{
  "type": "waveform",
  "sourceTracks": ["takeA"],
  "markerLayers": [
    { "set": "sections", "color": "#ed8c01", "line": "dashed" },
    { "set": "alignment", "color": "#777", "foldToReference": true }
  ]
}
```

`set` names a configured marker set. The special `alignment` set exists only when an
`alignment` block is configured. `foldToReference` draws connectors from the current view
timeline back to the reference timeline, which is useful for showing warping points.

Marker layer options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `set` | `string` | - | Marker set ID, or the implicit `alignment` set. |
| `color?` | `string` | current color | Marker color. |
| `line?` | `"solid" \| "dashed"` | `"dashed"` | Marker line style. |
| `foldToReference?` | `boolean` | `false` | Draw timeline-to-reference connectors where applicable. |

### `presets`

Presets define named track groups. They are useful for switching between full mix,
instrument families, or analysis conditions.

```json
{
  "presets": {
    "all": { "label": "All tracks", "tracks": ["violin", "bass", "drums"] },
    "rhythm": { "label": "Rhythm", "tracks": ["bass", "drums"] }
  }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `label?` | `string` | preset ID | Name shown in the UI. |
| `tracks` | `string[]` | - | Audio media IDs included in the preset. |

Presets are disabled when `features.exclusiveSolo` is `true`.

## Views

Views render in declaration order. Every view has a `type`; most views accept optional
`style`. `image`, `perTrackImage`, `waveform`, and `midi` views can be seekable surfaces
and accept `seekMarginLeft`, `seekMarginRight`, and `markerLayers`.

### `image`

Shows one static image, such as cover art, a diagram, or a time-aligned illustration.

```json
{
  "type": "image",
  "src": "cover.png",
  "seekable": true,
  "seekMarginLeft": 3,
  "seekMarginRight": 3,
  "markerLayers": [{ "set": "sections", "line": "solid" }]
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | - | Image file URL. |
| `seekable?` | `boolean` | `false` | Allows clicking or dragging the image to seek. |
| `seekMarginLeft?` | `number` | `0` | Non-seekable margin on the left, in percent. |
| `seekMarginRight?` | `number` | `0` | Non-seekable margin on the right, in percent. |
| `markerLayers?` | `MarkerLayerConfig[]` | none | Marker layers rendered over the seek surface. |
| `style?` | `string` | none | Inline CSS for this view. |

### `perTrackImage`

Shows the `image` of the active audio track. It is intended for exclusive-solo players.

```json
{
  "type": "perTrackImage",
  "seekable": true,
  "markerLayers": [{ "set": "sections" }]
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `seekable?` | `boolean` | `false` | Allows clicking or dragging the current track image to seek. |
| `seekMarginLeft?` | `number` | `0` | Non-seekable margin on the left, in percent. |
| `seekMarginRight?` | `number` | `0` | Non-seekable margin on the right, in percent. |
| `markerLayers?` | `MarkerLayerConfig[]` | none | Marker layers rendered over the seek surface. |
| `style?` | `string` | none | Inline CSS for this view. |

### `waveform`

Shows an interactive waveform. In a normal multitrack player, it can represent all
currently audible tracks. In an aligned player, a fixed-track waveform uses that track's
local timeline.

```json
{
  "type": "waveform",
  "sourceTracks": ["takeA"],
  "height": 120,
  "waveformBarWidth": 1,
  "maxZoom": 5,
  "playbackFollowMode": "center",
  "timeAxis": "individual",
  "timer": true,
  "alignedPlayhead": true,
  "markerLayers": [{ "set": "sections", "color": "#ed8c01" }]
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `sourceTracks?` | `"audible" \| string[]` | `"audible"` | Chooses the audio tracks represented by the waveform. |
| `height?` | `number` | `150` | Waveform height in pixels. |
| `waveformBarWidth?` | `number` | `1` | Thickness of waveform bars. |
| `maxZoom?` | `number` | `5` | Smallest visible interval in seconds. Smaller values allow tighter zoom. |
| `playbackFollowMode?` | `"off" \| "center" \| "jump"` | `"off"` | How the view follows playback. |
| `timeAxis?` | `"shared" \| "individual"` | `"shared"` | Uses the longest audio duration for comparable fixed-track waveforms, or expands each fixed-track waveform to its own duration. |
| `timer?` | `boolean` | `false` | Shows a local timer inside the waveform. |
| `alignedPlayhead?` | `boolean` | `false` | Draws reference-to-local playhead geometry in aligned views. |
| `markerLayers?` | `MarkerLayerConfig[]` | none | Marker layers rendered over the waveform. |

When `alignment` is configured, `sourceTracks` is required and must name exactly one
track. `"audible"` and multi-track fixed waveforms are only valid when all audio shares
one timeline. `timeAxis: "individual"` is available only for aligned, single-track
waveforms. In shared mode, the region after a shorter track ends is shaded in both the
waveform and zoom overview.

### `midi`

Shows a MIDI file as a piano-roll visualization. MIDI files are visual only.

```json
{
  "type": "midi",
  "mediaID": "notes",
  "height": 180,
  "maxZoom": 5,
  "playbackFollowMode": "center",
  "timer": true
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mediaID` | `string` | - | ID of a `media` entry with `type: "midi"`. |
| `height?` | `number` | `180` | Piano-roll height in pixels. |
| `maxZoom?` | `number` | `5` | Smallest visible interval in seconds. |
| `playbackFollowMode?` | `"off" \| "center" \| "jump"` | `"off"` | How the MIDI view follows playback. |
| `timer?` | `boolean` | `false` | Shows a local timer inside the MIDI view. |
| `seekMarginLeft?` | `number` | `0` | Non-seekable margin on the left, in percent. |
| `seekMarginRight?` | `number` | `0` | Non-seekable margin on the right, in percent. |
| `markerLayers?` | `MarkerLayerConfig[]` | none | Marker layers rendered over the piano roll. |
| `style?` | `string` | none | Inline CSS for this view. |

`mediaID` must name a `media` entry with `type: "midi"`. If the same ID is declared in
`alignment.timelines`, the piano roll seeks, follows, loops, and displays markers on its
own local timeline.

### `sheetMusic`

Shows a MusicXML score.

```json
{
  "type": "sheetMusic",
  "mediaID": "score",
  "maxWidth": 1000,
  "maxHeight": 370,
  "renderScale": 0.7,
  "followPlayback": true,
  "cursorColor": "#999999",
  "cursorAlpha": 0.4
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mediaID` | `string` | - | ID of a `media` entry with `type: "musicxml"`. |
| `maxWidth?` | `number` | `1000` | Maximum score width in pixels. |
| `maxHeight?` | `number` | `380` | Maximum score height in pixels. |
| `renderScale?` | `number` | `0.7` | Scale passed to the score renderer. |
| `followPlayback?` | `boolean` | `true` | Keeps the score view moving with playback. |
| `cursorColor?` | `string` | `"#999999"` | Playback cursor color. |
| `cursorAlpha?` | `number` | `0.4` | Playback cursor opacity from `0` to `1`. |
| `style?` | `string` | none | Inline CSS for this view. |

`mediaID` must name a `media` entry with `type: "musicxml"`. If that ID is declared in
`alignment.timelines`, score following and measure seeking use the aligned timeline.

### `warpingMatrix`

Shows the relationship between two aligned timelines.

```json
{
  "type": "warpingMatrix",
  "x": "takeA",
  "y": "takeB",
  "height": 220,
  "tempoSmoothingSeconds": 5
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | `string` | - | Audio timeline ID for the horizontal axis. |
| `y` | `string` | - | Audio timeline ID for the vertical axis. |
| `height?` | `number` | auto | Chart height in pixels. |
| `tempoSmoothingSeconds?` | `number` | none | Smoothing window for local tempo-deviation display. |
| `style?` | `string` | none | Inline CSS for this view. |

`x` and `y` must name timelines declared in `alignment.timelines`.

### `text`

Adds a plain text section.

```json
{
  "type": "text",
  "text": "Compare the two performances",
  "bold": true,
  "italic": false,
  "fontSize": 18,
  "align": "center"
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | `string` | - | Text to show. |
| `bold?` | `boolean` | `false` | Renders the text in bold. |
| `italic?` | `boolean` | `false` | Renders the text in italic. |
| `fontSize?` | `number` | inherited | Font size in pixels. |
| `align?` | `"left" \| "center" \| "right"` | `"center"` | Horizontal text alignment. |
| `style?` | `string` | none | Inline CSS for this view. |

The text is plain text, not HTML.

### `trackList`

Shows audio tracks and track controls.

```json
{
  "type": "trackList",
  "tracks": ["takeA", "takeB"],
  "rowHeight": 52
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `tracks` | `string[]` | - | Audio media IDs shown in this list. |
| `rowHeight?` | `number` | auto | Track row height in pixels. |

`tracks` contains audio media IDs. Use multiple `trackList` views if you want separate
track groups in different parts of the layout.

## Features

`features` controls optional player behavior and UI controls. Omitted options use the
defaults below.

```json
{
  "features": {
    "exclusiveSolo": false,
    "muteOtherPlayerInstances": true,
    "globalVolume": true,
    "trackVolumeControls": true,
    "trackPanControls": true,
    "customizablePanelOrder": false,
    "repeat": false,
    "tabView": false,
    "iosAudioUnlock": true,
    "keyboard": true,
    "looping": true,
    "seekBar": true,
    "timer": true
  }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `exclusiveSolo?` | `boolean` | `false` | Allows only one track to be active at a time. Useful for comparing alternate performances or stems. |
| `muteOtherPlayerInstances?` | `boolean` | `true` | Stops other TrackSwitch players on the same page when this one starts playback. |
| `globalVolume?` | `boolean` | `false` | Shows one master volume control for the whole player. |
| `trackVolumeControls?` | `boolean` | `false` | Shows per-track volume controls. |
| `trackPanControls?` | `boolean` | `false` | Shows per-track left/right pan controls. |
| `customizablePanelOrder?` | `boolean` | `false` | Lets listeners rearrange visible view panels. This affects view order, not track order. |
| `repeat?` | `boolean` | `false` | Starts playback with repeat enabled. |
| `tabView?` | `boolean` | `false` | Renders track rows with a tab-like presentation. |
| `iosAudioUnlock?` | `boolean` | `true` | Helps playback start reliably on iPhone and iPad. Leave this on unless you control the unlock flow yourself. |
| `keyboard?` | `boolean` | `true` | Enables keyboard shortcuts. |
| `looping?` | `boolean` | `false` | Shows A/B loop tools and enables loop interactions. |
| `seekBar?` | `boolean` | `true` | Shows the main seek bar. |
| `timer?` | `boolean` | `true` | Shows the main time display. |

Unknown feature keys are rejected.

## Keyboard and loop controls

When `features.keyboard` is on, these shortcuts are available:

| Keys | Action |
| --- | --- |
| `F1` | Open or close the shortcut help panel. |
| `Space` | Play or pause. |
| `Escape` | Stop and return to the start. |
| `R` | Toggle repeat. |
| `Left` / `Right` | Jump backward or forward by 2 seconds. |
| `Shift + Left` / `Shift + Right` | Jump backward or forward by 5 seconds. |
| `Home` | Go to the start. |
| `Up` / `Down` | Change global volume when `globalVolume` is on. |
| `1` to `0` | Control tracks 1 to 10. |

When `features.looping` is on, these additional shortcuts are available:

| Keys | Action |
| --- | --- |
| `A` | Set loop point A. |
| `B` | Set loop point B. |
| `L` | Turn the loop on or off. |
| `C` | Clear the loop. |

Looping is also available through the loop buttons. On seekable controls, loop regions can
be marked directly with right-click on mouse.

## Things to check

- `media` must contain at least one audio entry.
- `views` must contain at least one view.
- Every ID referenced by `trackList`, `waveform.sourceTracks`, presets, or view `mediaID`
  must exist in `media`.
- `alignment.referenceTimeline` must be one of the keys in `alignment.timelines`.
- Timeline IDs used by `srcSynchronized`, marker sets, MIDI views, sheet music views, and
  warping matrices must match the IDs declared in `alignment.timelines`.
- Seekable `image`, `perTrackImage`, `waveform`, and `midi` views need
  `seekMarginLeft + seekMarginRight` below `100`.
- `perTrackImage` is meant for setups where one track is active at a time
  (`exclusiveSolo: true`).
- `warpingMatrix` requires an `alignment` block.
