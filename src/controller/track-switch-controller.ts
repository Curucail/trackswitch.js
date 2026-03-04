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
    TrackSwitchUiState,
} from '../domain/types';
import { normalizeFeatures } from '../domain/options';
import { createInitialPlayerState, playerStateReducer, PlayerAction } from '../domain/state';
import { createTrackRuntime } from '../domain/runtime';
import { AudioEngine } from '../engine/audio-engine';
import { SheetMusicEngine } from '../engine/sheet-music-engine';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import { ViewRenderer, WarpingMatrixRenderContext, WaveformTimelineContext } from '../ui/view-renderer';
import { InputBinder, InputController } from '../input/input-binder';
import { eventTargetAsElement } from '../shared/dom';
import { clamp } from '../shared/math';
import { derivePresetNames, parseStrictNonNegativeInt } from '../shared/preset';
import { ControllerPointerEvent, getSeekMetrics, isPrimaryInput } from '../shared/seek';
import {
    buildColumnTimeMapping,
    loadNumericCsv,
    mapTime,
    resolveAlignmentOutOfRangeMode,
    TimeMappingSeries,
} from '../shared/alignment';
import {
    allocateInstanceId,
    isKeyboardControllerActive,
    pauseOtherControllers,
    registerController,
    setActiveKeyboardController,
    unregisterController,
} from './controller-registry';

import * as controllerPlayback from './controller-playback';
import * as controllerInput from './controller-input';
import * as controllerSeek from './controller-seek';
import * as controllerAlignment from './controller-alignment';
import * as controllerUi from './controller-ui';
import * as controllerEvents from './controller-events';

function closestInRoot(root: HTMLElement, target: EventTarget | null | undefined, selector: string): HTMLElement | null {
    const element = eventTargetAsElement(target ?? null);
    if (!element) {
        return null;
    }

    const matched = element.closest(selector);
    if (!matched || !root.contains(matched)) {
        return null;
    }

    return matched as HTMLElement;
}

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
    private readonly root: HTMLElement;
    private readonly features: TrackSwitchFeatures;
    private readonly audioEngine: AudioEngine;
    private readonly waveformEngine: WaveformEngine;
    private readonly sheetMusicEngine: SheetMusicEngine;
    private readonly renderer: ViewRenderer;
    private readonly inputBinder: InputBinder;
    private readonly alignmentConfig: TrackAlignmentConfig | undefined;

    private state: PlayerState;
    private longestDuration = 0;
    private runtimes: TrackRuntime[];

    private isLoaded = false;
    private isLoading = false;
    private isDestroyed = false;

    private timerMonitorPosition: ReturnType<typeof setInterval> | null = null;
    private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    private seekingElement: HTMLElement | null = null;
    private rightClickDragging = false;
    private loopDragStart: number | null = null;
    private draggingMarker: LoopMarker | null = null;
    private pinchZoomState: PinchZoomState | null = null;
    private pendingWaveformTouchSeek: PendingWaveformTouchSeek | null = null;
    private waveformRenderFrameId: number | null = null;
    private readonly loopMinDistance = 0.1;
    private readonly touchSeekMoveThresholdPx = 10;

    private iOSPlaybackUnlocked = false;
    private alignmentContext: AlignmentContext | null = null;
    private alignmentPlaybackTrackIndex: number | null = null;
    private globalSyncEnabled = false;
    private effectiveSingleSoloMode = false;
    private readonly syncLockedTrackIndexes = new Set<number>();
    private preSyncSoloTrackIndex: number | null = null;

    private readonly listeners: Record<TrackSwitchEventName, Set<(payload: unknown) => void>> = {
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

    private getKeyboardTrackIndex(event: ControllerPointerEvent): number | null {
        return controllerInput.getKeyboardTrackIndex(this, event);
    }

    onResize(): void {
        return controllerInput.onResize(this);
    }

    private requestWaveformRender(): void {
        return controllerSeek.requestWaveformRender(this);
    }

    private isWaveformSeekSurface(seekWrap: HTMLElement | null): boolean {
        return controllerSeek.isWaveformSeekSurface(this, seekWrap);
    }

    private startInteractiveSeek(event: ControllerPointerEvent, seekWrap: HTMLElement): void {
        return controllerSeek.startInteractiveSeek(this, event, seekWrap);
    }

    private disableLoopWhenSeekOutsideRegion(): void {
        return controllerSeek.disableLoopWhenSeekOutsideRegion(this);
    }

    private tryStartPendingWaveformTouchSeek(
        event: ControllerPointerEvent,
        seekWrap: HTMLElement | null
    ): boolean {
        return controllerSeek.tryStartPendingWaveformTouchSeek(this, event, seekWrap);
    }

    private tryActivatePendingWaveformTouchSeek(event: ControllerPointerEvent): boolean {
        return controllerSeek.tryActivatePendingWaveformTouchSeek(this, event);
    }

    private applyPendingWaveformTouchSeekTap(event: ControllerPointerEvent): void {
        return controllerSeek.applyPendingWaveformTouchSeekTap(this, event);
    }

    private getTouchPair(event: ControllerPointerEvent): [Touch, Touch] | null {
        return controllerSeek.getTouchPair(this, event);
    }

    private getTouchDistance(event: ControllerPointerEvent): number | null {
        return controllerSeek.getTouchDistance(this, event);
    }

    private getTouchCenterPageX(event: ControllerPointerEvent): number | null {
        return controllerSeek.getTouchCenterPageX(this, event);
    }

    private getActiveTouchCount(event: ControllerPointerEvent): number {
        return controllerSeek.getActiveTouchCount(this, event);
    }

    private tryStartPinchZoom(event: ControllerPointerEvent, seekWrap: HTMLElement | null): boolean {
        return controllerSeek.tryStartPinchZoom(this, event, seekWrap);
    }

    private updatePinchZoom(event: ControllerPointerEvent): boolean {
        return controllerSeek.updatePinchZoom(this, event);
    }

    private endPinchZoom(): void {
        return controllerSeek.endPinchZoom(this);
    }

    private trackIndexFromTarget(target: EventTarget | null): number {
        return controllerSeek.trackIndexFromTarget(this, target);
    }

    private isAlignmentMode(): boolean {
        return controllerAlignment.isAlignmentMode(this);
    }

    private hasSyncedVariant(runtime: TrackRuntime): boolean {
        return controllerAlignment.hasSyncedVariant(this, runtime);
    }

    private isTrackSyncLocked(trackIndex: number): boolean {
        return controllerAlignment.isTrackSyncLocked(this, trackIndex);
    }

    private setEffectiveSoloMode(singleSoloMode: boolean): void {
        return controllerAlignment.setEffectiveSoloMode(this, singleSoloMode);
    }

    private toggleGlobalSync(): void {
        return controllerAlignment.toggleGlobalSync(this);
    }

    private applyGlobalSyncState(syncOn: boolean): void {
        return controllerAlignment.applyGlobalSyncState(this, syncOn);
    }

    private setRuntimeActiveVariant(runtime: TrackRuntime, variant: TrackSourceVariant): boolean {
        return controllerAlignment.setRuntimeActiveVariant(this, runtime, variant);
    }

    private shouldBypassAlignmentMapping(trackIndex: number): boolean {
        return controllerAlignment.shouldBypassAlignmentMapping(this, trackIndex);
    }

    private applyTrackProperties(): void {
        return controllerUi.applyTrackProperties(this);
    }

    private updateMainControls(): void {
        return controllerUi.updateMainControls(this);
    }

    private async initializeSheetMusic(): Promise<void> {
        return controllerPlayback.initializeSheetMusic(this);
    }

    private dispatch(action: PlayerAction): void {
        return controllerPlayback.dispatch(this, action);
    }

    private pauseOthers(): void {
        return controllerPlayback.pauseOthers(this);
    }

    private startAudio(newPosition?: number, snippetDuration?: number): void {
        return controllerPlayback.startAudio(this, newPosition, snippetDuration);
    }

    private stopAudio(): void {
        return controllerPlayback.stopAudio(this);
    }

    private monitorPosition(): void {
        return controllerPlayback.monitorPosition(this);
    }

    private seekFromEvent(event: ControllerPointerEvent, usePreviewSnippet = true): void {
        return controllerPlayback.seekFromEvent(this, event, usePreviewSnippet);
    }

    private findLongestDuration(): number {
        return controllerPlayback.findLongestDuration(this);
    }

    private static getRuntimeDuration(runtime: TrackRuntime): number {
        return runtime.timing
            ? runtime.timing.effectiveDuration
            : (runtime.buffer ? runtime.buffer.duration : 0);
    }

    private async initializeAlignmentMode(): Promise<string | null> {
        return controllerAlignment.initializeAlignmentMode(this);
    }

    private async buildAlignmentContext(): Promise<AlignmentContext | string> {
        return controllerAlignment.buildAlignmentContext(this);
    }

    private collectUniqueAlignmentColumns(mappingByTrack: Map<number, string>): string[] {
        return controllerAlignment.collectUniqueAlignmentColumns(this, mappingByTrack);
    }

    private getWarpingMatrixContext(): WarpingMatrixRenderContext | undefined {
        return controllerAlignment.getWarpingMatrixContext(this);
    }

    private getAudibleTrackIndexesForWarpingMatrix(): number[] {
        return controllerAlignment.getAudibleTrackIndexesForWarpingMatrix(this);
    }

    private resolveReferenceColumn(config: TrackAlignmentConfig): string | null {
        return controllerAlignment.resolveReferenceColumn(this, config);
    }

    private resolveReferenceDuration(rows: Array<Record<string, number>>, referenceColumn: string): number | string {
        return controllerAlignment.resolveReferenceDuration(this, rows, referenceColumn);
    }

    private resolveAlignmentMappingsByTrack(config: TrackAlignmentConfig): Map<number, string> | string {
        return controllerAlignment.resolveAlignmentMappingsByTrack(this, config);
    }

    private validateAndBuildLegacyAlignmentMappings(config: TrackAlignmentConfig): Map<number, string> | string {
        return controllerAlignment.validateAndBuildLegacyAlignmentMappings(this, config);
    }

    private getActiveSoloTrackIndex(): number {
        return controllerAlignment.getActiveSoloTrackIndex(this);
    }

    private currentPlaybackReferencePosition(): number {
        return controllerAlignment.currentPlaybackReferencePosition(this);
    }

    private isFixedWaveformLocalAxisEnabled(): boolean {
        return controllerSeek.isFixedWaveformLocalAxisEnabled(this);
    }

    private getSeekTimelineContext(seekingElement: HTMLElement | null): SeekTimelineContext {
        return controllerSeek.getSeekTimelineContext(this, seekingElement);
    }

    private getWaveformTimelineContext(): WaveformTimelineContext {
        return controllerSeek.getWaveformTimelineContext(this);
    }

    private getWaveformTimelineProjector(): TrackTimelineProjector | undefined {
        return controllerSeek.getWaveformTimelineProjector(this);
    }

    private referenceToTrackTime(trackIndex: number, referenceTime: number): number {
        return controllerAlignment.referenceToTrackTime(this, trackIndex, referenceTime);
    }

    private trackToReferenceTime(trackIndex: number, trackTime: number): number {
        return controllerAlignment.trackToReferenceTime(this, trackIndex, trackTime);
    }

    private handleAlignmentTrackSwitch(nextActiveTrackIndex: number): void {
        return controllerAlignment.handleAlignmentTrackSwitch(this, nextActiveTrackIndex);
    }

    private emit<K extends TrackSwitchEventName>(eventName: K, payload: TrackSwitchEventMap[K]): void {
        return controllerEvents.emit(this, eventName, payload);
    }

    private handleError(message: string): void {
        return controllerPlayback.handleError(this, message);
    }
}
