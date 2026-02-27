(function () {
  'use strict';

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

  var CONTROL_NAMES = [
    'looping',
    'globalvolume',
    'presets',
    'seekbar',
    'timer',
    'keyboard',
    'waveform',
    'customImage',
    'mute',
    'solo',
    'tabview',
    'radiosolo',
    'repeatEnabled',
  ];

  var REBUILD_TOGGLE_NAMES = [
    'looping',
    'globalvolume',
    'presets',
    'seekbar',
    'timer',
    'keyboard',
    'waveform',
    'customImage',
    'mute',
    'solo',
    'tabview',
    'radiosolo',
  ];

  var DEFAULT_MODEL = {
    looping: true,
    globalvolume: true,
    presets: true,
    seekbar: true,
    timer: true,
    keyboard: true,
    waveform: true,
    customImage: false,
    mute: true,
    solo: true,
    tabview: false,
    radiosolo: false,
    repeatEnabled: false,
  };

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
    var basePath;
    var controller = null;
    var rebuildDebounceTimer = null;
    var rebuildToken = 0;
    var quickstartText = '';
    var arrowFrame = null;
    var arrowPath = null;

    if (
      !playerRoot ||
      !controlsRoot ||
      typeof window.TrackSwitch === 'undefined' ||
      typeof window.TrackSwitch.createTrackSwitch !== 'function'
    ) {
      return;
    }

    basePath = playerRoot.getAttribute('data-ts-base') || 'assets/multitracks';

    function getControl(name) {
      return controlsRoot.querySelector('input[name="' + name + '"]');
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

      arrowFrame = null;
      if (!guideArrow || !showcaseRoot || !codeCallout) {
        return;
      }

      ensureGuideArrowSvg();
      if (!arrowPath) {
        return;
      }

      if (window.matchMedia('(max-width: 1360px)').matches) {
        arrowPath.setAttribute('d', '');
        return;
      }

      showcaseRect = showcaseRoot.getBoundingClientRect();
      playerRect = playerRoot.getBoundingClientRect();
      codeRect = codeCallout.getBoundingClientRect();

      if (!showcaseRect.width || !playerRect.width || !codeRect.width) {
        arrowPath.setAttribute('d', '');
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
    }

    function ensureGuideArrowSvg() {
      var svg;
      var defs;
      var marker;
      var markerPath;

      if (!guideArrow || arrowPath) {
        return;
      }

      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');

      defs = document.createElementNS(SVG_NS, 'defs');
      marker = document.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', 'ts-guide-arrowhead');
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('refX', '6.5');
      marker.setAttribute('refY', '3.5');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'strokeWidth');

      markerPath = document.createElementNS(SVG_NS, 'path');
      markerPath.setAttribute('d', 'M 0 0 L 7 3.5 L 0 7');
      markerPath.setAttribute('fill', 'none');
      markerPath.setAttribute('stroke', 'rgb(137, 138, 139)');
      markerPath.setAttribute('stroke-width', '1.6');
      markerPath.setAttribute('stroke-linecap', 'round');
      markerPath.setAttribute('stroke-linejoin', 'round');

      marker.appendChild(markerPath);
      defs.appendChild(marker);
      svg.appendChild(defs);

      arrowPath = document.createElementNS(SVG_NS, 'path');
      arrowPath.setAttribute('class', 'ts-showcase__guide-path');
      arrowPath.setAttribute('marker-end', 'url(#ts-guide-arrowhead)');
      svg.appendChild(arrowPath);

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
        if (!control) {
          return;
        }
        control.checked = Boolean(model[name]);
      });

      var presetsControl = getControl('presets');
      var presetsRow = presetsControl ? presetsControl.closest('.ts-control-row') : null;
      if (presetsControl) {
        presetsControl.disabled = Boolean(model.radiosolo);
      }
      if (presetsRow) {
        presetsRow.classList.toggle('is-disabled', Boolean(model.radiosolo));
      }
    }

    function readControls() {
      var model = {};
      CONTROL_NAMES.forEach(function (name) {
        var control = getControl(name);
        model[name] = control ? control.checked : Boolean(DEFAULT_MODEL[name]);
      });
      return model;
    }

    function normalizeControlState(model) {
      var normalized = Object.assign({}, model);
      var notes = [];

      if (normalized.radiosolo && normalized.presets) {
        normalized.presets = false;
        notes.push('Presets were turned off because Radio Solo disables presets.');
      }

      if (!normalized.mute && !normalized.solo) {
        normalized.solo = true;
        notes.push('Solo was re-enabled because mute and solo cannot both be disabled.');
      }

      return {
        model: normalized,
        notes: notes,
      };
    }

    function normalizeAndSyncControls() {
      var result = normalizeControlState(readControls());
      syncControlUi(result.model);
      setNote(result.notes);
      renderQuickstartSnippet(result.model);
      return result.model;
    }

    function renderQuickstartSnippet(model) {
      var snippetLines;
      var snippetText;
      if (!quickstartElement) {
        return;
      }

      snippetLines = [
        '<div id="player"></div>',
        '',
        '<script src="trackswitch.min.js"></script>',
        '<script>',
        "document.addEventListener('DOMContentLoaded', function () {",
        "  TrackSwitch.createTrackSwitch(document.getElementById('player'), {",
        "    presetNames: ['All Tracks', 'Violins & Synths', 'Drums & Bass', 'Drums Only'],",
        '    tracks: [',
        "      { title: 'Violins', presets: [0, 1], image: 'violins.png', sources: [{ src: 'violins.mp3' }] },",
        "      { title: 'Synths', presets: [0, 1], image: 'synth.png', sources: [{ src: 'synth.mp3' }] },",
        "      { title: 'Bass', presets: [0, 2], image: 'bass.png', sources: [{ src: 'bass.mp3' }] },",
        "      { title: 'Drums', presets: [0, 2, 3], image: 'drums.png', sources: [{ src: 'drums.mp3' }] },",
        '    ],',
        '    ui: [',
      ];

      if (model.customImage) {
        snippetLines.push(
          "      { type: 'image', src: 'cover.jpg', seekable: false, style: 'margin: 12px auto;' },"
        );
      }

      if (model.waveform) {
        snippetLines.push(
          "      { type: 'waveform', width: 1200, height: 150, style: 'margin: 20px auto;' },"
        );
      }

      snippetLines = snippetLines.concat([
        '    ],',
        '    features: {',
        '      looping: ' + Boolean(model.looping) + ',',
        '      repeat: ' + Boolean(model.repeatEnabled) + ',',
        '      globalvolume: ' + Boolean(model.globalvolume) + ',',
        '      presets: ' + Boolean(model.presets) + ',',
        '      seekbar: ' + Boolean(model.seekbar) + ',',
        '      timer: ' + Boolean(model.timer) + ',',
        '      keyboard: ' + Boolean(model.keyboard) + ',',
        '      waveform: ' + Boolean(model.waveform) + ',',
        '      mute: ' + Boolean(model.mute) + ',',
        '      solo: ' + Boolean(model.solo) + ',',
        '      tabview: ' + Boolean(model.tabview) + ',',
        '      radiosolo: ' + Boolean(model.radiosolo) + ',',
        '    },',
        '  });',
        '});',
        '</script>',
      ]);

      snippetText = snippetLines.join('\n');
      quickstartElement.innerHTML = highlightSnippet(snippetText);
      quickstartElement.className = 'language-html';
      quickstartText = snippetText;
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
              copyQuickstartButton.textContent = 'Copy code';
            }, 1200);
          })
          .catch(function () {
            copyQuickstartButton.textContent = 'Copy failed';
            setTimeout(function () {
              copyQuickstartButton.textContent = 'Copy code';
            }, 1400);
          });
      });
    }

    function buildInitFromModel(model) {
      var uiConfig = [];
      if (model.customImage) {
        uiConfig.push({
          type: 'image',
          src: basePath + '/cover.jpg',
          seekable: false,
          style: 'margin: 12px auto;',
        });
      }

      if (model.waveform) {
        uiConfig.push({
          type: 'waveform',
          width: 1200,
          height: 150,
          style: 'margin: 20px auto;',
        });
      }

      return {
        presetNames: ['All Tracks', 'Violins & Synths', 'Drums & Bass', 'Drums Only'],
        tracks: createBaseTracks(basePath),
        ui: uiConfig,
        features: {
          looping: model.looping,
          repeat: model.repeatEnabled,
          globalvolume: model.globalvolume,
          presets: model.presets,
          seekbar: model.seekbar,
          timer: model.timer,
          keyboard: model.keyboard,
          waveform: model.waveform,
          mute: model.mute,
          solo: model.solo,
          tabview: model.tabview,
          radiosolo: model.radiosolo,
        },
      };
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
        position: typeof playbackState.position === 'number' ? playbackState.position : 0,
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
        if (model.globalvolume) {
          nextController.setVolume(1);
        }
        return;
      }

      nextController.setRepeat(Boolean(stateSnapshot.repeat || model.repeatEnabled));

      if (model.globalvolume && typeof stateSnapshot.volume === 'number') {
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
      controller = window.TrackSwitch.createTrackSwitch(playerRoot, buildInitFromModel(model));
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

    CONTROL_NAMES.forEach(function (name) {
      var control = getControl(name);
      if (!control) {
        return;
      }
      control.checked = Boolean(DEFAULT_MODEL[name]);
    });

    normalizeAndSyncControls();
    bindCopyButton();
    bindControlEvents();
    rebuildPlayer({ preserveState: false });
    scheduleGuideArrowUpdate();
    window.addEventListener('resize', scheduleGuideArrowUpdate);
  });
})();
