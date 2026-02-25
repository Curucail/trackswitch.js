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
                return new Float32Array(1000);
            },
        });
    }

    resume() {
        return Promise.resolve();
    }
}

global.AudioContext = MockAudioContext;
global.XMLHttpRequest = class MockXHR {
    open() {}

    send() {}
};

const $ = require('jquery');

global.$ = $;
global.jQuery = $;

require(path.resolve(__dirname, '../dist/tmp/ts/trackswitch.js'));

function createPlayer(markup, options) {
    document.body.innerHTML = markup;
    const player = $('.player');
    player.trackSwitch(options || {});
    const plugin = player.data('plugin_trackSwitch');
    assert.ok(plugin, 'plugin instance should be attached');
    return { player, plugin };
}

test.afterEach(() => {
    $(window).off();
    document.body.innerHTML = '';
});

test('parsePresetIndices rejects malformed and negative values', () => {
    const internals = $.trackSwitchInternals;
    assert.ok(internals, 'internals should be exposed');
    assert.deepEqual(internals.parsePresetIndices('1x,-2,3, 4 '), [3, 4]);
});

test('global volume control is disabled by default', () => {
    const { player, plugin } = createPlayer(
        '<div class="player"><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { waveform: false, keyboard: false, looping: false }
    );

    assert.equal(player.find('.volume-control').length, 0);
    assert.ok(plugin.gainNodeVolume, 'volume gain node should still exist');

    plugin.masterVolume = 0.25;
    plugin.gainNodeVolume.gain.value = 0.25;
    plugin.adjustVolume(10);

    assert.equal(plugin.masterVolume, 1);
    assert.equal(plugin.gainNodeVolume.gain.value, 1);
});

test('global volume control can be enabled', () => {
    const { player, plugin } = createPlayer(
        '<div class="player"><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { waveform: false, keyboard: false, looping: false, globalvolume: true }
    );

    assert.equal(player.find('.volume-control').length, 1);
    assert.ok(plugin.gainNodeVolume, 'volume gain node should exist');

    const slider = player.find('.volume-slider');
    slider.val('40');
    plugin.event_volume({ target: slider[0] });

    assert.equal(plugin.masterVolume, 0.4);
    assert.equal(plugin.gainNodeVolume.gain.value, 0.4);
});

test('keyboard shortcuts are scoped to the last interacted instance', () => {
    document.body.innerHTML = [
        '<div id="a" class="player"><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        '<div id="b" class="player"><ts-track><ts-source src="b.mp3"></ts-source></ts-track></div>',
    ].join('');

    const players = $('.player');
    players.eq(0).trackSwitch({ keyboard: true, waveform: false, looping: false });
    players.eq(1).trackSwitch({ keyboard: true, waveform: false, looping: false });

    const p1 = players.eq(0).data('plugin_trackSwitch');
    const p2 = players.eq(1).data('plugin_trackSwitch');

    p1.loaded();
    p2.loaded();

    let seen1 = 0;
    let seen2 = 0;

    p1.seekRelative = function() {
        seen1 += 1;
    };
    p2.seekRelative = function() {
        seen2 += 1;
    };

    players.eq(0).trigger($.Event('mousedown', { which: 1 }));
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(seen1, 1);
    assert.equal(seen2, 0);

    players.eq(1).trigger($.Event('mousedown', { which: 1 }));
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(seen1, 1);
    assert.equal(seen2, 1);

    p2.destroy();
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(seen1, 1, 'no instance should handle keyboard input when active owner is destroyed');
    assert.equal(seen2, 1, 'destroyed player should be detached');

    players.eq(0).trigger($.Event('mousedown', { which: 1 }));
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

    assert.equal(seen1, 2, 'remaining player should receive keyboard input after being re-activated');
    assert.equal(seen2, 1);
});

test('resize handler works without element id and is removed on destroy', () => {
    const { plugin } = createPlayer(
        '<div class="player"><canvas class="waveform" width="300" height="60"></canvas><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { keyboard: false, waveform: true, looping: false }
    );

    let resizeCalls = 0;
    plugin.handleWaveformResize = function() {
        resizeCalls += 1;
    };

    plugin.loaded();
    window.dispatchEvent(new dom.window.Event('resize'));
    assert.equal(resizeCalls, 1);

    plugin.destroy();
    window.dispatchEvent(new dom.window.Event('resize'));
    assert.equal(resizeCalls, 1, 'resize callback should be unbound after destroy');
});

test('destroy clears active timers and plugin data key', () => {
    const { player, plugin } = createPlayer(
        '<div class="player"><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { waveform: false, keyboard: false, looping: false }
    );

    plugin.playing = true;
    plugin.timerMonitorPosition = setInterval(() => {}, 1000);
    plugin.resizeDebounceTimer = setTimeout(() => {}, 1000);

    plugin.destroy();

    assert.equal(plugin.isDestroyed, true);
    assert.equal(plugin.timerMonitorPosition, null);
    assert.equal(plugin.resizeDebounceTimer, null);
    assert.equal(player.find('.track_list').length, 0);
    assert.equal(player.data('plugin_trackSwitch'), undefined);
});

test('wheel preset selection clamps boundaries and updates solo state', () => {
    const { player, plugin } = createPlayer(
        '<div class="player" preset-names="One,Two">' +
            '<ts-track title="A" presets="0"><ts-source src="a.mp3"></ts-source></ts-track>' +
            '<ts-track title="B" presets="1"><ts-source src="b.mp3"></ts-source></ts-track>' +
        '</div>',
        { waveform: false, keyboard: false, looping: false }
    );

    plugin.loaded();

    const selector = player.find('.preset-selector');
    assert.equal(selector.length, 1);

    selector.val('0');
    plugin.event_preset_scroll({
        preventDefault() {},
        target: selector[0],
        originalEvent: { deltaY: -10 },
    });
    assert.equal(selector.val(), '0');

    plugin.event_preset_scroll({
        preventDefault() {},
        target: selector[0],
        originalEvent: { deltaY: 10 },
    });

    assert.equal(selector.val(), '1');
    assert.equal(plugin.trackProperties[0].solo, false);
    assert.equal(plugin.trackProperties[1].solo, true);
});

test('play starts from loop point A when current position is outside active loop', () => {
    const { plugin } = createPlayer(
        '<div class="player"><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { waveform: false, keyboard: false, looping: true }
    );

    plugin.loopEnabled = true;
    plugin.loopPointA = 2;
    plugin.loopPointB = 5;
    plugin.position = 9;

    let capturedStart = -1;
    plugin.startAudio = function(pos) {
        capturedStart = pos;
    };

    plugin.event_playpause({
        type: 'mousedown',
        which: 1,
        preventDefault() {},
        stopPropagation() {},
    });

    assert.equal(capturedStart, 2);
});

test('load ignores duplicate activation while loading', () => {
    const { plugin } = createPlayer(
        '<div class="player"><ts-track><ts-source src="a.mp3?cache=1#frag" type="audio/mpeg"></ts-source></ts-track></div>',
        { waveform: false, keyboard: false, looping: false }
    );

    let requests = 0;
    plugin.prepareRequest = function() {
        requests += 1;
    };

    const event = {
        type: 'mousedown',
        which: 1,
        preventDefault() {},
        stopPropagation() {},
    };

    plugin.load(event);
    plugin.load(event);

    assert.equal(plugin.isLoading, true);
    assert.equal(requests, 1, 'duplicate load should not enqueue more requests while loading');
});

test('invalid loop point update still refreshes UI state', () => {
    const { plugin } = createPlayer(
        '<div class="player"><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { waveform: false, keyboard: false, looping: true }
    );

    plugin.loopPointB = 1;
    plugin.position = 0.95;

    let updates = 0;
    plugin.updateMainControls = function() {
        updates += 1;
    };

    const ret = plugin.event_setLoopA({
        type: 'mousedown',
        which: 1,
        preventDefault() {},
        stopPropagation() {},
    });

    assert.equal(ret, false);
    assert.equal(plugin.loopPointA, null);
    assert.equal(updates, 1, 'loop UI should refresh even when the loop point is rejected');
});

test('seek ends when mouseup happens on window', () => {
    const { player, plugin } = createPlayer(
        '<div class="player"><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { waveform: false, keyboard: false, looping: true }
    );

    plugin.loaded();
    const seekwrap = player.find('.main-control .seekwrap').first();
    assert.equal(seekwrap.length, 1);

    seekwrap.trigger($.Event('mousedown', { which: 1, pageX: 10 }));
    assert.equal(plugin.currentlySeeking, true, 'seek should start on mousedown');

    $(window).trigger($.Event('mouseup', { which: 1, pageX: 10 }));
    assert.equal(plugin.currentlySeeking, false, 'seek should end on window mouseup');
});

test('seekbar can be disabled while preserving seekable image loop interaction', () => {
    const { player, plugin } = createPlayer(
        '<div class="player"><img class="seekable" src="poster.jpg"><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { waveform: false, keyboard: false, looping: true, seekbar: false }
    );

    plugin.loaded();
    plugin.longestDuration = 10;

    assert.equal(player.find('.main-control .seekwrap').length, 0);
    const imageSeekwrap = player.find('.seekable-img-wrap .seekwrap').first();
    assert.equal(imageSeekwrap.length, 1);

    imageSeekwrap.trigger($.Event('mousedown', { which: 3, pageX: 0 }));
    $(window).trigger($.Event('mousemove', { which: 3, pageX: 1 }));
    $(window).trigger($.Event('mouseup', { which: 3, pageX: 1 }));

    assert.equal(plugin.loopEnabled, true);
});

test('seekbar can be disabled while preserving waveform loop interaction', () => {
    const { player, plugin } = createPlayer(
        '<div class="player"><canvas class="waveform" width="300" height="60"></canvas><ts-track><ts-source src="a.mp3"></ts-source></ts-track></div>',
        { waveform: true, keyboard: false, looping: true, seekbar: false }
    );

    plugin.loaded();
    plugin.longestDuration = 10;

    assert.equal(player.find('.main-control .seekwrap').length, 0);
    const waveformSeekwrap = player.find('.waveform-wrap .seekwrap').first();
    assert.equal(waveformSeekwrap.length, 1);

    waveformSeekwrap.trigger($.Event('mousedown', { which: 3, pageX: 0 }));
    $(window).trigger($.Event('mousemove', { which: 3, pageX: 1 }));
    $(window).trigger($.Event('mouseup', { which: 3, pageX: 1 }));

    assert.equal(plugin.loopEnabled, true);
});

test('mime inference handles query and hash suffixes', () => {
    const internals = $.trackSwitchInternals;
    assert.equal(
        internals.inferSourceMimeType('https://cdn.example/audio/file.MP3?x=1#frag', undefined, { '.mp3': 'audio/mpeg;' }),
        'audio/mpeg;'
    );
});

test('time formatter rolls milliseconds into next second', () => {
    const internals = $.trackSwitchInternals;
    assert.equal(internals.formatSecondsToHHMMSSmmm(1.9996), '00:00:02:000');
});
