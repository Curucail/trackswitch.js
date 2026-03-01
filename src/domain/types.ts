export type LoopMarker = 'A' | 'B';
export type TrackSwitchMode = 'default' | 'alignment';
export type AlignmentOutOfRangeMode = 'clamp' | 'linear';

export interface TrackAlignmentMapping {
    trackIndex: number;
    column: string;
}

export interface TrackAlignmentConfig {
    csv: string;
    mappings?: TrackAlignmentMapping[];
    referenceTimeColumn?: string;
    referenceColumn?: string;
    outOfRange?: AlignmentOutOfRangeMode;
}

export interface TrackSourceDefinition {
    src: string;
    type?: string;
    startOffsetMs?: number;
    endOffsetMs?: number;
}

export interface TrackDefinitionAlignment {
    column?: string;
    synchronizedSources?: TrackSourceDefinition[];
    sources?: TrackSourceDefinition[];
}

export interface TrackDefinition {
    title?: string;
    solo?: boolean;
    image?: string;
    style?: string;
    presets?: number[];
    seekMarginLeft?: number;
    seekMarginRight?: number;
    sources: TrackSourceDefinition[];
    alignment?: TrackDefinitionAlignment;
}

export interface TrackSwitchFeatures {
    mode: TrackSwitchMode;
    radiosolo: boolean;
    muteOtherPlayerInstances: boolean;
    globalVolume: boolean;
    repeat: boolean;
    tabView: boolean;
    iosUnmute: boolean;
    keyboard: boolean;
    looping: boolean;
    seekBar: boolean;
    timer: boolean;
    presets: boolean;
    waveform: boolean;
}

export interface TrackSwitchImageConfig {
    src: string;
    seekable?: boolean;
    style?: string;
    seekMarginLeft?: number;
    seekMarginRight?: number;
}

export interface TrackSwitchWaveformConfig {
    width?: number;
    height?: number;
    waveformBarWidth?: number;
    maxZoom?: number | string;
    waveformSource?: 'audible' | number;
    timer?: boolean;
    style?: string;
    seekMarginLeft?: number;
    seekMarginRight?: number;
}

export interface TrackSwitchSheetMusicConfig {
    src: string;
    measureCsv: string;
    maxWidth?: number;
    width?: number;
    maxHeight?: number;
    renderScale?: number;
    followPlayback?: boolean;
    style?: string;
    cursorColor?: string;
    cursorAlpha?: number;
}

export interface TrackSwitchImageUiElement extends TrackSwitchImageConfig {
    type: 'image';
}

export interface TrackSwitchWaveformUiElement extends TrackSwitchWaveformConfig {
    type: 'waveform';
}

export interface TrackSwitchSheetMusicUiElement extends TrackSwitchSheetMusicConfig {
    type: 'sheetmusic';
}

export interface TrackSwitchTrackGroupUiElement {
    type: 'trackGroup';
    trackGroup: TrackDefinition[];
}

export interface NormalizedTrackGroupLayout {
    groupIndex: number;
    startTrackIndex: number;
    trackCount: number;
}

export type TrackSwitchUiElement =
    | TrackSwitchImageUiElement
    | TrackSwitchWaveformUiElement
    | TrackSwitchSheetMusicUiElement
    | TrackSwitchTrackGroupUiElement;
export type TrackSwitchUiConfig = TrackSwitchUiElement[];

export interface TrackSwitchConfig {
    tracks: TrackDefinition[];
    presetNames?: string[];
    features?: Partial<TrackSwitchFeatures>;
    alignment?: TrackAlignmentConfig;
    ui?: TrackSwitchUiConfig;
    trackGroups?: NormalizedTrackGroupLayout[];
}

export interface TrackSwitchInit {
    tracks?: TrackDefinition[];
    presetNames?: string[];
    features?: Partial<TrackSwitchFeatures>;
    alignment?: TrackAlignmentConfig;
    ui?: TrackSwitchUiConfig;
}

export interface TrackTiming {
    trimStart: number;
    padStart: number;
    audioDuration: number;
    effectiveDuration: number;
}

export interface TrackState {
    solo: boolean;
}

export type TrackSourceVariant = 'base' | 'synced';

export interface TrackLoadedSource {
    buffer: AudioBuffer | null;
    timing: TrackTiming | null;
    sourceIndex: number;
}

export interface TrackRuntime {
    definition: TrackDefinition;
    state: TrackState;
    gainNode: GainNode | null;
    buffer: AudioBuffer | null;
    timing: TrackTiming | null;
    activeSource: AudioBufferSourceNode | null;
    sourceIndex: number;
    activeVariant: TrackSourceVariant;
    baseSource: TrackLoadedSource;
    syncedSource: TrackLoadedSource | null;
    successful: boolean;
    errored: boolean;
    waveformCache: Map<string, Float32Array>;
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

export type TrackSwitchEventName = 'loaded' | 'error' | 'position' | 'trackState';

export interface TrackSwitchEventMap {
    loaded: { longestDuration: number };
    error: { message: string };
    position: { position: number; duration: number };
    trackState: { index: number; state: TrackState };
}

export type TrackSwitchEventHandler<K extends TrackSwitchEventName> = (
    payload: TrackSwitchEventMap[K]
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
    destroy(): void;
    togglePlay(): void;
    play(): void;
    pause(): void;
    stop(): void;
    seekTo(seconds: number): void;
    seekRelative(seconds: number): void;
    setRepeat(enabled: boolean): void;
    setVolume(volumeZeroToOne: number): void;
    setLoopPoint(marker: LoopMarker): boolean;
    toggleLoop(): boolean;
    clearLoop(): void;
    toggleSolo(trackIndex: number, exclusive?: boolean): void;
    applyPreset(presetIndex: number): void;
    getState(): TrackSwitchSnapshot;
    on<K extends TrackSwitchEventName>(eventName: K, handler: TrackSwitchEventHandler<K>): () => void;
    off<K extends TrackSwitchEventName>(eventName: K, handler: TrackSwitchEventHandler<K>): void;
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
