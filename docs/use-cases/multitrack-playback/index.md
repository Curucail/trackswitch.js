---
layout: default
title: Multitrack Playback
description: Compare synchronized audio tracks on a shared timeline.
permalink: /use-cases/multitrack-playback/
body_class: docs-page docs-page--narrow
---

# Multitrack Playback

Trackswitch is a multitrack audio player. 
Multiple audio files are loaded into the player and can be played back in two different modes: default or solo.
In default mode, multiple tracks can be selected and played back simultaneosly, while in solo mode, only one track is played at a time.

A simple multitrack trackswitch player can be used to compare the output of different processing methods. 
The player below uses solo mode to compares several dereverberation methods.

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

Audio data: S. Braun and E. A. P. Habets, “[Online Dereverberation for Dynamic Scenarios Using a Kalman Filter With an Autoregressive Model](https://doi.org/10.1109/LSP.2016.2616888),” *IEEE Signal Processing Letters*, vol. 23, no. 12, pp. 1741–1745, Dec. 2016. [Accompanying Website](https://www.audiolabs-erlangen.de/resources/2016-SPL-MAR-KALMAN).
