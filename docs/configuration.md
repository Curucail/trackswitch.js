---
title: trackswitch.js
---

- [Initialization](#initialization)
- [Configuration](#configuration)
    - [Tracks](#tracks)
        - [Fallback Audio Files](#fallback-audio-files)
        - [Track Styling](#track-styling)
        - [Solo Tracks](#solo-tracks)
        - [Mute Tracks](#mute-tracks)
        - [Track Timing Offsets](#track-timing-offsets)
        - [Track Presets](#track-presets)
    - [Player Behaviour](#player-behaviour)
        - [Keyboard Shortcuts](#keyboard-shortcuts)
        - [Loop/Section Repeat](#loopsection-repeat)
    - [Additional Player Elements](#additional-player-elements)
        - [Additional and Seekable Player Image](#additional-and-seekable-player-image)
        - [Seekable Image Start/Stop Margin](#seekable-image-startstop-margin)
        - [Seekable Image For Each Track](#seekable-image-for-each-track)
        - [Seekable Image Styling](#seekable-image-styling)

# Initialization

Trackswitch requires jQuery and Fontawesome to be included to work, e.g.

```html
<!-- ... -->

<link href="https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css" rel="stylesheet" integrity="sha384-wvfXpqpZZVQGK6TAh5PVlGOfQNHSoD2xbE+QkPxCAFlNEevoEH3Sl0sibVcOQVnN" crossorigin="anonymous" />
<link rel="stylesheet" href="trackswitch.min.css" />

<!-- ... -->

<div class="player">
  <p>
      Example trackswitch.js instance.
  </p>
  <img src="mix.png" class="seekable"/>
  <ts-track title="Drums" data-img="drums.png">
      <ts-source src="drums.mp3" type="audio/mpeg"></ts-source>
  </ts-track>
  <ts-track title="Synth" data-img="synth.png">
      <ts-source src="synth.mp3" type="audio/mpeg"></ts-source>
  </ts-track>
  <ts-track title="Bass" data-img="bass.png">
      <ts-source src="bass.mp3" type="audio/mpeg"></ts-source>
  </ts-track>
  <ts-track title="Violins" data-img="violins.png">
      <ts-source src="violins.mp3" type="audio/mpeg"></ts-source>
  </ts-track>
</div>

<!-- ... -->

<script src="https://code.jquery.com/jquery-3.2.1.min.js" integrity="sha256-hwg4gsxgFZhOsEEamdOYGBf13FyQuiTwlAQgxVSNgt4="crossorigin="anonymous"></script>
<script src="trackswitch.min.js"></script>
<script type="text/javascript">
    jQuery(document).ready(function() {
        jQuery(".player").trackSwitch();
    });
</script>

<!-- ... -->
```

Alternatively you can of course use [Browserify](http://browserify.org/).


# Configuration

## Tracks

Each track is contained in one `ts-track` element and must contain one or more `ts-source` elements:

```html
<div class="player">
    <ts-track title="Violins">
        <ts-source src="violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
</div>
```

<div class="player">
    <ts-track title="Violins">
        <ts-source src="data/multitracks/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="data/multitracks/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="data/multitracks/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="data/multitracks/drums.mp3"></ts-source>
    </ts-track>
</div>

Note that each `ts-source` should always contain a closing element.

### Fallback Audio Files

Due to a [messy Browser compatibility situation](https://developer.mozilla.org/en-US/docs/Web/HTML/Supported_media_formats#Browser_compatibility) it is recommended you define multiple `ts-source`s with different formats for each `ts-track`.

It is recommended, but not required, that you to define the [MIME type](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Complete_list_of_MIME_types) in each `ts-source`.

```html
<div class="player">
    <ts-track title="Violins">
        <ts-source src="violins.mp3" type="audio/mpeg"></ts-source>
        <ts-source src="violins.mp4" type="audio/mp4"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="synth.mp3" type="audio/mpeg"></ts-source>
        <ts-source src="synth.mp4" type="audio/mp4"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="bass.mp3" type="audio/mpeg"></ts-source>
        <ts-source src="bass.mp4" type="audio/mp4"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="drums.mp3" type="audio/mpeg"></ts-source>
        <ts-source src="drums.mp4" type="audio/mp4"></ts-source>
    </ts-track>
</div>
```

### Track Styling

You can use CSS to style each individual `ts-track` element:

```html
<div class="player">
    <ts-track title="Violins" style="background-color: #156090;">
        <ts-source src="violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth" style="background-color: #15737D;">
        <ts-source src="synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" style="background-color: #158769;">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" style="background-color: #159858;">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
</div>
```

<div class="player">
    <ts-track title="Violins" style="background-color: #156090;">
        <ts-source src="data/multitracks/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth" style="background-color: #15737D;">
        <ts-source src="data/multitracks/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" style="background-color: #158769;">
        <ts-source src="data/multitracks/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" style="background-color: #159858;">
        <ts-source src="data/multitracks/drums.mp3"></ts-source>
    </ts-track>
</div>

### Solo Tracks

You can preselect **solo** for individual tracks by using the `solo` attribute within the `ts-track` element, like this: `<ts-track title="Violins" solo>`.

```html
<div class="player">
    <ts-track title="Violins" solo>
        <ts-source src="violins.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Synth" solo>
        <ts-source src="synth.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="bass.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="drums.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
</div>
```

<div class="player">
    <ts-track title="Violins" solo>
        <ts-source src="data/multitracks/violins.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Synth" solo>
        <ts-source src="data/multitracks/synth.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="data/multitracks/bass.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="data/multitracks/drums.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
</div>

### Mute Tracks

You can preselect **mute** for individual tracks by using the `mute` attribute within the `ts-track` element, like this: `<ts-track title="Bass" mute>`.

```html
<div class="player">
    <ts-track title="Violins">
        <ts-source src="violins.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="synth.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Bass" mute>
        <ts-source src="bass.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Drums" mute>
        <ts-source src="drums.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
</div>
```

<div class="player">
    <ts-track title="Violins">
        <ts-source src="data/multitracks/violins.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="data/multitracks/synth.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Bass" mute>
        <ts-source src="data/multitracks/bass.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
    <ts-track title="Drums" mute>
        <ts-source src="data/multitracks/drums.mp3" type="audio/mpeg"></ts-source>
    </ts-track>
</div>

### Track Timing Offsets

Each `ts-source` can optionally define millisecond offsets to trim or pad a track on the timeline using the `start-offset-ms` and `end-offset-ms` attributes.

- Positive values **trim** from the start/end of the audio.
- Negative values **pad** with silence before/after the audio.

The offsets apply to the specific `ts-source` that is decoded. Use these to align and synchronize tracks that start late, end early, or include unwanted lead-in/lead-out.

```html
<div class="player">
    <ts-track title="Violins">
        <ts-source src="violins.mp3" start-offset-ms="-250" end-offset-ms="0"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="synth.mp3" start-offset-ms="120" end-offset-ms="80"></ts-source>
    </ts-track>
</div>
```

### Track Presets

Track presets allow you to define different solo configurations that can be quickly selected via a dropdown menu in the control bar. This is useful for comparing different instrumental combinations (e.g., "Vocals Only", "Drums + Bass", "Full Mix").

**Defining Presets**

To use presets, add a `data-preset-names` attribute to the player div with comma-separated preset names:

```html
<div class="player" data-preset-names="Full Mix,Vocals,Drums + Bass">
    <ts-track title="Vocals" data-presets="0,1">
        <ts-source src="vocals.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-presets="0,2">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-presets="0,2">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Guitar" data-presets="0">
        <ts-source src="guitar.mp3"></ts-source>
    </ts-track>
</div>
```

Each `ts-track` element uses the `data-presets` attribute to define which presets it belongs to (as comma-separated preset indices, 0-indexed).

In the example above:
- **Preset 0** (Full Mix): All tracks are soloed (Vocals, Drums, Bass, Guitar)
- **Preset 1** (Vocals): Only Vocals track is soloed
- **Preset 2** (Drums + Bass): Drums and Bass tracks are soloed

**Auto-Generated Preset Names**

If you don't define `data-preset-names`, preset names will be auto-generated as "Preset 0", "Preset 1", etc.:

```html
<div class="player">
    <ts-track title="Vocals" data-presets="0,1">
        <ts-source src="vocals.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-presets="0,2">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-presets="0,2">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
</div>
```

**Default Preset (Preset 0)**

Preset 0 is automatically created from tracks that have the `solo` attribute. If no tracks explicitly define their preset membership, they won't appear in any preset except those they're assigned to:

```html
<div class="player" data-preset-names="With Drums,Without Drums">
    <ts-track title="Drums" solo data-presets="0">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
</div>
```

**Preset Dropdown Visibility**

The preset selector dropdown only appears in the control bar when **2 or more presets** are defined. With 0 or 1 presets, the dropdown is hidden.

**Preset Behavior**

When a preset is selected:
- All tracks belonging to that preset are **soloed**
- All tracks NOT belonging to that preset are **unsoloed**
- All **mute states are reset to unmuted** (no tracks are muted)

**Interacting with Presets**

- **Click the dropdown** to open the preset selector menu
- **Scroll the mouse wheel** while hovering over the dropdown to cycle through presets
- **Use keyboard** to select from the dropdown (standard HTML select behavior)

Presets can be combined with other player controls—solo, mute, and repeat buttons continue to work normally after a preset is selected.

## Player Behaviour

The player allows for several different settings to be enabled or disabled. This is done using a settings object, for example:

```javascript
var settings = {
    onlyradiosolo: true,
    repeat: true,
};
$(".player").trackSwitch(settings);
```

<div class="customplayer">
    <ts-track title="Violins">
        <ts-source src="data/multitracks/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="data/multitracks/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="data/multitracks/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="data/multitracks/drums.mp3"></ts-source>
    </ts-track>
</div>

Any combination of the following boolean flags is possible, where the indicated value depicts the default value.

 - `mute`: If `true` show mute buttons. Defaults to `true`.
 - `solo`: If `true` show solo buttons. Defaults to `true`.
 - `globalsolo`: If `true` mute all other trackswitch instances when playback starts. Defaults to `true`.
 - `repeat`: If `true` initialize player with repeat button enabled. Defaults to `false`.
 - `radiosolo`: If `true` allow only 1 track to be soloed at a time (makes the <kbd>shift</kbd>+<i class="fa fa-mouse-pointer" aria-hidden="true"></i>click behaviour the default). Useful for comparing rather than mixing tracks. Defaults to `false`.
 - `onlyradiosolo`: If `true` sets both `mute: false` and `radiosolo: true` in one argument. Useful for one track at a time comparison. Also makes the whole track row clickable. Defaults to `false`.
 - `tabview`: If `true` change the layout so tracks are arranged in a 'tab view'. This saves vertical space, for example on a presentation. Defaults to `false`.
 - `iosunmute`: If `true` run a one-time iOS/iPadOS unlock using a silent HTML5 audio element on first user interaction, so WebAudio playback is less likely to be muted by the hardware silent switch. Defaults to `true`.

### Keyboard Shortcuts

trackswitch.js includes keyboard shortcuts for all playback controls:

**Playback Controls**
- <kbd>Space</kbd> - Play / Pause
- <kbd>Escape</kbd> - Stop playback and reset to beginning
- <kbd>R</kbd> - Toggle repeat mode

**Seeking**
- <kbd>←</kbd> / <kbd>→</kbd> - Seek backward/forward 2 seconds
- <kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> - Seek backward/forward 5 seconds
- <kbd>Home</kbd> - Jump to start

**Volume**
- <kbd>↑</kbd> / <kbd>↓</kbd> - Increase/decrease volume by 10%

**Loop/Section Repeat**
- <kbd>A</kbd> - Set loop point A at current position
- <kbd>B</kbd> - Set loop point B at current position
- <kbd>L</kbd> - Toggle loop on/off
- <kbd>Shift</kbd> + <kbd>C</kbd> - Clear loop points

When multiple players exist on a page, the last-clicked player receives keyboard input.

### Loop/Section Repeat

The player supports A/B loop functionality for repeating specific sections of audio. This is useful for practicing, analyzing, or focusing on particular parts of a track.

**Setting Loop Points**

There are multiple ways to define loop points:

1. **Keyboard Shortcuts**: Press <kbd>A</kbd> to set the start point and <kbd>B</kbd> to set the end point at the current playback position. Use <kbd>L</kbd> to toggle the loop on/off, and <kbd>Shift</kbd> + <kbd>C</kbd> to clear both loop points.

2. **UI Buttons**: Click the **A** and **B** buttons in the control bar to set loop points. The loop toggle button (⟲) enables or disables looping, and the clear button (✕) removes the loop points.

3. **Right-Click Drag**: Right-click and drag across the seekbar to quickly select a loop region. The loop automatically enables when both points are set this way.

4. **Draggable Markers**: Once loop points are set, orange markers appear on the seekbar. You can drag these markers to adjust the loop boundaries. A minimum distance of 50ms is enforced between points.

**Loop Behavior**

- When loop points are set, a semi-transparent orange overlay appears on the seekbar showing the loop region.
- During playback, the audio will automatically jump back to point A when reaching point B.
- The loop takes precedence over the track repeat function.
- When seeking with keyboard shortcuts (<kbd>←</kbd>/<kbd>→</kbd>) while a loop is active, the playback position wraps around the loop boundaries with offset preservation, creating smooth circular navigation.
- If playback is started outside the loop region while looping is enabled, it will automatically jump to the loop start point.


## Additional Player Elements

You can add aditional elements directly into the player, e.g. a paragraph `<p>` with some custom styling.

```html
<div class="player">
    <p style="text-align: center;">Example with padded and centered text.</p>
    <ts-track title="Violins">
        <ts-source src="violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
</div>
```

<div class="player">
    <p style="text-align: center;">Example with padded and centered text.</p>
    <ts-track title="Violins">
        <ts-source src="data/multitracks/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="data/multitracks/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="data/multitracks/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="data/multitracks/drums.mp3"></ts-source>
    </ts-track>
</div>

### Additional and Seekable Player Image

You can include images related to the audio content, which can optionally act as a seekable play-head area (similar to the SoundCloud player for example). In the example below, the player below will contain two images, the first of which will also act as a seekable player. **Any number of the images can be set, but only one seekable image is acceptable**.

```html
<div class="player">
    <img class="seekable" src="mix.png">
    <img src="cover.jpg">
    <ts-track title="Violins">
        <ts-source src="violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
</div>
```

<div class="player">
    <img class="seekable" src="data/multitracks/mix.png" />
    <ts-track title="Violins">
        <ts-source src="data/multitracks/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth">
        <ts-source src="data/multitracks/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass">
        <ts-source src="data/multitracks/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums">
        <ts-source src="data/multitracks/drums.mp3"></ts-source>
    </ts-track>
</div>

### Seekable Image Start/Stop Margin

As you can see, the start end end times of the plot don't exactly match with
the seekhead. In this situation you can specify the seekable area margin for each seekable image.

This can be done by specifying the start and stop points as a percentage of the image using the `data-seek-margin-left` and `data-seek-margin-right` attributes.

```html
<div class="player">
    <img class="seekable" data-seek-margin-left="4" data-seek-margin-right="4" src="mix.png">
    <ts-track title="Violins" data-img="violins.png">
        <ts-source src="violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth" data-img="synth.png">
        <ts-source src="synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-img="bass.png">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-img="drums.png">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
</div>
  ```

<div class="player">
    <img class="seekable" data-seek-margin-left="4" data-seek-margin-right="4" src="data/multitracks/mix.png">
    <ts-track title="Violins" data-img="data/multitracks/violins.png">
        <ts-source src="data/multitracks/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth" data-img="data/multitracks/synth.png">
        <ts-source src="data/multitracks/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-img="data/multitracks/bass.png">
        <ts-source src="data/multitracks/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-img="data/multitracks/drums.png">
        <ts-source src="data/multitracks/drums.mp3"></ts-source>
    </ts-track>
</div>


### Seekable Image For Each Track

You can optionally define a more specific image to replace the default when a particular track is played back in solo. This is done by adding an image link in the `data-img` attribute of the chosen `ts-track` element, as seen below.

```html
<div class="player">
    <img class="seekable" data-seek-margin-left="4" data-seek-margin-right="4" src="mix.png">
    <ts-track title="Violins" data-img="violins.png">
        <ts-source src="violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth" data-img="synth.png">
        <ts-source src="synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-img="bass.png">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-img="drums.png">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
</div>
```

<div class="customplayer">
    <img class="seekable" data-seek-margin-left="4" data-seek-margin-right="4" src="data/multitracks/mix.png">
    <ts-track title="Violins" data-img="data/multitracks/violins.png">
        <ts-source src="data/multitracks/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth" data-img="data/multitracks/synth.png">
        <ts-source src="data/multitracks/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-img="data/multitracks/bass.png">
        <ts-source src="data/multitracks/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-img="data/multitracks/drums.png">
        <ts-source src="data/multitracks/drums.mp3"></ts-source>
    </ts-track>
</div>

In the example above, there is a default image as well as specific images defined for the track.

You do not need to define a specific image for every track. If there is no image defined for a track when it is soloed, the default image will be used.

### Seekable Image Styling

The images can be positioned using normal CSS (eg, `width` and `margin` properties). For non-seekable images, this style can be applied using the `style` attribute.

**For `seekable` images this style must be defined in a 'data-style' properly rather than the usual 'style' property.**

```html
<div class="player">
    <img style="margin: 20px auto;" src="cover.jpg">
    <img data-style="width: 80%; margin: auto;" class="seekable" data-seek-margin-left="4" data-seek-margin-right="4" src="mix.png">
    <ts-track title="Violins" data-img="violins.png">
        <ts-source src="violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth" data-img="synth.png">
        <ts-source src="synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-img="bass.png">
        <ts-source src="bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-img="drums.png">
        <ts-source src="drums.mp3"></ts-source>
    </ts-track>
</div>
```

<div class="player">
    <img style="margin: 20px auto;" src="data/multitracks/cover.jpg">
    <img data-style="width: 80%; margin: auto;" class="seekable" data-seek-margin-left="4" data-seek-margin-right="4" src="data/multitracks/mix.png">
    <ts-track title="Violins" data-img="data/multitracks/violins.png">
        <ts-source src="data/multitracks/violins.mp3"></ts-source>
    </ts-track>
    <ts-track title="Synth" data-img="data/multitracks/synth.png">
        <ts-source src="data/multitracks/synth.mp3"></ts-source>
    </ts-track>
    <ts-track title="Bass" data-img="data/multitracks/bass.png">
        <ts-source src="data/multitracks/bass.mp3"></ts-source>
    </ts-track>
    <ts-track title="Drums" data-img="data/multitracks/drums.png">
        <ts-source src="data/multitracks/drums.mp3"></ts-source>
    </ts-track>
</div>
