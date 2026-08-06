---
layout: default
title: Interactive Alignment
description: A dedicated extension interface for audio, sheet music, and MIDI alignment in the browser.
permalink: /use-cases/interactive-alignment/
body_class: docs-page docs-page--narrow
interactive_demo: true
---

# Interactive Alignment

This example shows that trackswitch can be extended to enable even more use cases.
Here, we present here an interface built on top of trackswitch to perform alignment directly in the browser.
It supports audio data, MusicXML, and MIDI. 
Add your files (via drag-and-drop), and click on "Synchronize", which will compute the alignment locally on your computer. Then, inspect the result directly in the trackswitch player.
Additionaly, you can download the alignment of the different timelines in CSV format.

<div class="ts-usecase-showcase">

  <div class="ts-usecase-showcase__player-stage">
    <trackswitch-sync-interactive
      config-src="player-config.json"
      style="display: block;"></trackswitch-sync-interactive>
  </div>
</div>

## Developing your own extensions

With the help of AI-assisted programming, new users can easily fork the project and create their own extension of trackswitch.
We are excited to see trackswitch being integrated into your projects!
If you are working on a project that aims to extend trackswitch, feel free to contact <mailto:manuel.peters@audiolabs-erlangen.de>. 
