import assert from 'node:assert/strict';
import { WaveformEngine } from '../src/engine/waveform-engine';
import { TrackRuntime } from '../src/domain/types';
import { getWaveformSourceRuntimes, resolveWaveformTrackIndex } from '../src/ui/render-waveforms';
import {
    normalizeWaveformSource,
    parseWaveformSource,
    resolveWaveformTrackIndices,
} from '../src/shared/waveform-source';

function createRuntime(options: {
    solo?: boolean;
    volume?: number;
    samples?: number[];
} = {}): TrackRuntime {
    const samples = new Float32Array(options.samples ?? [1, 1, 1, 1]);
    const sampleRate = samples.length || 1;

    return {
        definition: { sources: [{ src: 'track.mp3' }] },
        state: {
            solo: !!options.solo,
            volume: options.volume ?? 1,
            pan: 0,
        },
        gainNode: null,
        pannerNode: null,
        buffer: {
            duration: samples.length / sampleRate,
            sampleRate,
            getChannelData: () => samples,
        } as AudioBuffer,
        timing: null,
        activeSource: null,
        sourceIndex: -1,
        activeVariant: 'base',
        baseSource: {
            buffer: null,
            timing: null,
            sourceIndex: -1,
        },
        syncedSource: null,
        successful: true,
        errored: false,
        waveformCache: new Map<string, Float32Array>(),
    };
}

assert.deepEqual(normalizeWaveformSource([0, 2.9, 2, -1, Number.NaN, 3]), [0, 2, 3]);
assert.deepEqual(normalizeWaveformSource([]), []);
assert.equal(normalizeWaveformSource(-1), 'audible');
assert.deepEqual(parseWaveformSource('[0, 2, 3]'), [0, 2, 3]);
assert.deepEqual(parseWaveformSource('0, 2, 3'), [0, 2, 3]);
assert.equal(parseWaveformSource('2'), 2);
assert.deepEqual(resolveWaveformTrackIndices(4, [0, 2, 8]), [0, 2]);

const runtimes = [
    createRuntime({ solo: false, volume: 1 }),
    createRuntime({ solo: true, volume: 1 }),
    createRuntime({ solo: false, volume: 0 }),
];

assert.equal(resolveWaveformTrackIndex({} as never, runtimes, [0, 1]), null);
assert.equal(resolveWaveformTrackIndex({} as never, runtimes, 1), 1);
assert.deepEqual(
    getWaveformSourceRuntimes({ features: { exclusiveSolo: false } }, runtimes, 'audible'),
    [runtimes[1]]
);
assert.deepEqual(
    getWaveformSourceRuntimes({ features: { exclusiveSolo: false } }, runtimes, [0, 1, 2, 8]),
    [runtimes[1]]
);
assert.deepEqual(
    getWaveformSourceRuntimes({ features: { exclusiveSolo: false, mode: 'alignment' } }, runtimes, [0, 1, 2, 8]),
    [runtimes[0], runtimes[1]]
);
assert.deepEqual(
    getWaveformSourceRuntimes(
        { features: { exclusiveSolo: true } },
        [createRuntime({ volume: 1 }), createRuntime({ volume: 0.5 }), createRuntime({ volume: 0 })],
        [0, 1, 2]
    ).length,
    2
);

const waveformEngine = new WaveformEngine();
const fullVolumeMix = waveformEngine.calculateMixedWaveform([createRuntime({ volume: 1 })], 4, 1);
assert.ok(fullVolumeMix);
assert.deepEqual(Array.from(fullVolumeMix || []), [1, 1, 1, 1]);

const halfVolumeMix = waveformEngine.calculateMixedWaveform([createRuntime({ volume: 0.5 })], 4, 1);
assert.ok(halfVolumeMix);
assert.deepEqual(Array.from(halfVolumeMix || []).map((value) => Number(value.toFixed(4))), [0.5, 0.5, 0.5, 0.5]);

const weightedMix = waveformEngine.calculateMixedWaveform(
    [createRuntime({ volume: 1 }), createRuntime({ volume: 0.5 })],
    4,
    1
);
assert.ok(weightedMix);
assert.deepEqual(
    Array.from(weightedMix || []).map((value) => Number(value.toFixed(4))),
    [1.0607, 1.0607, 1.0607, 1.0607]
);
