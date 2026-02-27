---
title: trackswitch.js
---

## Installation

Install from npm:

```shell
npm install trackswitch
```

Or include the bundled files from a build/package:

- `trackswitch.min.css`
- `trackswitch.min.js`

## Quickstart

<div class="player" data-ts-demo="default" style="margin-top: 30px; margin-bottom: 60px;"></div>

```html
<div id="player"></div>

<script src="trackswitch.min.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
    TrackSwitch.createTrackSwitch(document.getElementById('player'), {
        presetNames: ['All Tracks', 'Violins & Synths', 'Drums & Bass', 'Drums Only'],
        tracks: [
            {
                title: 'Violins',
                presets: [0, 1],
                image: 'violins.png',
                sources: [{ src: 'violins.mp3' }],
            },
            {
                title: 'Synths',
                presets: [0, 1],
                image: 'synth.png',
                sources: [{ src: 'synth.mp3' }],
            },
            {
                title: 'Bass',
                presets: [0, 2],
                image: 'bass.png',
                sources: [{ src: 'bass.mp3' }],
            },
            {
                title: 'Drums',
                presets: [0, 2, 3],
                image: 'drums.png',
                sources: [{ src: 'drums.mp3' }],
            },
        ],
        ui: [
            {
                type: 'waveform',
                width: 1200,
                height: 150,
                style: 'margin: 20px auto;',
            },
        ],
        features: {
            looping: true,
            repeat: true,
            globalvolume: true,
            presets: true,
        },
    });
});
</script>
```

## Configuration

See the [configuration guide](configuration.md).

## Usage scenarios

See [examples](examples.md).

## Citation

If you use this tool to present your results, please cite:

Werner, Nils, et al. **"trackswitch.js: A Versatile Web-Based Audio Player for Presenting Scientific Results."** 3rd web audio conference, London, UK. 2017.

<div class="language-html highlighter-rouge"><pre class="highlight"><code><span></span><span class="nc">@inproceedings</span><span class="p">{</span><span class="nl">werner2017trackswitchjs</span><span class="p">,</span>
  <span class="na">title</span><span class="p">=</span><span class="s">{trackswitch.js: A Versatile Web-Based Audio Player for Presenting Scientific Results}</span><span class="p">,</span>
  <span class="na">author</span><span class="p">=</span><span class="s">{Nils Werner and Stefan Balke and Fabian-Rober Stöter and Meinard Müller and Bernd Edler}</span><span class="p">,</span>
  <span class="na">booktitle</span><span class="p">=</span><span class="s">{3rd web audio conference, London, UK}</span><span class="p">,</span>
  <span class="na">year</span><span class="p">=</span><span class="s">{2017}</span><span class="p">,</span>
  <span class="na">organization</span><span class="p">=</span><span class="s">{Citeseer}</span>
<span class="p">}</span>
</code></pre></div>
