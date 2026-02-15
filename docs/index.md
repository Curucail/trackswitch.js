---
title: trackswitch.js
---

## Installation

Simply install using

```shell
$ npm install trackswitch --save
```

alternatively you can manually download and include [`trackswitch.min.css`](https://raw.githubusercontent.com/audiolabs/trackswitch.js/gh-pages/dist/css/trackswitch.min.css) and [`trackswitch.min.js`](https://raw.githubusercontent.com/audiolabs/trackswitch.js/gh-pages/dist/js/trackswitch.min.js) in your page.


## Example

<div class="player" style="margin-top: 30px; margin-bottom: 60px;" preset-names="All Tracks,Violins & Synths,Drums & Bass,Drums Only">
    <canvas class="waveform" width="1200" height="150"></canvas>
    <ts-track title="Violins" data-img="data/violins.png" presets="0,1">
        <ts-source src="data/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synths" data-img="data/synth.png" presets="0,1">
        <ts-source src="data/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-img="data/bass.png" presets="0,2">
        <ts-source src="data/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-img="data/drums.png" presets="0,2,3">
        <ts-source src="data/drums.mp3"></ts-source>
    </ts-track>
</div>

```html
<div class="player" style="margin-top: 30px; margin-bottom: 60px;" preset-names="All Tracks,Violins & Synths,Drums & Bass,Drums Only">
    <!--
      STEM file Halcyon Sky - Koronium 5 by Native Instruments
      https://www.native-instruments.com/en/products/maschine/maschine-expansions/halcyon-sky
    -->
    <canvas class="waveform" width="1200" height="150"></canvas>
    <ts-track title="Violins" data-img="data/violins.png" presets="0,1">
        <ts-source src="data/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synths" data-img="data/synth.png" presets="0,1">
        <ts-source src="data/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-img="data/bass.png" presets="0,2">
        <ts-source src="data/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-img="data/drums.png" presets="0,2,3">
        <ts-source src="data/drums.mp3"></ts-source>
    </ts-track>
</div>
```

## Configuration

See [configuration examples](configuration.md).

## Usage scenarios

See [examples](examples.md).

## Citation

If you use this tool to present your results, please make sure to cite the relevant publication:

Werner, Nils, et al. **"trackswitch.js: A Versatile Web-Based Audio Player for Presenting Scientifc Results."** 3rd web audio conference, London, UK. 2017.

<div class="language-html highlighter-rouge"><pre class="highlight"><code><span></span><span class="nc">@inproceedings</span><span class="p">{</span><span class="nl">werner2017trackswitchjs</span><span class="p">,</span>
  <span class="na">title</span><span class="p">=</span><span class="s">{trackswitch.js: A Versatile Web-Based Audio Player for Presenting Scientifc Results}</span><span class="p">,</span>
  <span class="na">author</span><span class="p">=</span><span class="s">{Nils Werner and Stefan Balke and Fabian-Rober Stöter and Meinard Müller and Bernd Edler}</span><span class="p">,</span>
  <span class="na">booktitle</span><span class="p">=</span><span class="s">{3rd web audio conference, London, UK}</span><span class="p">,</span>
  <span class="na">year</span><span class="p">=</span><span class="s">{2017}</span><span class="p">,</span>
  <span class="na">organization</span><span class="p">=</span><span class="s">{Citeseer}</span>
<span class="p">}</span>
</code></pre></div>
