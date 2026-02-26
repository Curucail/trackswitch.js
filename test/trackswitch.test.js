const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;

global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

if (dom.window.HTMLMediaElement && dom.window.HTMLMediaElement.prototype) {
    dom.window.HTMLMediaElement.prototype.canPlayType = function() {
        return 'probably';
    };
    dom.window.HTMLMediaElement.prototype.play = function() {
        return Promise.resolve();
    };
    dom.window.HTMLMediaElement.prototype.pause = function() {
        return undefined;
    };
    dom.window.HTMLMediaElement.prototype.load = function() {
        return undefined;
    };
}

class MockGain {
    constructor() {
        this.gain = {
            value: 1,
            cancelScheduledValues() {},
            setValueAtTime() {},
            linearRampToValueAtTime() {},
        };
    }

    connect() {}

    disconnect() {}
}

class MockSource {
    constructor() {
        this.buffer = null;
    }

    connect() {}

    disconnect() {}

    start() {}

    stop() {}
}

class MockAudioContext {
    constructor() {
        this.destination = {};
        this.currentTime = 0;
    }

    createGain() {
        return new MockGain();
    }

    createBufferSource() {
        return new MockSource();
    }

    decodeAudioData(_buffer, onSuccess, _onError) {
        onSuccess({
            duration: 10,
            getChannelData() {
                const data = new Float32Array(2048);
                for (let i = 0; i < data.length; i += 1) {
                    data[i] = Math.sin(i / 15);
                }
                return data;
            },
        });
    }

    resume() {
        return Promise.resolve();
    }
}

global.AudioContext = MockAudioContext;
global.XMLHttpRequest = class MockXHR {
    constructor() {
        this.readyState = 0;
        this.status = 0;
        this.response = null;
        this.onreadystatechange = null;
    }

    open() {}

    send() {
        this.readyState = 4;
        this.status = 200;
        this.response = new ArrayBuffer(8);
        if (typeof this.onreadystatechange === 'function') {
            this.onreadystatechange();
        }
    }
};

const trackSwitch = require(path.resolve(__dirname, '../dist/tmp/ts/trackswitch.js'));
const {
    WaveformEngine,
    createInitialPlayerState,
    createTrackSwitch,
    formatSecondsToHHMMSSmmm,
    inferSourceMimeType,
    parsePresetIndices,
    parseTrackSwitchMarkup,
    playerStateReducer,
} = trackSwitch;

function dispatchMouse(target, type, options = {}) {
    target.dispatchEvent(new dom.window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...options,
    }));
}

function createController(init, markup) {
    document.body.innerHTML = markup || '<div class="player"></div>';
    const root = document.querySelector('.player');
    assert.ok(root, 'root should exist');
    return createTrackSwitch(root, init);
}

test.afterEach(() => {
    document.body.innerHTML = '';
});

test('waveform peaks handle tiny buffers with large widths', () => {
    const engine = new WaveformEngine();
    const mockBuffer = {
        getChannelData() {
            return new Float32Array([0.2, -0.5, 0.1, 0.9]);
        },
    };

    const peaks = engine.calculateWaveformPeaks(mockBuffer, 64);
    assert.equal(peaks.length, 64);
    assert.ok(peaks.some((value) => value > 0), 'peaks should contain non-zero values');
});

test('waveform cache keeps separate peak widths per track', () => {
    const engine = new WaveformEngine();

    const runtime = {
        state: { mute: false, solo: false },
        buffer: {
            getChannelData() {
                const data = new Float32Array(2000);
                for (let i = 0; i < data.length; i += 1) {
                    data[i] = Math.sin(i / 7);
                }
                return data;
            },
        },
        waveformCache: new Map(),
    };

    const wide = engine.calculateMixedWaveform([runtime], 300, 1);
    const narrow = engine.calculateMixedWaveform([runtime], 120, 1);

    assert.equal(wide.length, 300);
    assert.equal(narrow.length, 120);
    assert.equal(runtime.waveformCache.size, 2, 'cache should keep separate entries per width');
});

test('player state reducer handles repeat and loop transitions', () => {
    let state = createInitialPlayerState(false);

    state = playerStateReducer(state, { type: 'set-position', position: 1.25 });
    state = playerStateReducer(state, { type: 'toggle-repeat' });
    state = playerStateReducer(state, { type: 'set-loop-point', marker: 'A', position: 1, minDistance: 0.1 });
    state = playerStateReducer(state, { type: 'set-loop-point', marker: 'B', position: 3, minDistance: 0.1 });
    state = playerStateReducer(state, { type: 'toggle-loop' });

    assert.equal(state.repeat, true);
    assert.equal(state.position, 1.25);
    assert.equal(state.loop.pointA, 1);
    assert.equal(state.loop.pointB, 3);
    assert.equal(state.loop.enabled, true);
});

test('preset application updates solo state without DOM coupling', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false },
        tracks: [
            { title: 'A', presets: [0], sources: [{ src: 'a.mp3' }] },
            { title: 'B', presets: [1], sources: [{ src: 'b.mp3' }] },
        ],
    });

    controller.applyPreset(1);
    const snapshot = controller.getState();

    assert.equal(snapshot.tracks[0].solo, false);
    assert.equal(snapshot.tracks[1].solo, true);
    assert.equal(snapshot.tracks[0].mute, false);
    assert.equal(snapshot.tracks[1].mute, false);

    controller.destroy();
});

test('initial preset is applied to state and solo button classes', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false },
        tracks: [
            { title: 'A', presets: [0], sources: [{ src: 'a.mp3' }] },
            { title: 'B', presets: [1], sources: [{ src: 'b.mp3' }] },
            { title: 'C', presets: [0], sources: [{ src: 'c.mp3' }] },
        ],
    });

    const snapshot = controller.getState();
    assert.equal(snapshot.tracks[0].solo, true);
    assert.equal(snapshot.tracks[1].solo, false);
    assert.equal(snapshot.tracks[2].solo, true);

    const firstSolo = document.querySelector('.track_list li.track:nth-child(1) .solo');
    const secondSolo = document.querySelector('.track_list li.track:nth-child(2) .solo');
    const thirdSolo = document.querySelector('.track_list li.track:nth-child(3) .solo');

    assert.ok(firstSolo && secondSolo && thirdSolo);
    assert.equal(firstSolo.classList.contains('checked'), true);
    assert.equal(secondSolo.classList.contains('checked'), false);
    assert.equal(thirdSolo.classList.contains('checked'), true);

    controller.destroy();
});

test('presets are disabled when onlyradiosolo is enabled', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, onlyradiosolo: true },
        tracks: [
            { title: 'A', presets: [0], sources: [{ src: 'a.mp3' }] },
            { title: 'B', presets: [0], sources: [{ src: 'b.mp3' }] },
            { title: 'C', presets: [1], sources: [{ src: 'c.mp3' }] },
        ],
    });

    assert.equal(document.querySelector('.preset-selector'), null);

    const initial = controller.getState();
    assert.equal(initial.tracks[0].solo, true);
    assert.equal(initial.tracks[1].solo, false);
    assert.equal(initial.tracks[2].solo, false);

    controller.applyPreset(1);
    const afterPresetAttempt = controller.getState();
    assert.equal(afterPresetAttempt.tracks[0].solo, true);
    assert.equal(afterPresetAttempt.tracks[1].solo, false);
    assert.equal(afterPresetAttempt.tracks[2].solo, false);

    controller.destroy();
});

test('preset selector can be hidden via presets feature', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, presets: false },
        tracks: [
            { title: 'A', presets: [0], sources: [{ src: 'a.mp3' }] },
            { title: 'B', presets: [1], sources: [{ src: 'b.mp3' }] },
        ],
    });

    assert.equal(document.querySelector('.preset-selector'), null);

    controller.destroy();
});

test('timer feature can disable timing tracker UI', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, timer: false },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
    });

    assert.equal(document.querySelector('.main-control .timing'), null);

    controller.destroy();
});

test('controller destroy tears down rendered UI', async () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
    });

    await controller.load();
    controller.play();
    controller.destroy();

    const snapshot = controller.getState();
    assert.equal(snapshot.isDestroyed, true);
    assert.equal(document.querySelectorAll('.main-control').length, 0);
    assert.equal(document.querySelectorAll('.track_list').length, 0);
});

test('dragging a loop marker does not seek the playhead', async () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: true },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
    });

    await controller.load();

    controller.seekTo(2);
    controller.setLoopPoint('A');
    controller.seekTo(6);
    controller.setLoopPoint('B');
    controller.seekTo(4);

    const initialPosition = controller.getState().state.position;

    const markerA = document.querySelector('.loop-marker.marker-a');
    assert.ok(markerA, 'loop marker A should exist');

    dispatchMouse(markerA, 'mousedown', { button: 0, pageX: 1 });
    assert.equal(controller.getState().state.position, initialPosition);

    dispatchMouse(window, 'mousemove', { button: 0, pageX: 0 });
    assert.equal(controller.getState().state.position, initialPosition);

    dispatchMouse(window, 'mouseup', { button: 0, pageX: 0 });
    assert.equal(controller.getState().state.position, initialPosition);

    controller.destroy();
});

test('keyboard shortcuts are scoped to active instance', async () => {
    document.body.innerHTML = '<div id="a" class="player"></div><div id="b" class="player"></div>';

    const rootA = document.getElementById('a');
    const rootB = document.getElementById('b');
    assert.ok(rootA && rootB);

    const controllerA = createTrackSwitch(rootA, {
        features: { waveform: false, keyboard: true, looping: false },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
    });

    const controllerB = createTrackSwitch(rootB, {
        features: { waveform: false, keyboard: true, looping: false },
        tracks: [{ title: 'B', sources: [{ src: 'b.mp3' }] }],
    });

    await controllerA.load();
    await controllerB.load();

    let seenA = 0;
    let seenB = 0;

    const originalA = controllerA.seekRelative.bind(controllerA);
    const originalB = controllerB.seekRelative.bind(controllerB);

    controllerA.seekRelative = function(seconds) {
        seenA += 1;
        originalA(seconds);
    };

    controllerB.seekRelative = function(seconds) {
        seenB += 1;
        originalB(seconds);
    };

    dispatchMouse(rootA, 'mousedown', { button: 0 });
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    assert.equal(seenA, 1);
    assert.equal(seenB, 0);

    dispatchMouse(rootB, 'mousedown', { button: 0 });
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    assert.equal(seenA, 1);
    assert.equal(seenB, 1);

    controllerB.destroy();
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    assert.equal(seenA, 1);
    assert.equal(seenB, 1);

    dispatchMouse(rootA, 'mousedown', { button: 0 });
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    assert.equal(seenA, 2);
    assert.equal(seenB, 1);

    controllerA.destroy();
});

test('createTrackSwitch parses ts-track markup when tracks are omitted', async () => {
    document.body.innerHTML = [
        '<div class="player" preset-names="One,Two">',
        '  <ts-track title="Lead" presets="0" data-img="lead.png">',
        '    <ts-source src="lead.mp3" type="audio/mpeg"></ts-source>',
        '  </ts-track>',
        '  <ts-track title="Bass" presets="1">',
        '    <ts-source src="bass.mp3"></ts-source>',
        '  </ts-track>',
        '</div>',
    ].join('');

    const root = document.querySelector('.player');
    assert.ok(root);

    const controller = createTrackSwitch(root, {
        features: { waveform: false, keyboard: false, looping: false },
    });

    await controller.load();
    const snapshot = controller.getState();

    assert.equal(snapshot.tracks.length, 2);
    assert.equal(snapshot.isLoaded, true);

    controller.destroy();
});

test('parseTrackSwitchMarkup parses declarative tracks without jQuery', () => {
    document.body.innerHTML = [
        '<div class="player">',
        '  <ts-track title="Track A" presets="0,2" data-seek-margin-left="5" data-seek-margin-right="10">',
        '    <ts-source src="a.mp3" start-offset-ms="100"></ts-source>',
        '  </ts-track>',
        '</div>',
    ].join('');

    const root = document.querySelector('.player');
    assert.ok(root);

    const tracks = parseTrackSwitchMarkup(root);

    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, 'Track A');
    assert.deepEqual(tracks[0].presets, [0, 2]);
    assert.equal(tracks[0].sources.length, 1);
    assert.equal(tracks[0].sources[0].startOffsetMs, 100);
});

test('utility exports remain available as named exports', () => {
    assert.deepEqual(parsePresetIndices('1x,-2,3,4'), [3, 4]);
    assert.equal(
        inferSourceMimeType('https://cdn.example/audio/file.MP3?x=1#frag', undefined, { '.mp3': 'audio/mpeg;' }),
        'audio/mpeg;'
    );
    assert.equal(formatSecondsToHHMMSSmmm(1.9996), '00:00:02:000');
});
