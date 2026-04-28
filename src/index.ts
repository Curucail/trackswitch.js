import { createTrackSwitch } from './player/factory';
import { TrackswitchPlayer, defineTrackswitchElement } from './element';
import { normalizeFeatures, defaultFeatures } from './domain/options';
import { createInitialPlayerState, playerStateReducer } from './domain/state';
import { WaveformEngine } from './engine/waveform-engine';
import { inferSourceMimeType } from './shared/audio';
import { formatSecondsToHHMMSSmmm } from './shared/format';
import { parsePresetIndices } from './shared/preset';

export { createTrackSwitch };
export { TrackswitchPlayer, defineTrackswitchElement };
export { normalizeFeatures, defaultFeatures };
export { createInitialPlayerState, playerStateReducer };
export { WaveformEngine };
export { inferSourceMimeType, formatSecondsToHHMMSSmmm, parsePresetIndices };

export type {
    AlignmentOutOfRangeMode,
    TrackAlignmentConfig,
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
    TrackSwitchPerTrackImageConfig,
    TrackSwitchPerTrackImageUiElement,
    TrackSwitchSnapshot,
    TrackSwitchTextAlign,
    TrackSwitchTextConfig,
    TrackSwitchTextUiElement,
    TrackSwitchWarpingMatrixConfig,
    TrackSwitchWarpingMatrixUiElement,
    TrackSwitchSheetMusicConfig,
    TrackSwitchSheetMusicUiElement,
    TrackSwitchUiConfig,
    TrackSwitchUiElement,
    TrackSwitchWaveformConfig,
    TrackSwitchWaveformUiElement,
    TrackSwitchMode,
    WaveformSource,
} from './domain/types';

export type { TrackswitchDomEventName, TrackswitchPlayerElement } from './element';
