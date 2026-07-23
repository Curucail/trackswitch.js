import { defaultFeatures, normalizeFeatures } from "./domain/options";
import { createInitialPlayerState, playerStateReducer } from "./domain/state";
import {
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchPlayer,
} from "./element";
import { WaveformEngine } from "./engine/waveform-engine";
import {
	defineTrackSwitchSyncInteractiveElement,
	TRACKSWITCH_SYNC_INTERACTIVE_ELEMENT_NAME,
	TrackswitchSyncInteractive,
} from "./interactive/interactive-element";
import {
	createInteractiveTrackSwitch,
	createTrackSwitchSyncInteractive,
} from "./interactive/interactive-factory";
import { createTrackSwitch } from "./player/factory";
import { inferSourceMimeType } from "./shared/audio";
import { formatSecondsToHHMMSSmmm } from "./shared/format";

export type {
	AlignmentConfig,
	AlignmentOutOfRangeMode,
	LoopMarker,
	MarkerLayerConfig,
	MarkerSetSourceConfig,
	MarkersConfig,
	MediaConfig,
	MediaEntryConfig,
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
	TrackSwitchEventMap,
	TrackSwitchEventName,
	TrackSwitchFeatures,
	TrackSwitchImageViewConfig,
	TrackSwitchInit,
	TrackSwitchMidiViewConfig,
	TrackSwitchNavigationBarControl,
	TrackSwitchNavigationBarViewConfig,
	TrackSwitchPerTrackImageViewConfig,
	TrackSwitchSheetMusicViewConfig,
	TrackSwitchSnapshot,
	TrackSwitchTextAlign,
	TrackSwitchTextViewConfig,
	TrackSwitchTrackListViewConfig,
	TrackSwitchViewConfig,
	TrackSwitchWarpingMatrixViewConfig,
	TrackSwitchWaveformViewConfig,
	WaveformSource,
	WaveformTimeAxis,
} from "./domain/types";
export type {
	TrackswitchDomEventName,
	TrackswitchPlayerElement,
} from "./element";
export {
	createInitialPlayerState,
	createInteractiveTrackSwitch,
	createTrackSwitch,
	createTrackSwitchSyncInteractive,
	defaultFeatures,
	defineTrackSwitchSyncInteractiveElement,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	formatSecondsToHHMMSSmmm,
	inferSourceMimeType,
	normalizeFeatures,
	playerStateReducer,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TRACKSWITCH_SYNC_INTERACTIVE_ELEMENT_NAME,
	TrackswitchPlayer,
	TrackswitchSyncInteractive,
	WaveformEngine,
};
