import type { TrackSwitchInit } from '../src/index';

const defaultInit: TrackSwitchInit = {
    ui: [
        {
            type: 'trackGroup',
            trackGroup: [
                {
                    title: 'Track 1',
                    sources: [{ src: 'track-1.mp3' }],
                },
            ],
        },
    ],
};

void defaultInit;

const modeFeatureInit: TrackSwitchInit = {
    ui: [
        {
            type: 'trackGroup',
            trackGroup: [
                {
                    title: 'Track 1',
                    sources: [{ src: 'track-1.mp3' }],
                },
            ],
        },
    ],
    features: {
        // @ts-expect-error features.mode is not part of the public config.
        mode: 'alignment',
    },
};

void modeFeatureInit;

// @ts-expect-error TrackSwitchMode is no longer exported from the public API.
import type { TrackSwitchMode } from '../src/index';
