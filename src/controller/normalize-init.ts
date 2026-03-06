import {
    NormalizedTrackGroupLayout,
    NormalizedTrackSwitchConfig,
    TrackDefinition,
    TrackSwitchFeatures,
    TrackSwitchInit,
    TrackSwitchUiElement,
} from '../domain/types';
import { injectConfiguredUiElements, normalizeUiElement } from './ui-elements';
import { assertAllowedKeys, toConfigRecord } from './config-validation';
import { normalizeFeatures } from '../domain/options';

export const TRACKS_REQUIRED_ERROR = 'TrackSwitch requires at least one ui entry with type "trackGroup" and non-empty trackGroup.';
const initAllowedKeys = ['presetNames', 'features', 'alignment', 'ui'] as const;
const alignmentAllowedKeys = ['csv', 'referenceTimeColumn', 'outOfRange'] as const;

function validateInitKeys(init: TrackSwitchInit): void {
    const initRecord = toConfigRecord(init, 'init');
    assertAllowedKeys(initRecord, initAllowedKeys, 'init');

    if (init.alignment === undefined) {
        return;
    }

    const alignmentRecord = toConfigRecord(init.alignment, 'alignment');
    assertAllowedKeys(alignmentRecord, alignmentAllowedKeys, 'alignment');
}

function hasValidTrackSources(track: TrackDefinition): boolean {
    if (!Array.isArray(track.sources) || track.sources.length === 0) {
        return false;
    }

    return track.sources.some(function(source) {
        return typeof source.src === 'string' && source.src.trim().length > 0;
    });
}

function resolveTracksFromUi(
    resolvedUi: TrackSwitchUiElement[] | undefined
): { tracks: TrackDefinition[]; trackGroups: NormalizedTrackGroupLayout[] } {
    if (!resolvedUi || resolvedUi.length === 0) {
        return { tracks: [], trackGroups: [] };
    }

    const tracks: TrackDefinition[] = [];
    const trackGroups: NormalizedTrackGroupLayout[] = [];
    let groupIndex = 0;

    resolvedUi.forEach(function(entry) {
        if (entry.type !== 'trackGroup') {
            return;
        }

        if (!Array.isArray(entry.trackGroup) || entry.trackGroup.length === 0) {
            throw new Error('Each ui trackGroup must contain at least one track.');
        }

        const startTrackIndex = tracks.length;
        entry.trackGroup.forEach(function(track) {
            if (!hasValidTrackSources(track)) {
                throw new Error('Each track in ui trackGroup must define at least one valid source src.');
            }

            tracks.push(track);
        });

        trackGroups.push({
            groupIndex: groupIndex,
            startTrackIndex: startTrackIndex,
            trackCount: entry.trackGroup.length,
            rowHeight: entry.rowHeight,
        });

        groupIndex += 1;
    });

    return { tracks, trackGroups };
}

function hasPerTrackImageUi(resolvedUi: TrackSwitchUiElement[] | undefined): boolean {
    if (!resolvedUi) {
        return false;
    }

    return resolvedUi.some(function(entry) {
        return entry.type === 'perTrackImage';
    });
}

export function normalizeInit(root: HTMLElement, init: TrackSwitchInit): NormalizedTrackSwitchConfig {
    validateInitKeys(init);

    const resolvedUi = Array.isArray(init.ui)
        ? init.ui.map(normalizeUiElement)
        : undefined;
    const waveformRequiredByUi = Boolean(resolvedUi && resolvedUi.some(function(entry) {
        return entry.type === 'waveform';
    }));
    const resolvedFeatures = waveformRequiredByUi
        ? { ...(init.features ?? {}), waveform: true }
        : init.features;
    const normalizedFeatures = normalizeFeatures(resolvedFeatures as Partial<TrackSwitchFeatures> | undefined);
    if (hasPerTrackImageUi(resolvedUi) && !normalizedFeatures.exclusiveSolo) {
        throw new Error('Invalid init configuration: perTrackImage requires features.exclusiveSolo to be true.');
    }

    const resolvedTrackData = resolveTracksFromUi(resolvedUi);

    if (resolvedTrackData.tracks.length === 0) {
        throw new Error(TRACKS_REQUIRED_ERROR);
    }

    injectConfiguredUiElements(root, resolvedUi);

    return {
        tracks: resolvedTrackData.tracks,
        presetNames: init.presetNames,
        features: resolvedFeatures,
        alignment: init.alignment,
        ui: resolvedUi,
        trackGroups: resolvedTrackData.trackGroups,
    };
}
