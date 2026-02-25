import { TrackSwitchFeatures } from './types';

export const defaultFeatures: Readonly<TrackSwitchFeatures> = {
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
    waveform: true,
    waveformBarWidth: 1,
};

export function normalizeFeatures(features: Partial<TrackSwitchFeatures> | undefined): TrackSwitchFeatures {
    const normalized: TrackSwitchFeatures = {
        ...defaultFeatures,
        ...(features ?? {}),
    };

    if (!normalized.mute && !normalized.solo) {
        normalized.solo = true;
    }

    if (normalized.onlyradiosolo) {
        normalized.mute = false;
        normalized.radiosolo = true;
    }

    if (!Number.isFinite(normalized.waveformBarWidth) || normalized.waveformBarWidth < 1) {
        normalized.waveformBarWidth = 1;
    }

    return normalized;
}
