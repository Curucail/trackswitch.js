import { TrackSwitchFeatures } from './types';

export const defaultFeatures: Readonly<TrackSwitchFeatures> = {
    mode: 'default',
    mute: true,
    solo: true,
    globalsolo: true,
    globalvolume: false,
    repeat: false,
    radiosolo: false,
    onlyradiosolo: false,
    tabview: false,
    iosunmute: true,
    keyboard: true,
    looping: false,
    seekbar: true,
    timer: true,
    presets: true,
    waveform: true,
    waveformzoom: true,
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

    if (!normalized.mute && !normalized.solo) {
        normalized.solo = true;
    }

    if (normalized.onlyradiosolo) {
        normalized.mute = false;
        normalized.radiosolo = true;
    }

    if (normalized.radiosolo || normalized.onlyradiosolo) {
        normalized.presets = false;
    }

    return normalized;
}
