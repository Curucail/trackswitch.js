---
layout: default
title: "Tutorials & Use Cases"
description: Complete trackswitch examples for multitrack playback, images, markers, and aligned timelines.
permalink: /use-cases/
body_class: docs-page docs-page--narrow
---

# Tutorials & Use Cases

Here you can find different examples on how to configure and use trackswitch for your use case.
We show pre-configured players and explain the main concepts behind it.

## Basic

<ul class="ts-usecase-list">
  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/multitrack-playback/' | relative_url }}">Multitrack Playback (Default)</a></h2>
    <p>
      Mix four synchronized tracks with looping, presets, global volume, and per-track controls.
    </p>
  </li>

  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/images/' | relative_url }}">Seekable Images</a></h2>
    <p>
      Display a seekable plot for all tracks, or show a different plot for each active track.
    </p>
  </li>

  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/aligned-timelines/' | relative_url }}">Aligned Timelines</a></h2>
    <p>
      This player contains two performances with different tempos and durations. Its configuration also aligns sheet music and MIDI.
      The complete model connects separate media timelines with alignment points.
    </p>
  </li>
  
  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/markers-across-timelines/' | relative_url }}">Markers</a></h2>
    <p>
      This player shows marker projection. One annotation file contains positions on the timeline of one performance.
      The other performance shows these markers at the corresponding musical positions.
    </p>
  </li>
</ul>

## Advanced

<ul class="ts-usecase-list">
  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/shared-timeline-groups/' | relative_url }}">Shared Timeline - Groups</a></h2>
    <p>
      Four track groups on one shared timeline, each playing one instrument at a time.
      Pick an instrument per voice to assemble your own ensemble.
    </p>
  </li>

  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/repeated-section/' | relative_url }}">A Repeated Section</a></h2>
    <p>
      One performance plays a section twice, the other one skips it.
      The playhead of the shorter performance jumps back and runs through the section a second time.
    </p>
  </li>

  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/separated-stems/' | relative_url }}">Separated Stems on Aligned Timelines</a></h2>
    <p>
      Two performances, each taken apart into harmonic, percussive and residual stems.
      The first level of selection picks the performance, the second mixes the stems inside it.
    </p>
  </li>

  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/multi-instrument-transcription/' | relative_url }}">Multi-Instrument Transcription</a></h2>
    <p>
      One MIDI file transcribes a four-part ensemble. Each channel is paired with a recording,
      takes a colour of its own, and is drawn only while that instrument is audible.
      A second player shows the same transcription flying into a piano keyboard.
    </p>
  </li>

  <li class="ts-usecase-card">
    <h2><a href="{{ '/use-cases/timeline-units/' | relative_url }}">Timeline Units</a></h2>
    <p>
      Alignment columns do not have to be in seconds. Declare samples, MIDI ticks, measures or pixels
      and let the player convert them into playback coordinates.
    </p>
  </li>

  <li class="ts-usecase-card">
	<h2><a href="{{ '/use-cases/interactive-alignment/' | relative_url }}">Interactive Alignment</a></h2>
	<p>
	  Drop recordings, sheet music, or MIDI into the player to calculate a timeline alignment in the browser.
	</p>
  </li>
</ul>
