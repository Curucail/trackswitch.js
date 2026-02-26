import { TrackSwitchConfig, TrackSwitchInit } from '../domain/types';
import { injectConfiguredUiElements, normalizeUiElement } from './ui-elements';

export const TRACKS_REQUIRED_ERROR = 'TrackSwitch requires init.tracks with at least one track.';

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

    if (!resolvedInit?.tracks || resolvedInit.tracks.length === 0) {
        throw new Error(TRACKS_REQUIRED_ERROR);
    }

    injectConfiguredUiElements(root, resolvedUi);

    return {
        tracks: resolvedInit.tracks,
        presetNames: resolvedInit.presetNames,
        features: resolvedFeatures,
        ui: resolvedUi,
    };
}
