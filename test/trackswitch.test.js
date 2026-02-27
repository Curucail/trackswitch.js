const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
});

const mockTextResponses = new Map();
let mockAudioWorkletUnsupported = false;
let mockAudioWorkletModuleFailure = false;
const mockAddedWorkletModules = [];
const mockSourceInstances = [];
const mockWorkletNodeInstances = [];

function createMockAudioWorklet() {
    return {
        addModule(url) {
            mockAddedWorkletModules.push(String(url));
            if (mockAudioWorkletModuleFailure) {
                return Promise.reject(new Error('addModule failed'));
            }
            return Promise.resolve();
        },
    };
}

function setMockTextResponse(url, content) {
    const absoluteUrl = new URL(url, dom.window.location.href).href;
    mockTextResponses.set(absoluteUrl, String(content));
}

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLImageElement = dom.window.HTMLImageElement;
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
        this.playbackRate = new MockAudioParam(1);
    }

    connect() {}

    disconnect() {}

    start(...args) {
        this.startArgs = args;
    }

    stop() {}
}

class MockAudioParam {
    constructor(initialValue) {
        this.value = initialValue;
    }

    setValueAtTime(value) {
        this.value = value;
    }
}

function createMockAudioBuffer(durationSeconds = 10, sampleRate = 1000, channelCount = 2) {
    const length = Math.max(1, Math.round(durationSeconds * sampleRate));
    const channels = Array.from({ length: channelCount }, function(_, channelIndex) {
        const data = new Float32Array(length);
        for (let i = 0; i < length; i += 1) {
            data[i] = Math.sin((i + channelIndex * 17) / 15);
        }
        return data;
    });

    return {
        duration: durationSeconds,
        sampleRate: sampleRate,
        numberOfChannels: channelCount,
        length: length,
        getChannelData(channelIndex) {
            const safeIndex = Math.max(0, Math.min(channelCount - 1, channelIndex));
            return channels[safeIndex];
        },
    };
}

class MockAudioWorkletNode {
    constructor(_context, _name) {
        mockWorkletNodeInstances.push(this);
        this.parameters = new Map([
            ['rate', new MockAudioParam(1)],
            ['tempo', new MockAudioParam(1)],
        ]);
    }

    connect() {}

    disconnect() {}
}

class MockAudioContext {
    constructor() {
        MockAudioContext.latestInstance = this;
        this.destination = {};
        this.currentTime = 0;
        this.audioWorklet = mockAudioWorkletUnsupported
            ? undefined
            : createMockAudioWorklet();
    }

    createGain() {
        return new MockGain();
    }

    createBufferSource() {
        const source = new MockSource();
        mockSourceInstances.push(source);
        return source;
    }

    createBuffer(numberOfChannels, length, sampleRate) {
        const channelCount = Math.max(1, Number(numberOfChannels) || 1);
        const frameLength = Math.max(1, Number(length) || 1);
        const rate = Math.max(1, Number(sampleRate) || 1000);
        const durationSeconds = frameLength / rate;
        return createMockAudioBuffer(durationSeconds, rate, channelCount);
    }

    decodeAudioData(_buffer, onSuccess, _onError) {
        onSuccess(createMockAudioBuffer(10, 1000, 2));
    }

    resume() {
        return Promise.resolve();
    }
}

global.AudioContext = MockAudioContext;
global.AudioWorkletNode = MockAudioWorkletNode;
global.XMLHttpRequest = class MockXHR {
    constructor() {
        this.readyState = 0;
        this.status = 0;
        this.response = null;
        this.responseText = '';
        this.responseType = '';
        this.url = '';
        this.onreadystatechange = null;
        this.onerror = null;
    }

    open(_method, url) {
        this.url = new URL(url, dom.window.location.href).href;
    }

    send() {
        this.readyState = 4;

        if (this.responseType === 'arraybuffer') {
            this.status = 200;
            this.response = new ArrayBuffer(8);
        } else {
            const text = mockTextResponses.get(this.url);
            if (typeof text === 'string') {
                this.status = 200;
                this.responseText = text;
                this.response = text;
            } else {
                this.status = 404;
                this.responseText = '';
                this.response = null;
            }
        }

        if (typeof this.onreadystatechange === 'function') {
            this.onreadystatechange();
        }
    }
};

const trackSwitch = require(path.resolve(__dirname, '../dist/tmp/ts/trackswitch.js'));
const seekHelpers = require(path.resolve(__dirname, '../dist/tmp/ts/seek.js'));
const {
    WaveformEngine,
    createInitialPlayerState,
    createTrackSwitch,
    formatSecondsToHHMMSSmmm,
    inferSourceMimeType,
    parsePresetIndices,
    playerStateReducer,
} = trackSwitch;
const { getSeekMetrics } = seekHelpers;

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
    mockTextResponses.clear();
    mockAudioWorkletUnsupported = false;
    mockAudioWorkletModuleFailure = false;
    mockAddedWorkletModules.length = 0;
    mockSourceInstances.length = 0;
    mockWorkletNodeInstances.length = 0;
    if (MockAudioContext.latestInstance) {
        MockAudioContext.latestInstance.currentTime = 0;
        MockAudioContext.latestInstance.audioWorklet = createMockAudioWorklet();
    }
});

test('createTrackSwitch throws when tracks are omitted', () => {
    document.body.innerHTML = '<div class="player"></div>';
    const root = document.querySelector('.player');
    assert.ok(root);

    assert.throws(() => createTrackSwitch(root), {
        message: 'TrackSwitch requires init.tracks with at least one track.',
    });
});

test('createTrackSwitch throws when tracks are empty', () => {
    document.body.innerHTML = '<div class="player"></div>';
    const root = document.querySelector('.player');
    assert.ok(root);

    assert.throws(() => createTrackSwitch(root, { tracks: [] }), {
        message: 'TrackSwitch requires init.tracks with at least one track.',
    });
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

test('mixed waveform keeps silence after shorter track ends on longer timeline', () => {
    const engine = new WaveformEngine();

    const shortData = new Float32Array(5000).fill(0.8);
    const longSilentData = new Float32Array(10000);

    const shortRuntime = {
        state: { mute: false, solo: false },
        buffer: {
            duration: 5,
            sampleRate: 1000,
            getChannelData() {
                return shortData;
            },
        },
        timing: {
            trimStart: 0,
            padStart: 0,
            audioDuration: 5,
            effectiveDuration: 5,
        },
        waveformCache: new Map(),
    };

    const longSilentRuntime = {
        state: { mute: false, solo: false },
        buffer: {
            duration: 10,
            sampleRate: 1000,
            getChannelData() {
                return longSilentData;
            },
        },
        timing: {
            trimStart: 0,
            padStart: 0,
            audioDuration: 10,
            effectiveDuration: 10,
        },
        waveformCache: new Map(),
    };

    const mixed = engine.calculateMixedWaveform([shortRuntime, longSilentRuntime], 100, 1, 10);
    assert.ok(mixed);
    assert.ok(mixed.slice(0, 45).some((value) => value > 0), 'early timeline should contain waveform data');
    assert.ok(mixed.slice(55).every((value) => value === 0), 'late timeline should be silent after short track ends');
});

test('waveform mapping respects padStart offsets on the shared timeline', () => {
    const engine = new WaveformEngine();

    const delayedData = new Float32Array(4000).fill(0.9);
    const delayedRuntime = {
        state: { mute: false, solo: false },
        buffer: {
            duration: 4,
            sampleRate: 1000,
            getChannelData() {
                return delayedData;
            },
        },
        timing: {
            trimStart: 0,
            padStart: 2,
            audioDuration: 4,
            effectiveDuration: 6,
        },
        waveformCache: new Map(),
    };

    const mapped = engine.calculateMixedWaveform([delayedRuntime], 100, 1, 10);
    assert.ok(mapped);
    assert.ok(mapped.slice(0, 15).every((value) => value === 0), 'timeline should be silent before padStart');
    assert.ok(mapped.slice(20, 55).some((value) => value > 0), 'timeline should contain waveform data after padStart');
    assert.ok(mapped.slice(65).every((value) => value === 0), 'timeline should return to silence after audioDuration');
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
    assert.equal(controller.getState().features.presets, false);

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

test('presets are disabled when radiosolo is enabled', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, radiosolo: true },
        tracks: [
            { title: 'A', presets: [0], sources: [{ src: 'a.mp3' }] },
            { title: 'B', presets: [1], sources: [{ src: 'b.mp3' }] },
            { title: 'C', presets: [0], sources: [{ src: 'c.mp3' }] },
        ],
    });

    assert.equal(document.querySelector('.preset-selector'), null);
    assert.equal(controller.getState().features.presets, false);

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

test('createTrackSwitch ignores legacy declarative markup when tracks are provided', () => {
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
        tracks: [{ title: 'Lead', sources: [{ src: 'lead.mp3' }] }],
    });

    assert.ok(controller);
    controller.destroy();
});

test('ui image config injects seekable image and margins', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, seekbar: true },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
        ui: [{
            type: 'image',
            src: 'cover.png',
            seekable: true,
            style: 'margin: 10px auto;',
            seekMarginLeft: 5,
            seekMarginRight: 10,
        }],
    });

    const image = document.querySelector('img.seekable');
    assert.ok(image);
    assert.equal(image.getAttribute('src'), 'http://localhost/cover.png');
    assert.equal(image.getAttribute('data-seek-margin-left'), '5');
    assert.equal(image.getAttribute('data-seek-margin-right'), '10');

    const wrapper = document.querySelector('.seekable-img-wrap');
    assert.ok(wrapper);
    assert.ok(wrapper.getAttribute('style').includes('margin: 10px auto;'));

    const seekWrap = wrapper.querySelector('.seekwrap');
    assert.ok(seekWrap);
    assert.ok(seekWrap.getAttribute('style').includes('left: 5%'));
    assert.ok(seekWrap.getAttribute('style').includes('right: 10%'));

    controller.destroy();
});

test('ui config allows at most one seekable image', () => {
    document.body.innerHTML = '<div class="player"></div>';
    const root = document.querySelector('.player');
    assert.ok(root);

    assert.throws(() => createTrackSwitch(root, {
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
        ui: [
            { type: 'image', src: 'cover-a.png', seekable: true },
            { type: 'image', src: 'cover-b.png', seekable: true },
        ],
    }), {
        message: 'TrackSwitch UI config supports at most one seekable image.',
    });
});

test('ui waveform element injects default canvas dimensions', () => {
    const controller = createController({
        features: { waveform: true, keyboard: false, looping: false },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
        ui: [{ type: 'waveform' }],
    });

    const canvases = document.querySelectorAll('canvas.waveform');
    assert.equal(canvases.length, 1);

    const canvas = canvases[0];
    assert.ok(canvas);
    assert.equal(canvas.width, 1200);
    assert.equal(canvas.height, 150);
    assert.equal(canvas.getAttribute('data-waveform-bar-width'), '1');
    assert.ok(document.querySelector('.waveform-wrap'));

    controller.destroy();
});

test('ui element ordering supports mixed image and waveform entries', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
        ui: [
            {
                type: 'waveform',
                width: 640,
                height: 96,
                waveformBarWidth: 3,
                style: 'margin: 8px 0;',
                seekMarginLeft: 3,
                seekMarginRight: 7,
            },
            {
                type: 'image',
                src: 'cover.png',
                seekable: true,
                style: 'margin: 10px auto;',
                seekMarginLeft: 5,
                seekMarginRight: 10,
            },
            {
                type: 'waveform',
                width: 480,
                height: 72,
                waveformBarWidth: 5,
                style: 'margin: 4px 0;',
            },
        ],
    });

    const canvases = document.querySelectorAll('canvas.waveform');
    assert.equal(canvases.length, 2);

    const firstCanvas = canvases[0];
    const secondCanvas = canvases[1];

    assert.equal(firstCanvas.width, 640);
    assert.equal(firstCanvas.height, 96);
    assert.equal(firstCanvas.getAttribute('data-waveform-bar-width'), '3');
    assert.equal(firstCanvas.getAttribute('data-seek-margin-left'), '3');
    assert.equal(firstCanvas.getAttribute('data-seek-margin-right'), '7');

    assert.equal(secondCanvas.width, 480);
    assert.equal(secondCanvas.height, 72);
    assert.equal(secondCanvas.getAttribute('data-waveform-bar-width'), '5');

    const wrappers = document.querySelectorAll('.waveform-wrap');
    const imageWrappers = document.querySelectorAll('.seekable-img-wrap');
    assert.equal(wrappers.length, 2);
    assert.equal(imageWrappers.length, 1);
    assert.ok(wrappers[0].getAttribute('style').includes('margin: 8px 0;'));
    assert.ok(wrappers[1].getAttribute('style').includes('margin: 4px 0;'));
    assert.ok(imageWrappers[0].getAttribute('style').includes('margin: 10px auto;'));

    const uiElementOrder = Array.from(document.querySelector('.player').children)
        .map(function(element) { return element.className; })
        .filter(function(className) {
            return className === 'waveform-wrap' || className === 'seekable-img-wrap';
        });
    assert.deepEqual(uiElementOrder, ['waveform-wrap', 'seekable-img-wrap', 'waveform-wrap']);

    const seekWrap = wrappers[0].querySelector('.seekwrap');
    assert.ok(seekWrap);
    assert.ok(seekWrap.getAttribute('style').includes('left: 3%'));
    assert.ok(seekWrap.getAttribute('style').includes('right: 7%'));

    controller.destroy();
});

test('ui waveform elements enable waveform rendering even when feature is false', () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
        ui: [{ type: 'waveform', width: 700, height: 180 }],
    });

    assert.equal(controller.getState().features.waveform, true);
    assert.equal(document.querySelectorAll('canvas.waveform').length, 1);
    assert.equal(document.querySelectorAll('.waveform-wrap').length, 1);

    controller.destroy();
});

test('globalsolo pauses other playing controllers', async () => {
    document.body.innerHTML = '<div id="a" class="player"></div><div id="b" class="player"></div>';

    const rootA = document.getElementById('a');
    const rootB = document.getElementById('b');
    assert.ok(rootA && rootB);

    const controllerA = createTrackSwitch(rootA, {
        features: { waveform: false, keyboard: false, looping: false, globalsolo: true },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
    });

    const controllerB = createTrackSwitch(rootB, {
        features: { waveform: false, keyboard: false, looping: false, globalsolo: true },
        tracks: [{ title: 'B', sources: [{ src: 'b.mp3' }] }],
    });

    await controllerA.load();
    await controllerB.load();

    controllerA.play();
    assert.equal(controllerA.getState().state.playing, true);
    assert.equal(controllerB.getState().state.playing, false);

    controllerB.play();
    assert.equal(controllerB.getState().state.playing, true);
    assert.equal(controllerA.getState().state.playing, false);

    controllerA.destroy();
    controllerB.destroy();
});

test('getSeekMetrics clamps pointer coordinates to bounds', () => {
    const seekElement = document.createElement('div');
    seekElement.getBoundingClientRect = function() {
        return {
            left: 100,
            width: 200,
        };
    };

    const beforeBounds = getSeekMetrics(seekElement, {
        type: 'mousedown',
        pageX: 80,
        preventDefault() {},
        stopPropagation() {},
    }, 20);
    assert.ok(beforeBounds);
    assert.equal(beforeBounds.posXRelLimited, 0);
    assert.equal(beforeBounds.time, 0);

    const insideBounds = getSeekMetrics(seekElement, {
        type: 'mousedown',
        pageX: 150,
        preventDefault() {},
        stopPropagation() {},
    }, 20);
    assert.ok(insideBounds);
    assert.equal(insideBounds.posXRelLimited, 50);
    assert.equal(insideBounds.time, 5);

    const afterBounds = getSeekMetrics(seekElement, {
        type: 'mousedown',
        pageX: 400,
        preventDefault() {},
        stopPropagation() {},
    }, 20);
    assert.ok(afterBounds);
    assert.equal(afterBounds.posXRelLimited, 200);
    assert.equal(afterBounds.time, 20);
});

test('getSeekMetrics returns null for missing seek element or pointer data', () => {
    assert.equal(getSeekMetrics(null, {
        type: 'mousedown',
        pageX: 100,
        preventDefault() {},
        stopPropagation() {},
    }, 20), null);

    const seekElement = document.createElement('div');
    seekElement.getBoundingClientRect = function() {
        return {
            left: 10,
            width: 100,
        };
    };

    assert.equal(getSeekMetrics(seekElement, {
        type: 'mousedown',
        preventDefault() {},
        stopPropagation() {},
    }, 20), null);
});

test('mode defaults to default and normalizes unknown values', () => {
    const baseInit = {
        features: { waveform: false, keyboard: false, looping: false },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
    };

    const controllerDefault = createController(baseInit);
    assert.equal(controllerDefault.getState().features.mode, 'default');
    controllerDefault.destroy();

    const controllerUnknown = createController({
        ...baseInit,
        features: { ...baseInit.features, mode: 'something_else' },
    });
    assert.equal(controllerUnknown.getState().features.mode, 'default');
    controllerUnknown.destroy();
});

test('alignment_multi mode loads with normal playback behavior', async () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, mode: 'alignment_multi' },
        tracks: [
            { title: 'A', sources: [{ src: 'a.mp3' }] },
            { title: 'B', sources: [{ src: 'b.mp3' }] },
        ],
    });

    await controller.load();
    assert.equal(controller.getState().isLoaded, true);
    assert.deepEqual(mockAddedWorkletModules, []);

    controller.play();
    assert.equal(mockSourceInstances.length, 2);
    assert.equal(mockWorkletNodeInstances.length, 0);
    assert.equal(mockSourceInstances[0].startArgs[1], 0);
    assert.equal(mockSourceInstances[1].startArgs[1], 0);
    assert.equal(mockSourceInstances[0].playbackRate.value, 1);
    assert.equal(mockSourceInstances[1].playbackRate.value, 1);

    controller.destroy();
});

test('alignment_multi mode works when AudioWorklet is unsupported', async () => {
    mockAudioWorkletUnsupported = true;
    if (MockAudioContext.latestInstance) {
        MockAudioContext.latestInstance.audioWorklet = undefined;
    }

    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, mode: 'alignment_multi' },
        tracks: [
            { title: 'A', sources: [{ src: 'a.mp3' }] },
            { title: 'B', sources: [{ src: 'b.mp3' }] },
        ],
    });

    let errorMessage = '';
    controller.on('error', function(payload) {
        errorMessage = payload.message;
    });

    await controller.load();
    assert.equal(controller.getState().isLoaded, true);
    assert.equal(errorMessage, '');

    controller.destroy();
});

test('alignment_multi keeps public position on normal timeline during playback', async () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, mode: 'alignment_multi' },
        tracks: [
            { title: 'A', sources: [{ src: 'a.mp3' }] },
            { title: 'B', sources: [{ src: 'b.mp3' }] },
        ],
    });

    await controller.load();
    controller.play();

    assert.ok(MockAudioContext.latestInstance);
    MockAudioContext.latestInstance.currentTime = 2;
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.ok(Math.abs(controller.getState().state.position - 2) < 1e-6);
    assert.equal(mockSourceInstances[0].playbackRate.value, 1);
    assert.equal(mockSourceInstances[1].playbackRate.value, 1);

    controller.destroy();
});

test('alignment_multi mute and solo toggles do not jump playhead', async () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, mode: 'alignment_multi' },
        tracks: [
            { title: 'A', sources: [{ src: 'a.mp3' }] },
            { title: 'B', sources: [{ src: 'b.mp3' }] },
        ],
    });

    await controller.load();
    controller.play();

    assert.ok(MockAudioContext.latestInstance);
    MockAudioContext.latestInstance.currentTime = 3;
    await new Promise((resolve) => setTimeout(resolve, 25));

    const beforeToggle = controller.getState().state.position;
    controller.toggleMute(1);
    assert.ok(Math.abs(controller.getState().state.position - beforeToggle) < 1e-6);

    controller.toggleSolo(1);
    assert.ok(Math.abs(controller.getState().state.position - beforeToggle) < 1e-6);

    controller.destroy();
});

test('alignment_multi seek and loop restarts use normal track offsets', async () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: true, mode: 'alignment_multi' },
        tracks: [
            { title: 'A', sources: [{ src: 'a.mp3' }] },
            { title: 'B', sources: [{ src: 'b.mp3' }] },
        ],
    });

    await controller.load();
    controller.play();

    controller.seekTo(4);
    const seekRestartSources = mockSourceInstances.slice(-2);
    assert.equal(seekRestartSources[0].startArgs[1], 4);
    assert.equal(seekRestartSources[1].startArgs[1], 4);

    controller.seekTo(1);
    controller.setLoopPoint('A');
    controller.seekTo(2);
    controller.setLoopPoint('B');
    controller.seekTo(1);
    const sourceCountBeforeLoopRestart = mockSourceInstances.length;

    assert.ok(MockAudioContext.latestInstance);
    MockAudioContext.latestInstance.currentTime = 2.5;
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.ok(mockSourceInstances.length >= sourceCountBeforeLoopRestart + 2);
    const loopRestartSources = mockSourceInstances.slice(sourceCountBeforeLoopRestart, sourceCountBeforeLoopRestart + 2);
    assert.equal(loopRestartSources[0].startArgs[1], 1);
    assert.equal(loopRestartSources[1].startArgs[1], 1);
    assert.ok(controller.getState().state.position >= 1 && controller.getState().state.position < 2);

    controller.destroy();
});

test('alignment_solo mode requires onlyradiosolo', async () => {
    const controller = createController({
        features: { waveform: false, keyboard: false, looping: false, mode: 'alignment_solo' },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
        alignment: {
            csv: 'data/alignment.csv',
            mappings: [{ trackIndex: 0, column: 't1_sec' }],
        },
    });

    let errorMessage = '';
    controller.on('error', function(payload) {
        errorMessage = payload.message;
    });

    await controller.load();
    assert.equal(controller.getState().isLoaded, false);
    assert.match(errorMessage, /onlyradiosolo/);

    controller.destroy();
});

test('alignment_solo mode requires alignment config and full mapping coverage', async () => {
    const controllerMissingAlignment = createController({
        features: { waveform: false, keyboard: false, looping: false, mode: 'alignment_solo', onlyradiosolo: true },
        tracks: [{ title: 'A', sources: [{ src: 'a.mp3' }] }],
    });

    let missingAlignmentError = '';
    controllerMissingAlignment.on('error', function(payload) {
        missingAlignmentError = payload.message;
    });

    await controllerMissingAlignment.load();
    assert.equal(controllerMissingAlignment.getState().isLoaded, false);
    assert.match(missingAlignmentError, /init\.alignment/);
    controllerMissingAlignment.destroy();

    const controllerMissingMapping = createController({
        features: { waveform: false, keyboard: false, looping: false, mode: 'alignment_solo', onlyradiosolo: true },
        tracks: [
            { title: 'A', sources: [{ src: 'a.mp3' }] },
            { title: 'B', sources: [{ src: 'b.mp3' }] },
        ],
        alignment: {
            csv: 'data/alignment.csv',
            mappings: [{ trackIndex: 0, column: 't1_sec' }],
        },
    });

    let missingMappingError = '';
    controllerMissingMapping.on('error', function(payload) {
        missingMappingError = payload.message;
    });

    await controllerMissingMapping.load();
    assert.equal(controllerMissingMapping.getState().isLoaded, false);
    assert.match(missingMappingError, /exactly one mapping per track|cover all tracks/);
    controllerMissingMapping.destroy();
});

test('alignment_solo track switch remaps reference position with clamp out-of-range', async () => {
    setMockTextResponse('data/alignment.csv', [
        't1_sec,t2_sec',
        '0,0',
        '5,2.5',
    ].join('\n'));

    const controller = createController({
        features: {
            waveform: false,
            keyboard: false,
            looping: false,
            mode: 'alignment_solo',
            onlyradiosolo: true,
        },
        tracks: [
            { title: 'A', sources: [{ src: 'a.mp3' }] },
            { title: 'B', sources: [{ src: 'b.mp3' }] },
        ],
        alignment: {
            csv: 'data/alignment.csv',
            mappings: [
                { trackIndex: 0, column: 't1_sec' },
                { trackIndex: 1, column: 't2_sec' },
            ],
            outOfRange: 'clamp',
        },
    });

    await controller.load();
    assert.equal(controller.getState().isLoaded, true);

    controller.seekTo(8);
    assert.equal(controller.getState().state.position, 8);

    controller.toggleSolo(1);
    assert.equal(controller.getState().tracks[1].solo, true);
    assert.ok(Math.abs(controller.getState().state.position - 5) < 1e-6);

    controller.destroy();
});

test('alignment_solo outOfRange linear preserves switched reference position', async () => {
    setMockTextResponse('data/alignment.csv', [
        't1_sec,t2_sec',
        '0,0',
        '5,2.5',
    ].join('\n'));

    const controller = createController({
        features: {
            waveform: false,
            keyboard: false,
            looping: false,
            mode: 'alignment_solo',
            onlyradiosolo: true,
        },
        tracks: [
            { title: 'A', sources: [{ src: 'a.mp3' }] },
            { title: 'B', sources: [{ src: 'b.mp3' }] },
        ],
        alignment: {
            csv: 'data/alignment.csv',
            mappings: [
                { trackIndex: 0, column: 't1_sec' },
                { trackIndex: 1, column: 't2_sec' },
            ],
            outOfRange: 'linear',
        },
    });

    await controller.load();
    assert.equal(controller.getState().isLoaded, true);
    controller.seekTo(8);
    controller.toggleSolo(1);

    assert.ok(Math.abs(controller.getState().state.position - 8) < 1e-6);
    controller.destroy();
});

test('utility exports remain available as named exports', () => {
    assert.equal(Object.prototype.hasOwnProperty.call(trackSwitch, 'parseTrackSwitchMarkup'), false);
    assert.deepEqual(parsePresetIndices('1x,-2,3,4'), [3, 4]);
    assert.equal(
        inferSourceMimeType('https://cdn.example/audio/file.MP3?x=1#frag', undefined, { '.mp3': 'audio/mpeg;' }),
        'audio/mpeg;'
    );
    assert.equal(formatSecondsToHHMMSSmmm(1.9996), '00:00:02:000');
});
