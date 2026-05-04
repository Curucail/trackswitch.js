import {
    createAlignmentTrackSwitch,
    createDefaultTrackSwitch,
    createTrackSwitch,
} from './player/factory';
import {
    TrackswitchAlignmentPlayer,
    TrackswitchPlayer,
    TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
    TRACKSWITCH_DEFAULT_ELEMENT_NAME,
    TRACKSWITCH_ELEMENT_NAME,
    defineTrackswitchAlignmentElement,
    defineTrackswitchDefaultElement,
    defineTrackswitchElement,
    defineTrackswitchElements,
} from './element';
import {
    TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
    TrackswitchAlignmentInteractive,
    defineTrackswitchInteractiveElement,
} from './interactive/interactive-element';
import {
    createAlignmentInteractiveTrackSwitch,
    createInteractiveTrackSwitch,
} from './interactive/interactive-factory';
import { normalizeFeatures, defaultFeatures } from './domain/options';
import { createInitialPlayerState, playerStateReducer } from './domain/state';
import { WaveformEngine } from './engine/waveform-engine';
import { inferSourceMimeType } from './shared/audio';
import { formatSecondsToHHMMSSmmm } from './shared/format';
import { parsePresetIndices } from './shared/preset';

export {
    createAlignmentInteractiveTrackSwitch,
    createAlignmentTrackSwitch,
    createDefaultTrackSwitch,
    createInteractiveTrackSwitch,
    createTrackSwitch,
};
export {
    TrackswitchAlignmentPlayer,
    TrackswitchAlignmentInteractive,
    TrackswitchPlayer,
    TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
    TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
    TRACKSWITCH_DEFAULT_ELEMENT_NAME,
    TRACKSWITCH_ELEMENT_NAME,
    defineTrackswitchAlignmentElement,
    defineTrackswitchDefaultElement,
    defineTrackswitchElement,
    defineTrackswitchElements,
    defineTrackswitchInteractiveElement,
};
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
    WaveformSource,
} from './domain/types';

export type { TrackswitchDomEventName, TrackswitchPlayerElement } from './element';
