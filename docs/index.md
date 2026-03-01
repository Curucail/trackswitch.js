---
title: trackswitch.js
---

<section class="ts-showcase">
  <div class="ts-showcase__layout">
    <div class="ts-showcase__player-shell">
      <div
        id="ts-showcase-player"
        data-ts-default-base="{{ '/assets/multitracks' | relative_url }}"
        data-ts-alignment-base="{{ '/assets/alignment' | relative_url }}"
      ></div>
    </div>

    <aside id="ts-showcase-controls" class="ts-control-panel" aria-label="TrackSwitch feature controls">
      <h4>Features</h4>
      <div class="ts-control-mode-tabs" role="tablist" aria-label="Showcase mode">
        <button
          type="button"
          class="ts-mode-tab is-active"
          data-ts-mode-button
          data-ts-mode="default"
          role="tab"
          aria-selected="true"
        >
          Default
        </button>
        <button
          type="button"
          class="ts-mode-tab"
          data-ts-mode-button
          data-ts-mode="alignment"
          role="tab"
          aria-selected="false"
        >
          Alignment
        </button>
      </div>

      <div class="ts-control-group">
        <h5>Playback and UI</h5>
        <label class="ts-control-row">
          <span>Looping Controls</span>
          <input type="checkbox" name="looping" checked />
        </label>
        <label class="ts-control-row">
          <span>Global Volume</span>
          <input type="checkbox" name="globalVolume" checked />
        </label>
        <label class="ts-control-row">
          <span>Presets</span>
          <input type="checkbox" name="presets" checked />
        </label>
        <label class="ts-control-row">
          <span>Seekbar</span>
          <input type="checkbox" name="seekBar" checked />
        </label>
        <label class="ts-control-row">
          <span>Timer</span>
          <input type="checkbox" name="timer" checked />
        </label>
        <label class="ts-control-row">
          <span>Keyboard Shortcuts</span>
          <input type="checkbox" name="keyboard" checked />
        </label>
        <label class="ts-control-row">
          <span>Waveform</span>
          <input type="checkbox" name="waveform" checked />
        </label>
        <label class="ts-control-row">
          <span>Custom Cover Image</span>
          <input type="checkbox" name="customImage" />
        </label>
      </div>

      <div class="ts-control-group">
        <h5>Track Behavior</h5>
        <label class="ts-control-row">
          <span>Single Solo Mode</span>
          <input type="checkbox" name="radiosolo" />
        </label>
        <label class="ts-control-row">
          <span>Tab View</span>
          <input type="checkbox" name="tabView" />
        </label>
      </div>

      <div class="ts-control-group">
        <h5>State</h5>
        <label class="ts-control-row">
          <span>Repeat Enabled</span>
          <input type="checkbox" name="repeatEnabled" />
        </label>
      </div>

      <p id="ts-showcase-note" class="ts-control-note" role="status" aria-live="polite"></p>
    </aside>
  </div>

  <div class="ts-showcase__guide-arrow" aria-hidden="true"></div>

  <div class="ts-showcase__code-row">
    <aside class="ts-showcase__code-callout" aria-label="Player configuration preview">
      <h4 class="ts-showcase__code-title">Add this player configuration to your website!</h4>
      <p>Simply copy-paste the following code snippet into your website:</p>
      <div class="ts-snippet-wrap">
        <button id="ts-copy-quickstart" class="ts-copy-btn" type="button">Copy code</button>
        <div class="language-html highlighter-rouge"><div class="highlight"><pre class="highlight"><code id="ts-dynamic-quickstart" class="language-html"></code></pre></div></div>
      </div>
      <p class="ts-showcase__install-label">And install trackswitch.js from npm:</p>
      <pre><code class="language-shell">npm install trackswitch</code></pre>
      <p class="ts-showcase__install-label">Or include the files from the build/package in your website:</p>
      <ul>
        <li><code>trackswitch.min.css</code></li>
        <li><code>trackswitch.min.js</code></li>
      </ul>
    </aside>
  </div>
</section>

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
