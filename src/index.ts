import { defaultFeatures, normalizeFeatures } from "./domain/options";
import { createInitialPlayerState, playerStateReducer } from "./domain/state";
import {
	defineTrackswitchAlignmentElement,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchAlignmentPlayer,
	TrackswitchPlayer,
} from "./element";
import { WaveformEngine } from "./engine/waveform-engine";
import {
	defineTrackswitchInteractiveElement,
	TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	TrackswitchAlignmentInteractive,
} from "./interactive/interactive-element";
import {
	createAlignmentInteractiveTrackSwitch,
	createInteractiveTrackSwitch,
} from "./interactive/interactive-factory";
import {
	createAlignmentTrackSwitch,
	createDefaultTrackSwitch,
	createTrackSwitch,
} from "./player/factory";
import { inferSourceMimeType } from "./shared/audio";
import { formatSecondsToHHMMSSmmm } from "./shared/format";
import { parsePresetIndices } from "./shared/preset";

export type {
	AlignmentOutOfRangeMode,
	LoopMarker,
	PlayerState,
	TrackAlignmentConfig,
	TrackDefinition,
	TrackDefinitionAlignment,
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
	TrackSwitchImageConfig,
	TrackSwitchImageUiElement,
	TrackSwitchInit,
	TrackSwitchPerTrackImageConfig,
	TrackSwitchPerTrackImageUiElement,
	TrackSwitchSheetMusicConfig,
	TrackSwitchSheetMusicUiElement,
	TrackSwitchSnapshot,
	TrackSwitchTextAlign,
	TrackSwitchTextConfig,
	TrackSwitchTextUiElement,
	TrackSwitchUiConfig,
	TrackSwitchUiElement,
	TrackSwitchWarpingMatrixConfig,
	TrackSwitchWarpingMatrixUiElement,
	TrackSwitchWaveformConfig,
	TrackSwitchWaveformUiElement,
	WaveformSource,
} from "./domain/types";
export type {
	TrackswitchDomEventName,
	TrackswitchPlayerElement,
} from "./element";
export {
	createAlignmentInteractiveTrackSwitch,
	createAlignmentTrackSwitch,
	createDefaultTrackSwitch,
	createInitialPlayerState,
	createInteractiveTrackSwitch,
	createTrackSwitch,
	defaultFeatures,
	defineTrackswitchAlignmentElement,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	defineTrackswitchInteractiveElement,
	formatSecondsToHHMMSSmmm,
	inferSourceMimeType,
	normalizeFeatures,
	parsePresetIndices,
	playerStateReducer,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchAlignmentInteractive,
	TrackswitchAlignmentPlayer,
	TrackswitchPlayer,
	WaveformEngine,
};
