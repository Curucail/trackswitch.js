---
layout: default
title: Markers Across Timelines
description: Measure markers projected from one performance onto another.
permalink: /use-cases/markers-across-timelines/
body_class: docs-page docs-page--narrow
---

# Markers

Markers can be used to visualize annotations in audio and music data.
In trackswitch, markers are displayed as vertical bars inside of views.
Markers can also be used for navigation: Clicking on a marker seeks to that specific position.
They are automatically projected between timelines, meaning that a marker set can be defined in one timeline and then be visualized on a view that lives on another timeline.
In the example below, markers are defined only once for HU33 and are automatically projected onto the SC06 timeline. 
Thus, both waveforms show the same musical positions at their correct playback times.

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

Audio data: [Schubert Winterreise Dataset](https://www.audiolabs-erlangen.de/resources/MIR/SWD), *Gefrorne Tränen*, D. 911, No. 3, performances HU33 and SC06.

## How it works

A marker identifies one position on a timeline. It can also contain a label.

Markers belong to **timelines**, not to media items. This relationship makes marker projection possible.

The player reads the source timeline of each marker. Then it maps the marker position to each aligned timeline.

This marker set contains annotations on the `hu33` timeline:

```json
"markers": {
  "measures": {
    "src": "../../assets/alignment/HU33-markers.csv",
    "timeline": "hu33",
    "timeCol": "start",
    "labelCol": "label"
  }
}
```

The CSV contains a time column and optionally, a label column.
The unit of values in the time column should match the unit of the timline the marker set lives in.

```
start;label
0.243809524;Measure 0.750
0.993764172;Measure 1
3.524489796;Measure 2
5.988843537;Measure 3
```

The waveform views then specify which marker sets should be displayed in their view:

```json
"views": [
  {
    "type": "waveform",
    "tracks": ["hu33"],
    "height": 90,
    "markerLayers": [
      { "set": "measures", "color": "#ed8c01", "line": "dashed" }
    ]
  },
  {
    "type": "waveform",
    "tracks": ["sc06"],
    "height": 90,
    "markerLayers": [
      { "set": "measures", "color": "#ed8c01", "line": "dashed" }
    ]
  },
]
```

The player then maps each marker without changing or duplicating the annotation file.
