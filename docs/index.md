---
title: trackswitch v2
description: Web-Based Multitrack Audio Player for Presenting Scientific Results
---

<section class="ts-hero">
  <div class="ts-hero__row">
    <nav class="site-nav ts-hero__nav" aria-label="Documentation">
      <a href="{{ '/configuration.html' | relative_url }}">Configuration</a>
      <a href="{{ '/examples.html' | relative_url }}">Examples</a>
      <a href="{{ '/citation.html' | relative_url }}">Cite</a>
    </nav>

    <div class="ts-hero__copy">
      <h1>trackswitch <span class="ts-hero__version">v2</span></h1>
      <p class="ts-hero__description">Web-Based Multitrack Audio Player for Presenting Scientific Results</p>
    </div>

    <div class="ts-hero__actions" aria-label="Downloads and links">
      <a class="ts-icon-link" href="https://www.npmjs.com/package/trackswitch" aria-label="View trackswitch on npm">
        <span class="ts-icon-link__badge" aria-hidden="true">npm</span>
      </a>
      <a class="ts-icon-link" href="https://github.com/audiolabs/trackswitch.js" aria-label="View the repository on GitHub">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2C6.48 2 2 6.58 2 12.23c0 4.51 2.87 8.34 6.84 9.69.5.09.68-.22.68-.49 0-.24-.01-1.03-.01-1.87-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.08 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.7.12 2.5.36 1.9-1.33 2.74-1.05 2.74-1.05.55 1.42.2 2.47.1 2.73.64.72 1.03 1.63 1.03 2.75 0 3.95-2.34 4.81-4.58 5.07.36.32.68.95.68 1.92 0 1.39-.01 2.5-.01 2.84 0 .27.18.59.69.49A10.27 10.27 0 0 0 22 12.23C22 6.58 17.52 2 12 2z" />
        </svg>
        <span>GitHub</span>
      </a>
    </div>
  </div>
</section>

<section class="ts-showcase">
  <div class="ts-showcase__layout">
    <aside class="ts-showcase__code-callout" aria-label="Copy player code">
      <h4 class="ts-showcase__code-title">Copy code</h4>
      <p>Paste this player into your website.</p>
      <button id="ts-copy-quickstart" class="ts-copy-btn" type="button">Copy snippet</button>
      <p class="ts-showcase__copy-note">Updates as you change the options.</p>
    </aside>

    <div class="ts-showcase__player-stage">
      <div class="ts-showcase__player-shell">
        <div
          id="ts-showcase-player"
          data-ts-default-base="{{ '/assets/multitracks' | relative_url }}"
          data-ts-alignment-base="{{ '/assets/alignment' | relative_url }}"
        ></div>
      </div>
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
        <h5>Playback</h5>
        <label class="ts-control-row">
          <span>Looping Controls</span>
          <input type="checkbox" name="looping" checked />
        </label>
        <label class="ts-control-row">
          <span>Global Volume</span>
          <input type="checkbox" name="globalVolume" checked />
        </label>
        <label class="ts-control-row">
          <span>Track Mix Controls</span>
          <input type="checkbox" name="trackMixControls" checked />
        </label>
        <label class="ts-control-row">
          <span>Customizable Panel Order</span>
          <input type="checkbox" name="customizablePanelOrder" />
        </label>
        <label class="ts-control-row">
          <span>Presets</span>
          <input type="checkbox" name="presets" checked />
        </label>
        <label class="ts-control-row">
          <span>Repeat Enabled</span>
          <input type="checkbox" name="repeatEnabled" />
        </label>
        <label class="ts-control-row">
          <span>Solo Mode</span>
          <input type="checkbox" name="exclusiveSolo" />
        </label>
      </div>

      <div class="ts-control-group">
        <h5>Visualizations</h5>
        <label class="ts-control-row">
          <span>Seekbar</span>
          <input type="checkbox" name="seekBar" checked />
        </label>
        <label class="ts-control-row">
          <span>Timer</span>
          <input type="checkbox" name="timer" checked />
        </label>
        <label class="ts-control-row">
          <span>Waveform</span>
          <input type="checkbox" name="waveform" checked />
        </label>
        <label class="ts-control-row">
          <span>Custom Cover Image</span>
          <input type="checkbox" name="customImage" />
        </label>
        <label class="ts-control-row">
          <span>Seekable Cover Image</span>
          <input type="checkbox" name="seekableImage" />
        </label>
        <label class="ts-control-row">
          <span>Track-Based Images</span>
          <input type="checkbox" name="trackImageBySolo" />
        </label>
        <label class="ts-control-row">
          <span>Sheet Note Preview (Alignment)</span>
          <input type="checkbox" name="sheetNotePreview" checked />
        </label>
        <label class="ts-control-row">
          <span>Warping Matrix + Local Tempo Deviation (Alignment)</span>
          <input type="checkbox" name="warpingMatrix" />
        </label>
      </div>

      <div class="ts-control-group">
        <h5>Utils</h5>
        <label class="ts-control-row">
          <span>Keyboard Shortcuts</span>
          <input type="checkbox" name="keyboard" checked />
        </label>
        <label class="ts-control-row">
          <span>Tab View</span>
          <input type="checkbox" name="tabView" />
        </label>
      </div>

      <p id="ts-showcase-note" class="ts-control-note" role="status" aria-live="polite"></p>
    </aside>
  </div>
</section>
