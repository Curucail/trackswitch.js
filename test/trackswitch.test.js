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
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;

if (dom.window.HTMLMediaElement && dom.window.HTMLMediaElement.prototype) {
    dom.window.HTMLMediaElement.prototype.canPlayType = function() {
        return 'probably';
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

const $ = require('jquery');

global.$ = $;
global.jQuery = $;

const trackSwitch = require(path.resolve(__dirname, '../dist/tmp/ts/trackswitch.js'));
const {
    WaveformEngine,
    createInitialPlayerState,
    createTrackSwitch,
    formatSecondsToHHMMSSmmm,
    inferSourceMimeType,
    parsePresetIndices,
    playerStateReducer,
} = trackSwitch;

function createController(config, markup) {
    document.body.innerHTML = markup || '<div class="player"></div>';
    const root = document.querySelector('.player');
    assert.ok(root, 'root should exist');
    return createTrackSwitch(root, config);
}

test.afterEach(() => {
    $(window).off();
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

    $(rootA).trigger($.Event('mousedown', { which: 1 }));
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

    assert.equal(seenA, 1);
    assert.equal(seenB, 0);

    $(rootB).trigger($.Event('mousedown', { which: 1 }));
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

    assert.equal(seenA, 1);
    assert.equal(seenB, 1);

    controllerB.destroy();
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

    assert.equal(seenA, 1);
    assert.equal(seenB, 1);

    $(rootA).trigger($.Event('mousedown', { which: 1 }));
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

    assert.equal(seenA, 2);
    assert.equal(seenB, 1);

    controllerA.destroy();
});

test('legacy jQuery adapter maps markup to controller', async () => {
    document.body.innerHTML = '<div class="player"><ts-track title="A"><ts-source src="a.mp3"></ts-source></ts-track></div>';
    const player = $('.player');

    player.trackSwitch({ waveform: false, keyboard: false, looping: false });

    const plugin = player.data('plugin_trackSwitch');
    assert.ok(plugin, 'controller should be attached to plugin key');

    await plugin.load();
    plugin.play();

    assert.equal(player.find('.main-control').length, 1);
    assert.equal(plugin.getState().state.playing, true);

    player.trackSwitch('destroy');
    assert.equal(player.data('plugin_trackSwitch'), undefined);
});

test('utility exports remain available as named exports', () => {
    assert.deepEqual(parsePresetIndices('1x,-2,3,4'), [3, 4]);
    assert.equal(
        inferSourceMimeType('https://cdn.example/audio/file.MP3?x=1#frag', undefined, { '.mp3': 'audio/mpeg;' }),
        'audio/mpeg;'
    );
    assert.equal(formatSecondsToHHMMSSmmm(1.9996), '00:00:02:000');
});
