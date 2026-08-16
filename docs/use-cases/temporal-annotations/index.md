---
layout: default
title: Navigating Temporal Annotations
description: Structural boundaries as navigable markers, with stepping and looping between them.
permalink: /use-cases/temporal-annotations/
body_class: docs-page docs-page--narrow
---

# Navigating Temporal Annotations

Analysis results such as beat positions or structural boundaries are lists of time
positions. Written as numbers they reveal little about their relationship to the music
they describe. As a marker sequence they become visible on the waveform and, more
importantly, they become targets for interaction: listeners can step from one boundary
to the next, or loop a passage between two of them and hear the evidence for a
particular segmentation.

The player below shows the structural boundaries of a multitrack arrangement. Use the
marker navigation control to jump between sections, and the loop controls to repeat one
of them.

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

## How it works

The annotations are one marker sequence. Its CSV carries a position column and a label
column, and the labels are what the navigation dialog searches:

```
time,label
0.4,Intro
11.3,Verse
48,Pre-Chorus
59,Chorus
```

```json
"markers": {
  "sections": {
    "src": "../../assets/multitracks/showcase-markers.csv",
    "timeCol": "time",
    "labelCol": "label"
  }
}
```

All four stems are different microphones of one recording, so they share a single
timeline and the sequence needs no `timeline` key. With an
[`alignment`]({{ '/documentation.html#alignment' | relative_url }}) present, the key
names the timeline the positions are read on, and the player projects the markers onto
every other timeline.

A sequence becomes visible — and navigable — through a `markerLayers` entry on a view:

```json
{
  "type": "waveform",
  "tracks": "audible",
  "height": 110,
  "markerLayers": [
    { "sequence": "sections", "color": "#ed8c01", "line": "dashed" }
  ]
}
```

Because this waveform draws the audible tracks, changing the selection keeps the same
annotations in view. Previous/next navigation only reaches sequences that some view
draws, so a sequence with no layer stays invisible to the keyboard shortcuts as well.

## Beat and downbeat annotations

Beat tracking output is configured exactly the same way: one row per estimated beat,
with the downbeats distinguished by their label.

```json
"markers": {
  "beats": { "src": "beats.csv", "timeCol": "time", "labelCol": "beat" }
}
```

Two things make such a player useful for judging an estimate. First, add a sonification
of the estimated beats — short clicks mixed with the recording — as a second audio track
next to the original, so listeners can switch between them with a
[`comparisonGroup`]({{ '/documentation.html#tracklist' | relative_url }}) and hear
whether the clicks follow the pulse. Second, set a loop over a short passage, so a local
error can be heard repeatedly rather than once. Comparing two systems is a matter of
adding a second marker sequence with its own colour: two estimates that score alike can
still make audibly different errors.

Audio data: multitrack arrangement bundled with the trackswitch demo assets.
