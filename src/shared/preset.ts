import { TrackDefinition, TrackSwitchConfig } from '../domain/types';

export function parseStrictNonNegativeInt(value: string): number {
    return /^\d+$/.test(value) ? Number(value) : NaN;
}

export function parsePresetIndices(presetsAttr: string | undefined): number[] {
    if (!presetsAttr) {
        return [];
    }

    return presetsAttr
        .split(',')
        .map(function(preset) { return parseStrictNonNegativeInt(preset.trim()); })
        .filter(function(preset) { return Number.isFinite(preset) && preset >= 0; });
}

export function derivePresetNames(config: Pick<TrackSwitchConfig, 'tracks' | 'presetNames'>): string[] {
    let maxPresetIndex = -1;

    config.tracks.forEach(function(track: TrackDefinition) {
        (track.presets ?? []).forEach(function(index: number) {
            if (index > maxPresetIndex) {
                maxPresetIndex = index;
            }
        });
    });

    const presetCount = Math.max(0, maxPresetIndex + 1);
    const providedNames = (config.presetNames ?? []).map(function(name) {
        return String(name).trim();
    });

    return Array.from({ length: presetCount }, function(_, index) {
        return providedNames[index] || 'Preset ' + index;
    });
}
