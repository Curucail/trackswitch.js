import {
    NormalizedTrackGroupLayout,
    TrackDefinition,
    TrackSwitchConfig,
    TrackSwitchInit,
    TrackSwitchUiElement,
} from '../domain/types';
import { injectConfiguredUiElements, normalizeUiElement } from './ui-elements';

export const TRACKS_REQUIRED_ERROR = 'TrackSwitch requires at least one ui entry with type "trackGroup" and non-empty trackGroup.';

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
            if (
                track
                && typeof track === 'object'
                && Object.prototype.hasOwnProperty.call(track, 'id')
            ) {
                throw new Error('Track ids are no longer supported. Track order in ui trackGroup defines the track index.');
            }

            if (!hasValidTrackSources(track)) {
                throw new Error('Each track in ui trackGroup must define at least one valid source src.');
            }

            tracks.push(track);
        });

        trackGroups.push({
            groupIndex: groupIndex,
            startTrackIndex: startTrackIndex,
            trackCount: entry.trackGroup.length,
        });

        groupIndex += 1;
    });

    return { tracks, trackGroups };
}

export function normalizeInit(root: HTMLElement, init: TrackSwitchInit | undefined): TrackSwitchConfig {
    const resolvedInit = init as TrackSwitchInit | undefined;
    const resolvedUi = Array.isArray(resolvedInit?.ui)
        ? resolvedInit.ui.map(normalizeUiElement)
        : undefined;
    const waveformRequiredByUi = Boolean(resolvedUi && resolvedUi.some(function(entry) {
        return entry.type === 'waveform';
    }));
    const resolvedFeatures = waveformRequiredByUi
        ? { ...(resolvedInit?.features ?? {}), waveform: true }
        : resolvedInit?.features;
    const resolvedTrackData = resolveTracksFromUi(resolvedUi);

    if (resolvedTrackData.tracks.length === 0) {
        throw new Error(TRACKS_REQUIRED_ERROR);
    }

    injectConfiguredUiElements(root, resolvedUi);

    return {
        tracks: resolvedTrackData.tracks,
        presetNames: resolvedInit?.presetNames,
        features: resolvedFeatures,
        alignment: resolvedInit?.alignment,
        ui: resolvedUi,
        trackGroups: resolvedTrackData.trackGroups,
    };
}
