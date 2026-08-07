---
layout: default
title: Multi-Instrument Transcription
description: One MIDI transcription of a four-part ensemble, coloured per channel and following the audible tracks.
permalink: /use-cases/multi-instrument-transcription/
body_class: docs-page docs-page--narrow
---

# Multi-Instrument Transcription

A transcription of an ensemble recording usually arrives as a single MIDI file with one channel per instrument. Drawn in one colour, such a file tells you what was played but not by whom.

A `midi` view can pair its channels with the audio tracks of the player. A paired channel takes a colour of its own and is drawn only while its track is audible, so the piano roll always shows exactly the instruments you are hearing.

The player below contains a four-part chorale, each voice recorded separately, together with one MIDI transcription of all four. Switch a voice off and its notes leave the roll; the remaining notes stay where they are.

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

Audio data: [Chorale Bricks](https://www.audiolabs-erlangen.de/resources/MIR/2025-ChoraleBricks), Drese, *Jesu geh voran*. The same recording session appears in [Shared Timeline - Groups]({{ '/use-cases/shared-timeline-groups/' | relative_url }}), where each voice can be heard on several different instruments.

## Pairing channels with tracks

The pairing is declared on the `midi` view, keyed by channel number:

```json
{
  "type": "midi",
  "mediaID": "notes",
  "height": 260,
  "channels": {
    "0": "soprano",
    "1": "alto",
    "2": "tenor",
    "3": "bass"
  }
}
```

Each value names a `media` entry of type `audio`. Two channels may name the same track, which is what a transcription of a two-handed piano part needs.

Colours are handed out by ascending channel number — orange, red, green, blue, then around again. The first colour is the accent of the player, so a roll that pairs a single channel keeps the appearance of an unpaired one. Every colour is a [theming token](../../documentation.html#theming), so a view can override one on its own:

```json
{
  "type": "midi",
  "mediaID": "notes",
  "channels": { "0": "soprano", "1": "alto" },
  "css": { "--ts-color-channel-2": "#8844cc" }
}
```

The track rows repeat the colour of their channel, so the list and the notes read as one code.

## Visibility follows the audible tracks

A paired channel is drawn while its track sounds and is left out while it does not, which is the same rule a waveform with `"tracks": "audible"` follows. Anything that changes the selection therefore changes the roll: a solo button, a preset, a track volume of zero.

A channel the `channels` block leaves out is always drawn, in the accent colour. That way a percussion or click channel with no recording of its own stays visible whatever is selected.

The pitch axis spans every note of the file, hidden channels included. Switching a voice off empties its band of the roll but never rescales the others.

## The track list

The four tracks belong to one `trackList` without a `soloGroup`:

```json
{
  "type": "trackList",
  "tracks": ["soprano", "alto", "tenor", "bass"],
  "trackVolumeControls": true
}
```

Without a `soloGroup` the rows are ordinary toggles, so the four voices sound together and any subset of them can be switched off. A list that declares a `soloGroup` works just as well — its rows behave as radio buttons, and the roll then shows one channel at a time.

## Timelines

The recordings and the transcription share one timeline here, so the player needs no `alignment` block. A transcription that runs on its own clock — a MIDI rendition of a different performance, or one authored in ticks — is aligned like any other medium; see [Aligned Timelines]({{ '/use-cases/aligned-timelines/' | relative_url }}) and [Timeline Units]({{ '/use-cases/timeline-units/' | relative_url }}). Channel colours and channel visibility work the same way in an aligned player.
