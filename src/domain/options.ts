import { TrackSwitchFeatures } from './types';

export const defaultFeatures: Readonly<TrackSwitchFeatures> = {
    mode: 'default',
    exclusiveSolo: false,
    muteOtherPlayerInstances: true,
    globalVolume: false,
    trackMixControls: false,
    customizablePanelOrder: false,
    repeat: false,
    tabView: false,
    iosAudioUnlock: true,
    keyboard: true,
    looping: false,
    seekBar: true,
    timer: true,
    presets: true,
};

const featureKeys = new Set<keyof TrackSwitchFeatures>(Object.keys(defaultFeatures) as Array<keyof TrackSwitchFeatures>);
const allowedFeatureKeys = Array.from(featureKeys);

export function normalizeFeatures(features: Partial<TrackSwitchFeatures> | undefined): TrackSwitchFeatures {
    if (features !== undefined && (typeof features !== 'object' || features === null || Array.isArray(features))) {
        throw new Error('Invalid features configuration.');
    }

    if (features) {
        Object.keys(features).forEach(function(featureKey) {
            if (!featureKeys.has(featureKey as keyof TrackSwitchFeatures)) {
                throw new Error(
                    'Invalid feature key: '
                    + featureKey
                    + '. Allowed keys: '
                    + allowedFeatureKeys.join(', ')
                );
            }
        });
    }

    const normalized: TrackSwitchFeatures = {
        ...defaultFeatures,
        ...(features ?? {}),
    };

    if (
        normalized.mode !== 'default'
        && normalized.mode !== 'alignment'
        && normalized.mode !== 'alignment_interactive'
    ) {
        normalized.mode = 'default';
    }

    if (normalized.mode === 'alignment_interactive') {
        normalized.exclusiveSolo = true;
        normalized.presets = false;
    }

    if (normalized.exclusiveSolo) {
        normalized.presets = false;
    }

    return normalized;
}
