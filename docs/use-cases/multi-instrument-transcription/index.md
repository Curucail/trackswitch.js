---
layout: default
title: Multi-Channel MIDI
description: One MIDI transcription of a four-part ensemble, coloured per channel and following the audible tracks.
permalink: /use-cases/multi-instrument-transcription/
body_class: docs-page docs-page--narrow
---

# Multi-Channel MIDI

MIDI files can contain note events on multiple channels.
This is often used to encode different instruments playing at the same time.
One example where this is useful is Multi-Instrument Transcription.
Trackswitch supports displaying multiple MIDI channels in MIDI views, where note events are colored per channel.

<div class="ts-usecase-showcase">
  <aside class="ts-usecase-showcase__code-callout" aria-label="Copy player code">
    <h4 class="ts-usecase-showcase__code-title">Hover to show player config</h4>
    <button class="ts-copy-btn" type="button">Copy to clipboard</button>
  </aside>

  <div class="ts-usecase-showcase__player-stage">
    <trackswitch-player
      config-src="player-config.json"
      style="display: block;"></trackswitch-player>
  </div>

  <div class="ts-usecase-showcase__snippet-panel" aria-label="Code preview">
    <pre class="ts-usecase-showcase__snippet-shell"><code></code></pre>
  </div>
</div>

Audio data: [ChoraleWind](https://www.audiolabs-erlangen.de/resources/MIR/2026-ChoraleWind), Drese, *Jesu geh voran*.

## How it works

MIDI views color the note events separately per channel by default — `colorPerChannel` defaults to `true`, so this needs no configuration even for a single combined recording:

```json
{
  "type": "midi",
  "mediaID": "notes",
  "height": 260
}
```

Additionally, specific tracks can be assigned to each MIDI channel to show or hide MIDI note events depending on the audible track selection:

```json
{
  "type": "midi",
  "mediaID": "notes",
  "height": 260,
  "channelToTrackIDMap": {
    "0": "soprano",
    "1": "alto",
    "2": "tenor",
    "3": "bass"
  }
}
```

Each value names a media entry of type `audio`. Two channels may name the same track, which is what a transcription of a two-handed piano part needs — the track's row then shows both colours, split with a hard edge.

A channel `channelToTrackIDMap` leaves out is still coloured — it's just always drawn, regardless of which tracks are audible. Setting `colorPerChannel` to `false` turns coloring off entirely, so every channel falls back to the plain accent, whether or not it's paired with a track:

```json
{
  "type": "midi",
  "mediaID": "notes",
  "colorPerChannel": false,
  "channelToTrackIDMap": { "0": "soprano", "1": "alto" }
}
```

Colours are handed out by ascending channel number — orange, red, green, blue, purple, brown, pink, gray, olive, cyan, then around again. The first colour is the accent of the player, so a roll with a single channel keeps the appearance of an unpaired one. Every colour is a [theming token](../../documentation.html#theming), so a view can override one on its own:

```json
{
  "type": "midi",
  "mediaID": "notes",
  "channelToTrackIDMap": { "0": "soprano", "1": "alto" },
  "css": { "--ts-color-channel-2": "#8844cc" }
}
```