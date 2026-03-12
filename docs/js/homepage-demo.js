(function () {
  'use strict';

  var MODE_DEFAULT = 'default';
  var MODE_ALIGNMENT = 'alignment';
  var SHOWCASE_WAVEFORM_WIDTH = 760;

  function createBaseTracks(basePath) {
    return [
      {
        title: 'Violins',
        image: basePath + '/violins.png',
        presets: [0, 1],
        sources: [{ src: basePath + '/violins.mp3' }],
      },
      {
        title: 'Synths',
        image: basePath + '/synth.png',
        presets: [0, 1],
        sources: [{ src: basePath + '/synth.mp3' }],
      },
      {
        title: 'Bass',
        image: basePath + '/bass.png',
        presets: [0, 2],
        sources: [{ src: basePath + '/bass.mp3' }],
      },
      {
        title: 'Drums',
        image: basePath + '/drums.png',
        presets: [0, 2, 3],
        sources: [{ src: basePath + '/drums.mp3' }],
      },
    ];
  }

  function createAlignmentTracks(basePath) {
    return [
      {
        title: 'Schubert: Winterreise, D. 911: No. 3 - HU33',
        sources: [{ src: basePath + '/Schubert_D911-03_HU33.wav' }],
        alignment: {
          column: 't1_sec',
          synchronizedSources: [{ src: basePath + '/Schubert_D911-03_HU33.wav' }],
        },
      },
      {
        title: 'Schubert: Winterreise, D. 911: No. 3 - SC06',
        sources: [{ src: basePath + '/Schubert_D911-03_SC06.wav' }],
        alignment: {
          column: 't2_sec',
          synchronizedSources: [{ src: basePath + '/Schubert_D911-03_SC06_syncronized.wav' }],
        },
      },
    ];
  }

  var CONTROL_NAMES = [
    'looping',
    'globalVolume',
    'trackMixControls',
    'customizablePanelOrder',
    'presets',
    'seekBar',
    'timer',
    'keyboard',
    'waveform',
    'sheetNotePreview',
    'warpingMatrix',
    'customImage',
    'seekableImage',
    'trackImageBySolo',
    'exclusiveSolo',
    'tabView',
    'muteOtherPlayerInstances',
    'iosAudioUnlock',
    'repeatEnabled',
  ];

  var REBUILD_TOGGLE_NAMES = [
    'looping',
    'globalVolume',
    'trackMixControls',
    'customizablePanelOrder',
    'presets',
    'seekBar',
    'timer',
    'keyboard',
    'waveform',
    'sheetNotePreview',
    'warpingMatrix',
    'customImage',
    'seekableImage',
    'trackImageBySolo',
    'exclusiveSolo',
    'tabView',
    'muteOtherPlayerInstances',
    'iosAudioUnlock',
  ];

  var MODE_DISABLED_CONTROLS = {
    default: ['sheetNotePreview', 'warpingMatrix'],
    alignment: ['customImage', 'seekableImage', 'presets', 'exclusiveSolo', 'trackImageBySolo'],
  };

  var DEFAULT_MODEL = {
    looping: true,
    globalVolume: true,
    trackMixControls: true,
    customizablePanelOrder: false,
    presets: true,
    seekBar: true,
    timer: true,
    keyboard: true,
    waveform: true,
    sheetNotePreview: false,
    warpingMatrix: false,
    customImage: false,
    seekableImage: false,
    trackImageBySolo: false,
    exclusiveSolo: false,
    tabView: false,
    muteOtherPlayerInstances: true,
    iosAudioUnlock: true,
    repeatEnabled: false,
  };

  var ALIGNMENT_DEFAULT_MODEL = Object.assign({}, DEFAULT_MODEL, {
    presets: false,
    customImage: false,
    seekableImage: false,
    trackImageBySolo: false,
    sheetNotePreview: true,
    warpingMatrix: false,
    exclusiveSolo: true,
  });

  document.addEventListener('DOMContentLoaded', function () {
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var showcaseRoot = document.querySelector('.ts-showcase');
    var playerRoot = document.getElementById('ts-showcase-player');
    var controlsRoot = document.getElementById('ts-showcase-controls');
    var codeCallout = document.querySelector('.ts-showcase__code-callout');
    var guideArrow = document.querySelector('.ts-showcase__guide-arrow');
    var noteElement = document.getElementById('ts-showcase-note');
    var quickstartElement = document.getElementById('ts-dynamic-quickstart');
    var copyQuickstartButton = document.getElementById('ts-copy-quickstart');
    var modeButtons = [];
    var defaultBasePath;
    var alignmentBasePath;
    var currentMode = MODE_DEFAULT;
    var modelByMode;
    var controller = null;
    var rebuildDebounceTimer = null;
    var rebuildToken = 0;
    var quickstartText = '';
    var arrowFrame = null;
    var arrowPath = null;
    var arrowHeadPath = null;

    if (
      !playerRoot ||
      !controlsRoot ||
      typeof window.TrackSwitch === 'undefined' ||
      typeof window.TrackSwitch.createTrackSwitch !== 'function'
    ) {
      return;
    }

    defaultBasePath =
      playerRoot.getAttribute('data-ts-default-base') ||
      playerRoot.getAttribute('data-ts-base') ||
      'assets/multitracks';
    alignmentBasePath =
      playerRoot.getAttribute('data-ts-alignment-base') || 'assets/alignment';

    modeButtons = Array.prototype.slice.call(
      controlsRoot.querySelectorAll('[data-ts-mode-button]')
    );

    modelByMode = {
      default: Object.assign({}, DEFAULT_MODEL),
      alignment: Object.assign({}, ALIGNMENT_DEFAULT_MODEL),
    };

    function isAlignmentMode(mode) {
      return mode === MODE_ALIGNMENT;
    }

    function getBasePathForMode(mode) {
      return isAlignmentMode(mode) ? alignmentBasePath : defaultBasePath;
    }

    function getControl(name) {
      return controlsRoot.querySelector('input[name="' + name + '"]');
    }

    function getModeDisabledControlNames(mode) {
      return MODE_DISABLED_CONTROLS[mode] || [];
    }

    function isControlDisabled(name, model, mode) {
      if (getModeDisabledControlNames(mode).indexOf(name) !== -1) {
        return true;
      }

      if (name === 'seekableImage' && !model.customImage) {
        return true;
      }

      if (name === 'trackImageBySolo' && !model.exclusiveSolo) {
        return true;
      }

      if (name === 'presets' && model.exclusiveSolo) {
        return true;
      }

      return false;
    }

    function syncModeTabs() {
      modeButtons.forEach(function (button) {
        var modeName = button.getAttribute('data-ts-mode') || MODE_DEFAULT;
        var isActive = modeName === currentMode;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    function setNote(messages) {
      if (!noteElement) {
        return;
      }
      var hasMessages = Array.isArray(messages) && messages.length > 0;
      noteElement.textContent = hasMessages ? messages.join(' ') : '';
      noteElement.classList.toggle('is-visible', hasMessages);
    }

    function updateGuideArrowGeometry() {
      var showcaseRect;
      var playerRect;
      var codeRect;
      var startX;
      var startY;
      var endX;
      var endY;
      var control1X;
      var control1Y;
      var control2X;
      var control2Y;
      var tangentX;
      var tangentY;
      var tangentLength;
      var directionX;
      var directionY;
      var headLength = 11;
      var headWidth = 5.5;
      var headBaseX;
      var headBaseY;
      var leftX;
      var leftY;
      var rightX;
      var rightY;

      arrowFrame = null;
      if (!guideArrow || !showcaseRoot || !codeCallout) {
        return;
      }

      ensureGuideArrowSvg();
      if (!arrowPath || !arrowHeadPath) {
        return;
      }

      if (window.matchMedia('(max-width: 1360px)').matches) {
        arrowPath.setAttribute('d', '');
        arrowHeadPath.setAttribute('d', '');
        return;
      }

      showcaseRect = showcaseRoot.getBoundingClientRect();
      playerRect = playerRoot.getBoundingClientRect();
      codeRect = codeCallout.getBoundingClientRect();

      if (!showcaseRect.width || !playerRect.width || !codeRect.width) {
        arrowPath.setAttribute('d', '');
        arrowHeadPath.setAttribute('d', '');
        return;
      }

      startX = codeRect.left - showcaseRect.left + 8;
      startY = codeRect.top - showcaseRect.top + 8;
      endX = playerRect.left - showcaseRect.left - 12;
      endY = playerRect.top - showcaseRect.top + playerRect.height * 0.5;

      if (endX <= startX) {
        endX = startX + 36;
      }

      control1X = Math.max(8, startX - 250);
      control1Y = startY - 100;
      control2X = endX - 350;
      control2Y = endY + 130;

      arrowPath.setAttribute(
        'd',
        'M ' +
          startX +
          ' ' +
          startY +
          ' C ' +
          control1X +
          ' ' +
          control1Y +
          ', ' +
          control2X +
          ' ' +
          control2Y +
          ', ' +
          endX +
          ' ' +
          endY
      );

      tangentX = endX - control2X;
      tangentY = endY - control2Y;
      tangentLength = Math.sqrt(tangentX * tangentX + tangentY * tangentY) || 1;
      directionX = tangentX / tangentLength;
      directionY = tangentY / tangentLength;
      headBaseX = endX - directionX * headLength;
      headBaseY = endY - directionY * headLength;
      leftX = headBaseX - directionY * headWidth;
      leftY = headBaseY + directionX * headWidth;
      rightX = headBaseX + directionY * headWidth;
      rightY = headBaseY - directionX * headWidth;

      arrowHeadPath.setAttribute(
        'd',
        'M ' +
          leftX +
          ' ' +
          leftY +
          ' L ' +
          endX +
          ' ' +
          endY +
          ' L ' +
          rightX +
          ' ' +
          rightY
      );
    }

    function ensureGuideArrowSvg() {
      var svg;

      if (!guideArrow || arrowPath || arrowHeadPath) {
        return;
      }

      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');

      arrowPath = document.createElementNS(SVG_NS, 'path');
      arrowPath.setAttribute('class', 'ts-showcase__guide-path');
      svg.appendChild(arrowPath);

      arrowHeadPath = document.createElementNS(SVG_NS, 'path');
      arrowHeadPath.setAttribute('class', 'ts-showcase__guide-head');
      svg.appendChild(arrowHeadPath);

      guideArrow.innerHTML = '';
      guideArrow.appendChild(svg);
    }

    function scheduleGuideArrowUpdate() {
      if (!guideArrow) {
        return;
      }
      if (arrowFrame) {
        cancelAnimationFrame(arrowFrame);
      }
      arrowFrame = requestAnimationFrame(updateGuideArrowGeometry);
    }

    function syncControlUi(model) {
      CONTROL_NAMES.forEach(function (name) {
        var control = getControl(name);
        var row;
        var disabled;
        if (!control) {
          return;
        }

        control.checked = Boolean(model[name]);
        disabled = isControlDisabled(name, model, currentMode);
        control.disabled = disabled;

        row = control.closest('.ts-control-row');
        if (row) {
          row.classList.toggle('is-disabled', disabled);
        }
      });
    }

    function readControls() {
      var fallbackModel = modelByMode[currentMode] || DEFAULT_MODEL;
      var model = {};
      CONTROL_NAMES.forEach(function (name) {
        var control = getControl(name);
        model[name] = control ? control.checked : Boolean(fallbackModel[name]);
      });
      return model;
    }

    function normalizeControlState(model, mode) {
      var normalized = Object.assign({}, model);
      var notes = [];

      if (isAlignmentMode(mode)) {
        if (normalized.customImage) {
          normalized.customImage = false;
          notes.push('Custom cover image is unavailable in alignment mode.');
        }

        if (normalized.seekableImage) {
          normalized.seekableImage = false;
          notes.push('Seekable cover image is unavailable in alignment mode.');
        }

        if (normalized.presets) {
          normalized.presets = false;
          notes.push('Presets are unavailable in alignment mode.');
        }

        if (!normalized.exclusiveSolo) {
          normalized.exclusiveSolo = true;
          notes.push('Single solo mode is enforced in alignment mode.');
        }
      } else {
        if (normalized.sheetNotePreview) {
          normalized.sheetNotePreview = false;
          notes.push('Sheet note preview is only available in alignment mode.');
        }
        if (normalized.warpingMatrix) {
          normalized.warpingMatrix = false;
          notes.push('Warping matrix is only available in alignment mode.');
        }
      }

      if (normalized.exclusiveSolo && normalized.presets) {
        normalized.presets = false;
        notes.push('Presets were turned off because single solo mode disables presets.');
      }

      if (!normalized.customImage && normalized.seekableImage) {
        normalized.seekableImage = false;
        notes.push('Seekable cover image requires custom cover image to be enabled.');
      }

      if (!normalized.exclusiveSolo && normalized.trackImageBySolo) {
        normalized.trackImageBySolo = false;
        notes.push('Track-based cover image requires single solo mode.');
      }

      return {
        model: normalized,
        notes: notes,
      };
    }

    function renderQuickstartSnippet(model, mode) {
      if (isAlignmentMode(mode)) {
        renderAlignmentQuickstartSnippet(model);
      } else {
        renderDefaultQuickstartSnippet(model);
      }
    }

    function renderDefaultQuickstartSnippet(model) {
      var snippetLines;
      var snippetText;

      snippetLines = [
        '<link rel="stylesheet" href="trackswitch.min.css" />',
        '<script src="trackswitch.min.js"></script>',
        '',
        '<div id="player"></div>',
        '',
        '<script>',
        "document.addEventListener('DOMContentLoaded', function () {",
        "  TrackSwitch.createTrackSwitch(document.getElementById('player'), {",
        "    presetNames: ['All Tracks', 'Violins & Synths', 'Drums & Bass', 'Drums Only'],",
        '    ui: [',
      ];

      if (model.customImage) {
        snippetLines.push(
          "      { type: 'image', src: 'cover.jpg', seekable: " + Boolean(model.seekableImage) + ", style: 'margin: 12px auto;' },"
        );
      }

      if (model.trackImageBySolo) {
        snippetLines.push(
          "      { type: 'perTrackImage', seekable: true },"
        );
      }

      if (model.waveform) {
        snippetLines.push(
          "      { type: 'waveform', width: " + SHOWCASE_WAVEFORM_WIDTH + ", height: 150},"
        );
      }

      snippetLines.push(
        '      {',
        "        type: 'trackGroup',",
        '        trackGroup: [',
        "          { title: 'Violins', presets: [0, 1], image: 'violins.png', sources: [{ src: 'violins.mp3' }] },",
        "          { title: 'Synths', presets: [0, 1], image: 'synth.png', sources: [{ src: 'synth.mp3' }] },",
        "          { title: 'Bass', presets: [0, 2], image: 'bass.png', sources: [{ src: 'bass.mp3' }] },",
        "          { title: 'Drums', presets: [0, 2, 3], image: 'drums.png', sources: [{ src: 'drums.mp3' }] },",
        '        ],',
        '      },'
      );

      snippetLines = snippetLines.concat([
        '    ],',
        '    features: {',
        "      mode: 'default',",
        '      looping: ' + Boolean(model.looping) + ',',
        '      repeat: ' + Boolean(model.repeatEnabled) + ',',
        '      globalVolume: ' + Boolean(model.globalVolume) + ',',
        '      muteOtherPlayerInstances: ' + Boolean(model.muteOtherPlayerInstances) + ',',
        '      trackMixControls: ' + Boolean(model.trackMixControls) + ',',
        '      customizablePanelOrder: ' + Boolean(model.customizablePanelOrder) + ',',
        '      presets: ' + Boolean(model.presets) + ',',
        '      seekBar: ' + Boolean(model.seekBar) + ',',
        '      timer: ' + Boolean(model.timer) + ',',
        '      keyboard: ' + Boolean(model.keyboard) + ',',
        '      waveform: ' + Boolean(model.waveform) + ',',
        '      exclusiveSolo: ' + Boolean(model.exclusiveSolo) + ',',
        '      tabView: ' + Boolean(model.tabView) + ',',
        '      iosAudioUnlock: ' + Boolean(model.iosAudioUnlock) + ',',
        '    },',
        '  });',
        '});',
        '</script>',
      ]);

      snippetText = snippetLines.join('\n');
      quickstartText = snippetText;
      if (!quickstartElement) {
        return;
      }
      quickstartElement.innerHTML = highlightSnippet(snippetText);
      quickstartElement.className = 'language-html';
    }

    function renderAlignmentQuickstartSnippet(model) {
      var snippetLines;
      var snippetText;

      snippetLines = [
        '<link rel="stylesheet" href="trackswitch.min.css" />',
        '',
        '<div id="player"></div>',
        '',
        '<script src="trackswitch.min.js"></script>',
        '<script>',
        "document.addEventListener('DOMContentLoaded', function () {",
        "  TrackSwitch.createTrackSwitch(document.getElementById('player'), {",
        '    alignment: {',
        "      csv: 'dtw_alignment.csv',",
        "      referenceTimeColumn: 't1_sec',",
        "      outOfRange: 'clamp',",
        '    },',
        '    ui: [',
      ];

      if (model.sheetNotePreview) {
        snippetLines.push(
          '      {',
          "        type: 'sheetMusic',",
          "        src: 'Schubert_D911-03.xml',",
          "        measureCsv: 'Schubert_D911-03_HU33_measures.csv',",
          '        maxHeight: 380,',
          '        renderScale: 0.65,',
          '        followPlayback: true,',
          '        cursorColor: \'#999999\',',
          '        cursorAlpha: 0.4,',
          "        style: 'margin: 0px;',",
          '      },'
        );
      }

      if (model.waveform) {
        snippetLines.push(
          "      { type: 'waveform', width: " + SHOWCASE_WAVEFORM_WIDTH + ", height: 120, waveformSource: 0},"
        );
        snippetLines.push(
          "      { type: 'waveform', width: " + SHOWCASE_WAVEFORM_WIDTH + ", height: 120, waveformSource: 1},"
        );
      }

      if (model.warpingMatrix) {
        snippetLines.push(
          "      { type: 'warpingMatrix', height: 240 },"
        );
      }

      if (model.trackImageBySolo) {
        snippetLines.push(
          "      { type: 'perTrackImage', seekable: true },"
        );
      }

      snippetLines.push(
        '      {',
        "        type: 'trackGroup',",
        '        trackGroup: [',
        '          {',
        "            title: 'SC06',",
        "            sources: [{ src: 'Schubert_D911-03_SC06.wav' }],",
        '            alignment: {',
        "              column: 't1_sec',",
        "              synchronizedSources: [{ src: 'Schubert_D911-03_SC06_syncronized.wav' }],",
        '            },',
        '          },',
        '          {',
        "            title: 'HU33',",
        "            sources: [{ src: 'Schubert_D911-03_HU33.wav' }],",
        '            alignment: {',
        "              column: 't2_sec',",
        "              synchronizedSources: [{ src: 'Schubert_D911-03_HU33.wav' }],",
        '            },',
        '          },',
        '        ],',
        '      },'
      );

      snippetLines = snippetLines.concat([
        '    ],',
        '    features: {',
        "      mode: 'alignment',",
        '      looping: ' + Boolean(model.looping) + ',',
        '      repeat: ' + Boolean(model.repeatEnabled) + ',',
        '      globalVolume: ' + Boolean(model.globalVolume) + ',',
        '      muteOtherPlayerInstances: ' + Boolean(model.muteOtherPlayerInstances) + ',',
        '      trackMixControls: ' + Boolean(model.trackMixControls) + ',',
        '      customizablePanelOrder: ' + Boolean(model.customizablePanelOrder) + ',',
        '      presets: ' + Boolean(model.presets) + ',',
        '      seekBar: ' + Boolean(model.seekBar) + ',',
        '      timer: ' + Boolean(model.timer) + ',',
        '      keyboard: ' + Boolean(model.keyboard) + ',',
        '      waveform: ' + Boolean(model.waveform) + ',',
        '      exclusiveSolo: ' + Boolean(model.exclusiveSolo) + ',',
        '      tabView: ' + Boolean(model.tabView) + ',',
        '      iosAudioUnlock: ' + Boolean(model.iosAudioUnlock) + ',',
        '    },',
        '  });',
        '});',
        '</script>',
      ]);

      snippetText = snippetLines.join('\n');
      quickstartText = snippetText;
      if (!quickstartElement) {
        return;
      }
      quickstartElement.innerHTML = highlightSnippet(snippetText);
      quickstartElement.className = 'language-html';
    }

    function applyModeModel(mode) {
      var sourceModel = modelByMode[mode] || DEFAULT_MODEL;
      var result = normalizeControlState(sourceModel, mode);
      modelByMode[mode] = result.model;
      syncControlUi(result.model);
      setNote(result.notes);
      renderQuickstartSnippet(result.model, mode);
    }

    function normalizeAndSyncControls() {
      var result = normalizeControlState(readControls(), currentMode);
      modelByMode[currentMode] = result.model;
      syncControlUi(result.model);
      syncModeTabs();
      setNote(result.notes);
      renderQuickstartSnippet(result.model, currentMode);
      return result.model;
    }

    function escapeHtml(value) {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function highlightSnippet(source) {
      var escaped = escapeHtml(source);

      escaped = escaped.replace(/(&lt;\/?)([a-zA-Z0-9-]+)([^&]*?)(\/?&gt;)/g, function (_, open, tag, attrs, close) {
        var highlightedAttrs = attrs.replace(
          /([a-zA-Z-:]+)(=)(&quot;[^"]*&quot;|'[^']*')/g,
          '<span class="ts-code-attr">$1</span>$2<span class="ts-code-string">$3</span>'
        );
        return open + '<span class="ts-code-tag">' + tag + '</span>' + highlightedAttrs + close;
      });

      escaped = escaped.replace(
        /(&quot;[^"]*&quot;|'[^']*')/g,
        '<span class="ts-code-string">$1</span>'
      );
      escaped = escaped.replace(/\b(true|false)\b/g, '<span class="ts-code-bool">$1</span>');
      escaped = escaped.replace(
        /\b(document|TrackSwitch|function|addEventListener|getElementById|createTrackSwitch)\b/g,
        '<span class="ts-code-keyword">$1</span>'
      );
      escaped = escaped.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b(?=\s*:)/g, '<span class="ts-code-key">$1</span>');

      return escaped;
    }

    function copyTextToClipboard(value) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(value);
      }

      return new Promise(function (resolve, reject) {
        var textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, textArea.value.length);
        try {
          if (document.execCommand('copy')) {
            resolve();
          } else {
            reject(new Error('Copy command failed'));
          }
        } catch (error) {
          reject(error);
        } finally {
          document.body.removeChild(textArea);
        }
      });
    }

    function bindCopyButton() {
      var defaultCopyLabel = 'Copy to clipboard';

      if (!copyQuickstartButton) {
        return;
      }

      copyQuickstartButton.addEventListener('click', function () {
        if (!quickstartText) {
          return;
        }
        copyTextToClipboard(quickstartText)
          .then(function () {
            copyQuickstartButton.textContent = 'Copied to clipboard';
            setTimeout(function () {
              copyQuickstartButton.textContent = defaultCopyLabel;
            }, 1200);
          })
          .catch(function () {
            copyQuickstartButton.textContent = 'Copy failed';
            setTimeout(function () {
              copyQuickstartButton.textContent = defaultCopyLabel;
            }, 1400);
          });
      });
    }

    function buildInitFromModel(model) {
      var basePath = getBasePathForMode(currentMode);
      var uiConfig = [];
      var init;

      if (model.customImage && !isAlignmentMode(currentMode)) {
        uiConfig.push({
          type: 'image',
          src: basePath + '/cover.jpg',
          seekable: Boolean(model.seekableImage),
        });
      }

      if (model.trackImageBySolo) {
        uiConfig.push({
          type: 'perTrackImage',
          seekable: true,
        });
      }

      if (isAlignmentMode(currentMode) && model.sheetNotePreview) {
        uiConfig.push({
          type: 'sheetMusic',
          src: basePath + '/Schubert_D911-03.xml',
          measureCsv: basePath + '/Schubert_D911-03_HU33_measures.csv',
          maxHeight: 380,
          renderScale: 0.65,
          followPlayback: true,
          cursorColor: '#999999',
          cursorAlpha: 0.4,
        });
      }

      if (model.waveform) {
        if (isAlignmentMode(currentMode)) {
          uiConfig.push({
            type: 'waveform',
            width: SHOWCASE_WAVEFORM_WIDTH,
            height: 120,
            waveformSource: 0,
          });
          uiConfig.push({
            type: 'waveform',
            width: SHOWCASE_WAVEFORM_WIDTH,
            height: 120,
            waveformSource: 1,
          });
        } else {
          uiConfig.push({
            type: 'waveform',
            width: SHOWCASE_WAVEFORM_WIDTH,
            height: 150,
          });
        }
      }

      if (isAlignmentMode(currentMode) && model.warpingMatrix) {
        uiConfig.push({
          type: 'warpingMatrix',
          height: 240,
        });
      }

      init = {
        ui: uiConfig,
        features: {
          mode: currentMode,
          looping: model.looping,
          repeat: model.repeatEnabled,
          globalVolume: model.globalVolume,
          muteOtherPlayerInstances: model.muteOtherPlayerInstances,
          trackMixControls: model.trackMixControls,
          customizablePanelOrder: model.customizablePanelOrder,
          presets: model.presets,
          seekBar: model.seekBar,
          timer: model.timer,
          keyboard: model.keyboard,
          waveform: model.waveform,
          exclusiveSolo: model.exclusiveSolo,
          tabView: model.tabView,
          iosAudioUnlock: model.iosAudioUnlock,
        },
      };

      if (isAlignmentMode(currentMode)) {
        uiConfig.push({
          type: 'trackGroup',
          trackGroup: createAlignmentTracks(basePath),
        });

        init.alignment = {
          csv: basePath + '/dtw_alignment.csv',
          referenceTimeColumn: 't1_sec',
          outOfRange: 'clamp',
        };
      } else {
        uiConfig.push({
          type: 'trackGroup',
          trackGroup: createBaseTracks(basePath),
        });

        init.presetNames = ['All Tracks', 'Violins & Synths', 'Drums & Bass', 'Drums Only'];
      }

      return init;
    }

    function snapshotControllerState(activeController) {
      if (!activeController || typeof activeController.getState !== 'function') {
        return null;
      }

      var snapshot = activeController.getState();
      var playbackState = snapshot && snapshot.state ? snapshot.state : {};

      return {
        isLoaded: Boolean(snapshot && snapshot.isLoaded),
        playing: Boolean(playbackState.playing),
        position:
          typeof playbackState.position === 'number' ? playbackState.position : 0,
        volume: typeof playbackState.volume === 'number' ? playbackState.volume : 1,
        repeat: Boolean(playbackState.repeat),
      };
    }

    function restoreState(nextController, stateSnapshot, model) {
      if (!nextController) {
        return;
      }

      if (!stateSnapshot || !stateSnapshot.isLoaded) {
        nextController.setRepeat(Boolean(model.repeatEnabled));
        if (model.globalVolume) {
          nextController.setVolume(1);
        }
        return;
      }

      nextController.setRepeat(Boolean(stateSnapshot.repeat || model.repeatEnabled));

      if (model.globalVolume && typeof stateSnapshot.volume === 'number') {
        nextController.setVolume(stateSnapshot.volume);
      }

      if (typeof stateSnapshot.position === 'number') {
        nextController.seekTo(stateSnapshot.position);
      }

      if (stateSnapshot.playing) {
        nextController.play();
      }
    }

    function rebuildPlayer(options) {
      var preserveState = !options || options.preserveState !== false;
      var model = normalizeAndSyncControls();
      var snapshot = preserveState ? snapshotControllerState(controller) : null;
      var currentToken;
      var loadPromise;

      if (controller && typeof controller.destroy === 'function') {
        controller.destroy();
      }

      playerRoot.innerHTML = '';
      controller = window.TrackSwitch.createTrackSwitch(
        playerRoot,
        buildInitFromModel(model)
      );
      controller.setRepeat(Boolean(model.repeatEnabled));
      scheduleGuideArrowUpdate();

      currentToken = rebuildToken + 1;
      rebuildToken = currentToken;
      loadPromise = controller.load();

      if (!loadPromise || typeof loadPromise.then !== 'function') {
        restoreState(controller, snapshot, model);
        return;
      }

      loadPromise
        .then(function () {
          if (currentToken !== rebuildToken) {
            return;
          }
          restoreState(controller, snapshot, model);
          scheduleGuideArrowUpdate();
        })
        .catch(function () {
          if (currentToken !== rebuildToken) {
            return;
          }
          setNote(['Unable to load one or more demo audio sources.']);
        });
    }

    function scheduleRebuild() {
      if (rebuildDebounceTimer) {
        clearTimeout(rebuildDebounceTimer);
      }
      rebuildDebounceTimer = setTimeout(function () {
        rebuildDebounceTimer = null;
        rebuildPlayer({ preserveState: true });
      }, 100);
    }

    function bindModeTabs() {
      modeButtons.forEach(function (button) {
        button.addEventListener('click', function () {
          var nextMode = button.getAttribute('data-ts-mode') || MODE_DEFAULT;
          if (nextMode !== MODE_DEFAULT && nextMode !== MODE_ALIGNMENT) {
            return;
          }
          if (nextMode === currentMode) {
            return;
          }

          modelByMode[currentMode] = normalizeControlState(
            readControls(),
            currentMode
          ).model;

          currentMode = nextMode;
          syncModeTabs();
          applyModeModel(currentMode);
          rebuildPlayer({ preserveState: false });
        });
      });
    }

    function bindControlEvents() {
      REBUILD_TOGGLE_NAMES.forEach(function (name) {
        var control = getControl(name);
        if (!control) {
          return;
        }
        control.addEventListener('change', function () {
          normalizeAndSyncControls();
          scheduleRebuild();
        });
      });

      var repeatControl = getControl('repeatEnabled');
      if (repeatControl) {
        repeatControl.addEventListener('change', function () {
          var model = normalizeAndSyncControls();
          if (controller && typeof controller.setRepeat === 'function') {
            controller.setRepeat(Boolean(model.repeatEnabled));
          }
        });
      }
    }

    syncModeTabs();
    applyModeModel(currentMode);
    bindCopyButton();
    bindModeTabs();
    bindControlEvents();
    rebuildPlayer({ preserveState: false });
    scheduleGuideArrowUpdate();
    window.addEventListener('resize', scheduleGuideArrowUpdate);
  });
})();
