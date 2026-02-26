import { createTrackSwitch } from './core/track-switch-controller';
import { normalizeFeatures, defaultFeatures } from './domain/options';
import { createInitialPlayerState, playerStateReducer } from './domain/state';
import { WaveformEngine } from './engine/waveform-engine';
import {
    inferSourceMimeType,
    formatSecondsToHHMMSSmmm,
    parsePresetIndices,
} from './utils/helpers';

export { createTrackSwitch };
export { normalizeFeatures, defaultFeatures };
export { createInitialPlayerState, playerStateReducer };
export { WaveformEngine };
export { inferSourceMimeType, formatSecondsToHHMMSSmmm, parsePresetIndices };

export type {
    LoopMarker,
    PlayerState,
    TrackDefinition,
    TrackRuntime,
    TrackSourceDefinition,
    TrackState,
    TrackSwitchConfig,
    TrackSwitchController,
    TrackSwitchEventMap,
    TrackSwitchEventName,
    TrackSwitchFeatures,
    TrackSwitchInit,
    TrackSwitchImageConfig,
    TrackSwitchImageUiElement,
    TrackSwitchSnapshot,
    TrackSwitchUiConfig,
    TrackSwitchUiElement,
    TrackSwitchWaveformConfig,
    TrackSwitchWaveformUiElement,
} from './domain/types';
