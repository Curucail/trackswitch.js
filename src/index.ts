import { defaultFeatures, normalizeFeatures } from "./domain/options";
import { createInitialPlayerState, playerStateReducer } from "./domain/state";
import {
	defineTrackswitchDefaultElement,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TrackswitchPlayer,
} from "./element";
import { WaveformEngine } from "./engine/waveform-engine";
import { createTrackSwitch } from "./player/factory";
import { inferSourceMimeType } from "./shared/audio";
import { formatSecondsToHHMMSSmmm } from "./shared/format";

export type {
	AlignmentConfig,
	LoopMarker,
	MarkerLayerConfig,
	MarkerSetSourceConfig,
	MarkersConfig,
	MediaConfig,
	MediaEntryConfig,
	OutsideCoverageMode,
	PlayerState,
	PresetConfig,
	PresetsConfig,
	TrackDefinition,
	TrackLoadedSource,
	TrackRuntime,
	TrackSourceDefinition,
	TrackSourceVariant,
	TrackState,
	TrackSwitchController,
	TrackSwitchCssOverrides,
	TrackSwitchEventMap,
	TrackSwitchEventName,
	TrackSwitchFeatures,
	TrackSwitchImageViewConfig,
	TrackSwitchInit,
	TrackSwitchNavigationBarControl,
	TrackSwitchNavigationBarViewConfig,
	TrackSwitchPerTrackImageViewConfig,
	TrackSwitchPianoRollViewConfig,
	TrackSwitchSeparatorViewConfig,
	TrackSwitchSheetMusicViewConfig,
	TrackSwitchSnapshot,
	TrackSwitchTextAlign,
	TrackSwitchTextViewConfig,
	TrackSwitchTrackListViewConfig,
	TrackSwitchViewConfig,
	TrackSwitchWarpingMatrixViewConfig,
	TrackSwitchWaveformViewConfig,
	WaveformTimeAxis,
} from "./domain/types";
export type {
	TrackswitchDomEventName,
	TrackswitchPlayerElement,
} from "./element";
export {
	createInitialPlayerState,
	createTrackSwitch,
	defaultFeatures,
	defineTrackswitchDefaultElement,
	formatSecondsToHHMMSSmmm,
	inferSourceMimeType,
	normalizeFeatures,
	playerStateReducer,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TrackswitchPlayer,
	WaveformEngine,
};
