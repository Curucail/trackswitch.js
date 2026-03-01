import { TrackSwitchFeatures } from './types';

export const defaultFeatures: Readonly<TrackSwitchFeatures> = {
    mode: 'default',
    radiosolo: false,
    muteOtherPlayerInstances: true,
    globalVolume: false,
    repeat: false,
    tabView: false,
    iosUnmute: true,
    keyboard: true,
    looping: false,
    seekBar: true,
    timer: true,
    presets: true,
    waveform: true,
};

export function normalizeFeatures(features: Partial<TrackSwitchFeatures> | undefined): TrackSwitchFeatures {
    const normalized: TrackSwitchFeatures = {
        ...defaultFeatures,
        ...(features ?? {}),
    };

    if (
        normalized.mode !== 'default'
        && normalized.mode !== 'alignment'
    ) {
        normalized.mode = 'default';
    }

    if (normalized.radiosolo) {
        normalized.presets = false;
    }

    return normalized;
}
