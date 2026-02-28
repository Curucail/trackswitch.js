import { TrackDefinition, TrackRuntime } from './types';

export function createTrackRuntime(definition: TrackDefinition, index: number): TrackRuntime {
    return {
        id: definition.id || 'track-' + index,
        definition: definition,
        state: {
            mute: !!definition.muted,
            solo: !!definition.solo,
        },
        gainNode: null,
        buffer: null,
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
        successful: false,
        errored: false,
        waveformCache: new Map<string, Float32Array>(),
    };
}
