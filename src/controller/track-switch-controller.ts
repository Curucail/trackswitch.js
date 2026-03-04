import {
    AlignmentOutOfRangeMode,
    LoopMarker,
    NormalizedTrackSwitchConfig,
    PlayerState,
    TrackAlignmentConfig,
    TrackSourceVariant,
    TrackRuntime,
    TrackSwitchController,
    TrackSwitchEventHandler,
    TrackSwitchEventMap,
    TrackSwitchEventName,
    TrackSwitchFeatures,
    TrackSwitchSnapshot,
} from '../domain/types';
import { normalizeFeatures } from '../domain/options';
import { createInitialPlayerState, PlayerAction } from '../domain/state';
import { createTrackRuntime } from '../domain/runtime';
import { AudioEngine } from '../engine/audio-engine';
import { SheetMusicEngine } from '../engine/sheet-music-engine';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import { ViewRenderer, WarpingMatrixRenderContext, WaveformTimelineContext } from '../ui/view-renderer';
import { InputBinder, InputController } from '../input/input-binder';
import { derivePresetNames } from '../shared/preset';
import { ControllerPointerEvent } from '../shared/seek';
import { TimeMappingSeries } from '../shared/alignment';
import {
    allocateInstanceId,
    registerController,
} from './controller-registry';

import * as controllerPlayback from './controller-playback';
import * as controllerInput from './controller-input';
import * as controllerSeek from './controller-seek';
import * as controllerAlignment from './controller-alignment';
import * as controllerUi from './controller-ui';
import * as controllerEvents from './controller-events';

interface TrackAlignmentConverter {
    referenceToTrack: TimeMappingSeries;
    trackToReference: TimeMappingSeries;
}

interface AlignmentContext {
    referenceDuration: number;
    outOfRange: AlignmentOutOfRangeMode;
    converters: Map<number, TrackAlignmentConverter>;
    columnByTrack: Map<number, string>;
    uniqueColumnOrder: string[];
}

interface SeekTimelineContext {
    duration: number;
    toReferenceTime(timelineTime: number): number;
    fromReferenceTime(referenceTime: number): number;
}

interface PinchZoomState {
    seekWrap: HTMLElement;
    initialDistance: number;
    initialZoom: number;
}

interface PendingWaveformTouchSeek {
    seekWrap: HTMLElement;
    startPageX: number;
    startPageY: number;
}

export class TrackSwitchControllerImpl implements TrackSwitchController, InputController {
    public readonly root: HTMLElement;
    public readonly features: TrackSwitchFeatures;
    public readonly audioEngine: AudioEngine;
    public readonly waveformEngine: WaveformEngine;
    public readonly sheetMusicEngine: SheetMusicEngine;
    public readonly renderer: ViewRenderer;
    public readonly inputBinder: InputBinder;
    public readonly alignmentConfig: TrackAlignmentConfig | undefined;

    public state: PlayerState;
    public longestDuration = 0;
    public runtimes: TrackRuntime[];

    public isLoaded = false;
    public isLoading = false;
    public isDestroyed = false;

    public timerMonitorPosition: ReturnType<typeof setInterval> | null = null;
    public resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    public seekingElement: HTMLElement | null = null;
    public rightClickDragging = false;
    public loopDragStart: number | null = null;
    public draggingMarker: LoopMarker | null = null;
    public pinchZoomState: PinchZoomState | null = null;
    public pendingWaveformTouchSeek: PendingWaveformTouchSeek | null = null;
    public waveformRenderFrameId: number | null = null;
    public readonly loopMinDistance = 0.1;
    public readonly touchSeekMoveThresholdPx = 10;

    public iOSPlaybackUnlocked = false;
    public alignmentContext: AlignmentContext | null = null;
    public alignmentPlaybackTrackIndex: number | null = null;
    public globalSyncEnabled = false;
    public effectiveSingleSoloMode = false;
    public readonly syncLockedTrackIndexes = new Set<number>();
    public preSyncSoloTrackIndex: number | null = null;

    public readonly listeners: Record<TrackSwitchEventName, Set<(payload: unknown) => void>> = {
        loaded: new Set(),
        error: new Set(),
        position: new Set(),
        trackState: new Set(),
    };

    public readonly eventNamespace: string;
    public readonly instanceId: number;
    public readonly presetCount: number;

    constructor(rootElement: HTMLElement, config: NormalizedTrackSwitchConfig) {
        this.root = rootElement;
        this.alignmentConfig = config.alignment;

        this.features = normalizeFeatures(config.features);
        if (this.features.mode === 'alignment') {
            this.features.exclusiveSolo = true;
            this.features.presets = false;
        }
        this.effectiveSingleSoloMode = this.features.mode === 'alignment'
            ? true
            : this.features.exclusiveSolo;
        this.state = createInitialPlayerState(this.features.repeat);

        this.runtimes = config.tracks.map(function(track, index) {
            return createTrackRuntime(track, index);
        });

        if (
            this.features.exclusiveSolo
            && this.runtimes.length > 0
            && !this.runtimes.some(function(runtime) { return runtime.state.solo; })
        ) {
            this.runtimes[0].state.solo = true;
        }

        const presetNames = !this.features.presets
            ? []
            : derivePresetNames(config);
        this.presetCount = presetNames.length;

        this.audioEngine = new AudioEngine(this.features, this.state.volume);
        this.waveformEngine = new WaveformEngine();
        this.sheetMusicEngine = new SheetMusicEngine((referenceTime) => {
            this.seekTo(referenceTime);
        });
        this.renderer = new ViewRenderer(
            this.root,
            this.features,
            presetNames,
            config.trackGroups,
            (referenceTime) => {
                this.seekTo(referenceTime);
            }
        );

        this.instanceId = allocateInstanceId();

        this.eventNamespace = '.trackswitch.' + this.instanceId;

        this.renderer.initialize(this.runtimes);
        this.renderer.drawDummyWaveforms(this.waveformEngine);

        this.inputBinder = new InputBinder(this.root, this.features, this);
        this.inputBinder.bind();

        if (this.presetCount > 0) {
            this.applyPreset(0);
        } else {
            this.applyTrackProperties();
        }
        this.updateMainControls();

        if (this.runtimes.length === 0) {
            this.handleError('No tracks available.');
        }

        registerController(this);
    }

    async load(): Promise<void> {
        return controllerPlayback.load(this);
    }

    destroy(): void {
        return controllerPlayback.destroy(this);
    }

    togglePlay(): void {
        return controllerPlayback.togglePlay(this);
    }

    play(): void {
        return controllerPlayback.play(this);
    }

    pause(): void {
        return controllerPlayback.pause(this);
    }

    stop(): void {
        return controllerPlayback.stop(this);
    }

    seekTo(seconds: number): void {
        return controllerPlayback.seekTo(this, seconds);
    }

    seekRelative(seconds: number): void {
        return controllerPlayback.seekRelative(this, seconds);
    }

    setRepeat(enabled: boolean): void {
        return controllerPlayback.setRepeat(this, enabled);
    }

    setVolume(volumeZeroToOne: number): void {
        return controllerPlayback.setVolume(this, volumeZeroToOne);
    }

    setTrackVolume(trackIndex: number, volumeZeroToOne: number): void {
        return controllerPlayback.setTrackVolume(this, trackIndex, volumeZeroToOne);
    }

    setTrackPan(trackIndex: number, panMinusOneToOne: number): void {
        return controllerPlayback.setTrackPan(this, trackIndex, panMinusOneToOne);
    }

    setLoopPoint(marker: LoopMarker): boolean {
        return controllerPlayback.setLoopPoint(this, marker);
    }

    toggleLoop(): boolean {
        return controllerPlayback.toggleLoop(this);
    }

    clearLoop(): void {
        return controllerPlayback.clearLoop(this);
    }

    toggleSolo(trackIndex: number, exclusive = false): void {
        return controllerPlayback.toggleSolo(this, trackIndex, exclusive);
    }

    applyPreset(presetIndex: number): void {
        return controllerPlayback.applyPreset(this, presetIndex);
    }

    getState(): TrackSwitchSnapshot {
        return controllerEvents.getState(this);
    }

    on<K extends TrackSwitchEventName>(eventName: K, handler: TrackSwitchEventHandler<K>): () => void {
        return controllerEvents.on(this, eventName, handler);
    }

    off<K extends TrackSwitchEventName>(eventName: K, handler: TrackSwitchEventHandler<K>): void {
        return controllerEvents.off(this, eventName, handler);
    }

    setKeyboardActive(): void {
        return controllerInput.setKeyboardActive(this);
    }

    onOverlayActivate(event: ControllerPointerEvent): void {
        return controllerInput.onOverlayActivate(this, event);
    }

    onOverlayInfo(event: ControllerPointerEvent): void {
        return controllerInput.onOverlayInfo(this, event);
    }

    onPlayPause(event: ControllerPointerEvent): void {
        return controllerInput.onPlayPause(this, event);
    }

    onStop(event: ControllerPointerEvent): void {
        return controllerInput.onStop(this, event);
    }

    onRepeat(event: ControllerPointerEvent): void {
        return controllerInput.onRepeat(this, event);
    }

    onSeekStart(event: ControllerPointerEvent): void {
        return controllerInput.onSeekStart(this, event);
    }

    onSeekMove(event: ControllerPointerEvent): void {
        return controllerSeek.onSeekMove(this, event);
    }

    onSeekEnd(event: ControllerPointerEvent): void {
        return controllerInput.onSeekEnd(this, event);
    }

    onSolo(event: ControllerPointerEvent): void {
        return controllerInput.onSolo(this, event);
    }

    onAlignmentSync(event: ControllerPointerEvent): void {
        return controllerInput.onAlignmentSync(this, event);
    }

    onVolume(event: ControllerPointerEvent): void {
        return controllerInput.onVolume(this, event);
    }

    onTrackVolume(event: ControllerPointerEvent): void {
        return controllerInput.onTrackVolume(this, event);
    }

    onTrackPan(event: ControllerPointerEvent): void {
        return controllerInput.onTrackPan(this, event);
    }

    onPreset(event: ControllerPointerEvent): void {
        return controllerInput.onPreset(this, event);
    }

    onPresetScroll(event: ControllerPointerEvent): void {
        return controllerInput.onPresetScroll(this, event);
    }

    onWaveformZoomWheel(event: ControllerPointerEvent): void {
        return controllerSeek.onWaveformZoomWheel(this, event);
    }

    onSetLoopA(event: ControllerPointerEvent): void {
        return controllerInput.onSetLoopA(this, event);
    }

    onSetLoopB(event: ControllerPointerEvent): void {
        return controllerInput.onSetLoopB(this, event);
    }

    onToggleLoop(event: ControllerPointerEvent): void {
        return controllerInput.onToggleLoop(this, event);
    }

    onClearLoop(event: ControllerPointerEvent): void {
        return controllerInput.onClearLoop(this, event);
    }

    onMarkerDragStart(event: ControllerPointerEvent): void {
        return controllerInput.onMarkerDragStart(this, event);
    }

    onKeyboard(event: ControllerPointerEvent): void {
        return controllerInput.onKeyboard(this, event);
    }

    public getKeyboardTrackIndex(event: ControllerPointerEvent): number | null {
        return controllerInput.getKeyboardTrackIndex(this, event);
    }

    onResize(): void {
        return controllerInput.onResize(this);
    }

    public requestWaveformRender(): void {
        return controllerSeek.requestWaveformRender(this);
    }

    public isWaveformSeekSurface(seekWrap: HTMLElement | null): boolean {
        return controllerSeek.isWaveformSeekSurface(this, seekWrap);
    }

    public startInteractiveSeek(event: ControllerPointerEvent, seekWrap: HTMLElement): void {
        return controllerSeek.startInteractiveSeek(this, event, seekWrap);
    }

    public disableLoopWhenSeekOutsideRegion(): void {
        return controllerSeek.disableLoopWhenSeekOutsideRegion(this);
    }

    public tryStartPendingWaveformTouchSeek(
        event: ControllerPointerEvent,
        seekWrap: HTMLElement | null
    ): boolean {
        return controllerSeek.tryStartPendingWaveformTouchSeek(this, event, seekWrap);
    }

    public tryActivatePendingWaveformTouchSeek(event: ControllerPointerEvent): boolean {
        return controllerSeek.tryActivatePendingWaveformTouchSeek(this, event);
    }

    public applyPendingWaveformTouchSeekTap(event: ControllerPointerEvent): void {
        return controllerSeek.applyPendingWaveformTouchSeekTap(this, event);
    }

    public getTouchPair(event: ControllerPointerEvent): [Touch, Touch] | null {
        return controllerSeek.getTouchPair(this, event);
    }

    public getTouchDistance(event: ControllerPointerEvent): number | null {
        return controllerSeek.getTouchDistance(this, event);
    }

    public getTouchCenterPageX(event: ControllerPointerEvent): number | null {
        return controllerSeek.getTouchCenterPageX(this, event);
    }

    public getActiveTouchCount(event: ControllerPointerEvent): number {
        return controllerSeek.getActiveTouchCount(this, event);
    }

    public tryStartPinchZoom(event: ControllerPointerEvent, seekWrap: HTMLElement | null): boolean {
        return controllerSeek.tryStartPinchZoom(this, event, seekWrap);
    }

    public updatePinchZoom(event: ControllerPointerEvent): boolean {
        return controllerSeek.updatePinchZoom(this, event);
    }

    public endPinchZoom(): void {
        return controllerSeek.endPinchZoom(this);
    }

    public trackIndexFromTarget(target: EventTarget | null): number {
        return controllerSeek.trackIndexFromTarget(this, target);
    }

    public isAlignmentMode(): boolean {
        return controllerAlignment.isAlignmentMode(this);
    }

    public hasSyncedVariant(runtime: TrackRuntime): boolean {
        return controllerAlignment.hasSyncedVariant(this, runtime);
    }

    public isTrackSyncLocked(trackIndex: number): boolean {
        return controllerAlignment.isTrackSyncLocked(this, trackIndex);
    }

    public setEffectiveSoloMode(singleSoloMode: boolean): void {
        return controllerAlignment.setEffectiveSoloMode(this, singleSoloMode);
    }

    public toggleGlobalSync(): void {
        return controllerAlignment.toggleGlobalSync(this);
    }

    public applyGlobalSyncState(syncOn: boolean): void {
        return controllerAlignment.applyGlobalSyncState(this, syncOn);
    }

    public setRuntimeActiveVariant(runtime: TrackRuntime, variant: TrackSourceVariant): boolean {
        return controllerAlignment.setRuntimeActiveVariant(this, runtime, variant);
    }

    public shouldBypassAlignmentMapping(trackIndex: number): boolean {
        return controllerAlignment.shouldBypassAlignmentMapping(this, trackIndex);
    }

    public applyTrackProperties(): void {
        return controllerUi.applyTrackProperties(this);
    }

    public updateMainControls(): void {
        return controllerUi.updateMainControls(this);
    }

    public async initializeSheetMusic(): Promise<void> {
        return controllerPlayback.initializeSheetMusic(this);
    }

    public dispatch(action: PlayerAction): void {
        return controllerPlayback.dispatch(this, action);
    }

    public pauseOthers(): void {
        return controllerPlayback.pauseOthers(this);
    }

    public startAudio(newPosition?: number, snippetDuration?: number): void {
        return controllerPlayback.startAudio(this, newPosition, snippetDuration);
    }

    public stopAudio(): void {
        return controllerPlayback.stopAudio(this);
    }

    public monitorPosition(): void {
        return controllerPlayback.monitorPosition(this);
    }

    public seekFromEvent(event: ControllerPointerEvent, usePreviewSnippet = true): void {
        return controllerPlayback.seekFromEvent(this, event, usePreviewSnippet);
    }

    public findLongestDuration(): number {
        return controllerPlayback.findLongestDuration(this);
    }

    public static getRuntimeDuration(runtime: TrackRuntime): number {
        return runtime.timing
            ? runtime.timing.effectiveDuration
            : (runtime.buffer ? runtime.buffer.duration : 0);
    }

    public async initializeAlignmentMode(): Promise<string | null> {
        return controllerAlignment.initializeAlignmentMode(this);
    }

    public async buildAlignmentContext(): Promise<AlignmentContext | string> {
        return controllerAlignment.buildAlignmentContext(this);
    }

    public collectUniqueAlignmentColumns(mappingByTrack: Map<number, string>): string[] {
        return controllerAlignment.collectUniqueAlignmentColumns(this, mappingByTrack);
    }

    public getWarpingMatrixContext(): WarpingMatrixRenderContext | undefined {
        return controllerAlignment.getWarpingMatrixContext(this);
    }

    public getAudibleTrackIndexesForWarpingMatrix(): number[] {
        return controllerAlignment.getAudibleTrackIndexesForWarpingMatrix(this);
    }

    public resolveReferenceColumn(config: TrackAlignmentConfig): string | null {
        return controllerAlignment.resolveReferenceColumn(this, config);
    }

    public resolveReferenceDuration(rows: Array<Record<string, number>>, referenceColumn: string): number | string {
        return controllerAlignment.resolveReferenceDuration(this, rows, referenceColumn);
    }

    public resolveAlignmentMappingsByTrack(config: TrackAlignmentConfig): Map<number, string> | string {
        return controllerAlignment.resolveAlignmentMappingsByTrack(this, config);
    }

    public validateAndBuildLegacyAlignmentMappings(config: TrackAlignmentConfig): Map<number, string> | string {
        return controllerAlignment.validateAndBuildLegacyAlignmentMappings(this, config);
    }

    public getActiveSoloTrackIndex(): number {
        return controllerAlignment.getActiveSoloTrackIndex(this);
    }

    public currentPlaybackReferencePosition(): number {
        return controllerAlignment.currentPlaybackReferencePosition(this);
    }

    public isFixedWaveformLocalAxisEnabled(): boolean {
        return controllerSeek.isFixedWaveformLocalAxisEnabled(this);
    }

    public getSeekTimelineContext(seekingElement: HTMLElement | null): SeekTimelineContext {
        return controllerSeek.getSeekTimelineContext(this, seekingElement);
    }

    public getWaveformTimelineContext(): WaveformTimelineContext {
        return controllerSeek.getWaveformTimelineContext(this);
    }

    public getWaveformTimelineProjector(): TrackTimelineProjector | undefined {
        return controllerSeek.getWaveformTimelineProjector(this);
    }

    public referenceToTrackTime(trackIndex: number, referenceTime: number): number {
        return controllerAlignment.referenceToTrackTime(this, trackIndex, referenceTime);
    }

    public trackToReferenceTime(trackIndex: number, trackTime: number): number {
        return controllerAlignment.trackToReferenceTime(this, trackIndex, trackTime);
    }

    public handleAlignmentTrackSwitch(nextActiveTrackIndex: number): void {
        return controllerAlignment.handleAlignmentTrackSwitch(this, nextActiveTrackIndex);
    }

    public emit<K extends TrackSwitchEventName>(eventName: K, payload: TrackSwitchEventMap[K]): void {
        return controllerEvents.emit(this, eventName, payload);
    }

    public handleError(message: string): void {
        return controllerPlayback.handleError(this, message);
    }
}
