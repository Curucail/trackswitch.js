import type {
	MarkerSetId as BrandedMarkerSetId,
	Marker,
	MarkerSet,
	RuntimeMarkerSet,
} from "../timeline/marker";
import type { ProjectionService } from "../timeline/projection";
import type {
	ReferenceExtent,
	Timeline,
	TimelineId,
} from "../timeline/timeline";

export type LoopMarker = "A" | "B";
export type AlignmentOutOfRangeMode = "clamp" | "linear" | "error";
export type DuplicatePlacementPolicy = "average" | "error";
export type WaveformPlaybackFollowMode = "off" | "center" | "jump";
export type TrackSwitchTextAlign = "left" | "center" | "right";
export type MarkerLineStyle = "solid" | "dashed";

/** A media id doubles as a timeline id; a track id is a media id restricted to `type: 'audio'`. */
export type MediaId = string;
export type TrackId = MediaId;
export type MarkerSetId = string;
export type PresetId = string;

export type WaveformSource = "audible" | TrackId[];

/**
 * Internal rendering representation: sourceTracks resolved to positions in the
 * runtimes array. Derived at config-normalization time, never configured directly.
 */
export type WaveformSourceIndex = "audible" | number | number[];

/** Whether a fixed-track waveform uses the shared duration or its own duration. */
export type WaveformTimeAxis = "shared" | "individual";

// ═══════════ config: data ═══════════

export interface TrackSourceDefinition {
	src: string;
	type?: string;
	startOffsetMs?: number;
	endOffsetMs?: number;
}

export interface SynchronizedAudioSourceConfig {
	src: string;
	/** Must name a seconds-unit timeline declared in alignment.timelines. */
	timeline: string;
}

export interface AudioMediaEntryConfig {
	type: "audio";
	src: string;
	title?: string;
	image?: string;
	style?: string;
	solo?: boolean;
	volume?: number;
	pan?: number;
	startOffsetMs?: number;
	endOffsetMs?: number;
	srcSynchronized?: SynchronizedAudioSourceConfig;
}

export interface MidiMediaEntryConfig {
	type: "midi";
	src: string;
}

export interface MusicXmlMediaEntryConfig {
	type: "musicxml";
	src: string;
}

export type MediaEntryConfig =
	| AudioMediaEntryConfig
	| MidiMediaEntryConfig
	| MusicXmlMediaEntryConfig;

export type MediaConfig = Record<MediaId, MediaEntryConfig>;

export interface AlignmentConfig {
	src: string;
	referenceTimeline: string;
	/** timeline id -> CSV column name */
	timelines: Record<string, string>;
	outside?: AlignmentOutOfRangeMode;
	duplicatePlacements?: DuplicatePlacementPolicy;
}

export interface MarkerSetSourceConfig {
	src: string;
	/** Defaults to the reference timeline; meaningless (and omittable) with no alignment block. */
	timeline?: string;
	timeCol: string;
	labelCol?: string;
}

export type MarkersConfig = Record<MarkerSetId, MarkerSetSourceConfig>;

export interface PresetConfig {
	label?: string;
	tracks: TrackId[];
}

export type PresetsConfig = Record<PresetId, PresetConfig>;

export interface MarkerLayerConfig {
	set: MarkerSetId;
	color?: string;
	line?: MarkerLineStyle;
	/** Draw a connector from this timeline to the reference timeline. Ignored when the view's timeline IS the reference. */
	foldToReference?: boolean;
}

// ═══════════ config: views ═══════════

export interface TrackSwitchImageViewConfig {
	type: "image";
	src: string;
	seekable?: boolean;
	style?: string;
	seekMarginLeft?: number;
	seekMarginRight?: number;
	markerLayers?: MarkerLayerConfig[];
}

export interface TrackSwitchPerTrackImageViewConfig {
	type: "perTrackImage";
	seekable?: boolean;
	style?: string;
	seekMarginLeft?: number;
	seekMarginRight?: number;
	markerLayers?: MarkerLayerConfig[];
}

export interface TrackSwitchWaveformViewConfig {
	type: "waveform";
	sourceTracks?: TrackId[] | "audible";
	height?: number;
	waveformBarWidth?: number;
	maxZoom?: number;
	playbackFollowMode?: WaveformPlaybackFollowMode;
	timeAxis?: WaveformTimeAxis;
	timer?: boolean;
	alignedPlayhead?: boolean;
	markerLayers?: MarkerLayerConfig[];
	style?: string;
	seekMarginLeft?: number;
	seekMarginRight?: number;
}

export interface TrackSwitchMidiViewConfig {
	type: "midi";
	mediaID: MediaId;
	height?: number;
	maxZoom?: number;
	playbackFollowMode?: WaveformPlaybackFollowMode;
	timer?: boolean;
	markerLayers?: MarkerLayerConfig[];
	style?: string;
	seekMarginLeft?: number;
	seekMarginRight?: number;
}

export interface TrackSwitchSheetMusicViewConfig {
	type: "sheetMusic";
	mediaID: MediaId;
	maxWidth?: number;
	maxHeight?: number;
	renderScale?: number;
	followPlayback?: boolean;
	style?: string;
	cursorColor?: string;
	cursorAlpha?: number;
	markerLayers?: MarkerLayerConfig[];
}

export interface TrackSwitchWarpingMatrixViewConfig {
	type: "warpingMatrix";
	x: TrackId;
	y: TrackId;
	style?: string;
	height?: number;
	tempoSmoothingSeconds?: number;
}

export interface TrackSwitchTextViewConfig {
	type: "text";
	text: string;
	bold?: boolean;
	italic?: boolean;
	fontSize?: number;
	align?: TrackSwitchTextAlign;
	style?: string;
}

export interface TrackSwitchTrackListViewConfig {
	type: "trackList";
	tracks: TrackId[];
	rowHeight?: number;
	trackVolumeControls?: boolean;
	trackPanControls?: boolean;
}

export interface TrackSwitchNavigationBarViewConfig {
	type: "navigationBar";
	repeat?: boolean;
	timer?: boolean;
	seekBar?: boolean;
	globalVolume?: boolean;
	looping?: boolean;
	markerNavigation?: boolean;
}

export type TrackSwitchViewConfig =
	| TrackSwitchImageViewConfig
	| TrackSwitchPerTrackImageViewConfig
	| TrackSwitchWaveformViewConfig
	| TrackSwitchMidiViewConfig
	| TrackSwitchSheetMusicViewConfig
	| TrackSwitchWarpingMatrixViewConfig
	| TrackSwitchTextViewConfig
	| TrackSwitchTrackListViewConfig
	| TrackSwitchNavigationBarViewConfig;

export interface TrackSwitchFeatures {
	exclusiveSolo: boolean;
	muteOtherPlayerInstances: boolean;
	customizablePanelOrder: boolean;
	tabView: boolean;
	iosAudioUnlock: boolean;
	keyboard: boolean;
}

export interface TrackSwitchInit {
	media: MediaConfig;
	alignment?: AlignmentConfig;
	markers?: MarkersConfig;
	presets?: PresetsConfig;
	views: TrackSwitchViewConfig[];
	features?: Partial<TrackSwitchFeatures>;
}

// ═══════════ resolved / runtime ═══════════

/** One `trackList` view, resolved to the track ids it lists (row index = declaration order among trackList views). */
export interface TrackListGroup {
	groupIndex: number;
	trackIds: TrackId[];
	rowHeight?: number;
	trackVolumeControls: boolean;
	trackPanControls: boolean;
}

export interface TrackDefinition {
	id: TrackId;
	title?: string;
	image?: string;
	style?: string;
	solo?: boolean;
	volume?: number;
	pan?: number;
	sources: TrackSourceDefinition[];
	syncedSources?: TrackSourceDefinition[];
}

export interface ResolvedAlignment {
	referenceTimeline: TimelineId;
	timelines: ReadonlyMap<TimelineId, Timeline>;
	outOfRange: AlignmentOutOfRangeMode;
	markerSet: MarkerSet;
	projection: ProjectionService;
	referenceExtent: ReferenceExtent;
}

export interface ResolvedMarkerSet {
	id: BrandedMarkerSetId;
	timeline: TimelineId;
	hasLabels: boolean;
	markerSet: MarkerSet;
}

/**
 * Structurally validated config, ids cross-checked. Alignment/marker CSVs are not
 * fetched here — that happens asynchronously during controller.load(), same as today.
 */
export interface NormalizedTrackSwitchConfig {
	tracks: TrackDefinition[];
	media: MediaConfig;
	alignment?: AlignmentConfig;
	markers: MarkersConfig;
	presets: PresetsConfig;
	features?: Partial<TrackSwitchFeatures>;
	views: TrackSwitchViewConfig[];
}

export interface TrackTiming {
	trimStart: number;
	padStart: number;
	audioDuration: number;
	effectiveDuration: number;
}

export type AudioDownloadSizeStatus =
	| "calculating"
	| "known"
	| "partial"
	| "unavailable";

export interface AudioDownloadSizeInfo {
	status: AudioDownloadSizeStatus;
	totalBytes: number | null;
	resolvedSourceCount: number;
	totalSourceCount: number;
}

export interface TrackState {
	solo: boolean;
	volume: number;
	pan: number;
}

export type TrackSourceVariant = "base" | "synced";

export interface WaveformSummaryLevel {
	samplesPerEntry: number;
	mins: Float32Array;
	maxes: Float32Array;
}

export interface WaveformSummary {
	duration: number;
	sampleRate: number;
	sampleCount: number;
	levels: WaveformSummaryLevel[];
}

export interface TrackLoadedSource {
	buffer: AudioBuffer | null;
	timing: TrackTiming | null;
	sourceIndex: number;
	waveformSummary: WaveformSummary | null;
}

export interface TrackRuntime {
	definition: TrackDefinition;
	state: TrackState;
	gainNode: GainNode | null;
	pannerNode: StereoPannerNode | null;
	buffer: AudioBuffer | null;
	timing: TrackTiming | null;
	activeSource: AudioBufferSourceNode | null;
	sourceIndex: number;
	activeVariant: TrackSourceVariant;
	baseSource: TrackLoadedSource;
	syncedSource: TrackLoadedSource | null;
	successful: boolean;
	errored: boolean;
	waveformSummary: WaveformSummary | null;
}

export interface LoopState {
	pointA: number | null;
	pointB: number | null;
	enabled: boolean;
}

export interface PlayerState {
	playing: boolean;
	repeat: boolean;
	position: number;
	startTime: number;
	currentlySeeking: boolean;
	loop: LoopState;
	volume: number;
}

export type TrackSwitchEventName =
	| "loaded"
	| "error"
	| "position"
	| "trackState";

export interface TrackSwitchEventMap {
	loaded: { longestDuration: number };
	error: { message: string };
	position: { position: number; duration: number };
	trackState: { index: number; state: TrackState };
}

export type TrackSwitchEventHandler<K extends TrackSwitchEventName> = (
	payload: TrackSwitchEventMap[K],
) => void;

export interface TrackSwitchSnapshot {
	isLoaded: boolean;
	isLoading: boolean;
	isDestroyed: boolean;
	longestDuration: number;
	features: TrackSwitchFeatures;
	state: PlayerState;
	tracks: TrackState[];
}

export interface TrackSwitchController {
	load(): Promise<void>;
	updateConfig(nextConfig: TrackSwitchInit): Promise<void>;
	destroy(): void;
	togglePlay(): void;
	play(): void;
	pause(): void;
	stop(): void;
	seekTo(seconds: number): void;
	seekRelative(seconds: number): void;
	setRepeat(enabled: boolean): void;
	setVolume(volumeZeroToOne: number): void;
	setTrackVolume(trackIndex: number, volumeZeroToOne: number): void;
	setTrackPan(trackIndex: number, panMinusOneToOne: number): void;
	setLoopPoint(marker: LoopMarker): boolean;
	toggleLoop(): boolean;
	clearLoop(): void;
	toggleSolo(trackIndex: number, exclusive?: boolean): void;
	applyPreset(presetId: PresetId): void;
	getState(): TrackSwitchSnapshot;
	on<K extends TrackSwitchEventName>(
		eventName: K,
		handler: TrackSwitchEventHandler<K>,
	): () => void;
	off<K extends TrackSwitchEventName>(
		eventName: K,
		handler: TrackSwitchEventHandler<K>,
	): void;
}

export interface TrackSwitchUiState {
	playing: boolean;
	repeat: boolean;
	position: number;
	longestDuration: number;
	syncEnabled: boolean;
	syncAvailable: boolean;
	loop: LoopState;
}

export type { Marker, MarkerSet, RuntimeMarkerSet };
