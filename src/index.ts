import { createTrackSwitch } from './controller/create-track-switch';
import { normalizeFeatures, defaultFeatures } from './domain/options';
import { createInitialPlayerState, playerStateReducer } from './domain/state';
import { WaveformEngine } from './engine/waveform-engine';
import { inferSourceMimeType } from './shared/audio';
import { formatSecondsToHHMMSSmmm } from './shared/format';
import { parsePresetIndices } from './shared/preset';

export { createTrackSwitch };
export { normalizeFeatures, defaultFeatures };
export { createInitialPlayerState, playerStateReducer };
export { WaveformEngine };
export { inferSourceMimeType, formatSecondsToHHMMSSmmm, parsePresetIndices };

export type {
    AlignmentOutOfRangeMode,
    TrackAlignmentConfig,
    TrackAlignmentMapping,
    LoopMarker,
    PlayerState,
    TrackDefinitionAlignment,
    TrackDefinition,
    TrackLoadedSource,
    TrackRuntime,
    TrackSourceDefinition,
    TrackSourceVariant,
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
    TrackSwitchSheetMusicConfig,
    TrackSwitchSheetMusicUiElement,
    TrackSwitchUiConfig,
    TrackSwitchUiElement,
    TrackSwitchWaveformConfig,
    TrackSwitchWaveformUiElement,
    TrackSwitchMode,
} from './domain/types';
