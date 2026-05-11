import {
	AudioDownloadSizeInfo,
	LoopMarker,
	NormalizedTrackSwitchConfig,
	PlayerState,
	TrackSourceVariant,
	TrackRuntime,
	TrackSwitchController,
	TrackSwitchEventHandler,
	TrackSwitchEventMap,
	TrackSwitchEventName,
	TrackSwitchFeatures,
	TrackSwitchInit,
	TrackSwitchSnapshot,
} from "../domain/types";
import { normalizeFeatures } from "../domain/options";
import { createInitialPlayerState, PlayerAction } from "../domain/state";
import { createTrackRuntime } from "../domain/runtime";
import { AudioEngine } from "../engine/audio-engine";
import { SheetMusicEngine } from "../engine/sheet-music-engine";
import type { SheetMusicMeasureMapsByAxis } from "../engine/sheet-music/types";
import {
	TrackTimelineProjector,
	WaveformEngine,
} from "../engine/waveform-engine";
import {
	ViewRenderer,
	WarpingMatrixRenderContext,
	WaveformTimelineContext,
} from "../ui/view-renderer";
import { InputBinder, InputController } from "../input/dom-event-binder";
import { derivePresetNames } from "../shared/preset";
import { ControllerPointerEvent } from "../shared/seek";
import { allocateInstanceId, registerController } from "./player-registry";

import * as controllerPlayback from "./playback-actions";
import * as controllerInput from "./input-actions";
import * as controllerSeek from "./seek-actions";
import * as controllerUi from "./ui-sync";
import * as controllerEvents from "./event-emitter";
import * as controllerHotReload from "./hot-reload-actions";

type AlignmentReferenceAxisKey = "base" | "sync";

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

interface WaveformMinimapDragState {
	seekWrap: HTMLElement;
	minimapNode: HTMLElement;
	pointerOffsetRatio: number;
}

export class TrackSwitchControllerImpl
	implements TrackSwitchController, InputController
{
	public readonly root: HTMLElement;
	public readonly variant: NormalizedTrackSwitchConfig["variant"];
	public readonly features: TrackSwitchFeatures;
	public readonly audioEngine: AudioEngine;
	public readonly waveformEngine: WaveformEngine;
	public readonly sheetMusicEngine: SheetMusicEngine;
	public readonly renderer: ViewRenderer;
	public readonly inputBinder: InputBinder;
	public alignmentConfig: NormalizedTrackSwitchConfig["alignment"];
	public alignmentCsvRequest: Promise<unknown> | null = null;

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
	public waveformMinimapDragState: WaveformMinimapDragState | null = null;
	public waveformRenderFrameId: number | null = null;
	public readonly loopMinDistance = 0.1;
	public readonly touchSeekMoveThresholdPx = 10;

	public iOSPlaybackUnlocked = false;
	public alignmentContext: unknown | null = null;
	public alignmentPlaybackTrackIndex: number | null = null;
	public globalSyncEnabled = false;
	public effectiveSingleSoloMode = false;
	public readonly syncLockedTrackIndexes = new Set<number>();
	public preSyncSoloTrackIndex: number | null = null;

	public readonly listeners: Record<
		TrackSwitchEventName,
		Set<(payload: unknown) => void>
	> = {
		loaded: new Set(),
		error: new Set(),
		position: new Set(),
		trackState: new Set(),
	};

	public readonly eventNamespace: string;
	public readonly instanceId: number;
	public presetCount: number;
	public shortcutHelpOpen = false;
	public audioDownloadSizeInfo: AudioDownloadSizeInfo = {
		status: "calculating",
		totalBytes: null,
		resolvedSourceCount: 0,
		totalSourceCount: 0,
	};
	public audioDownloadSizeRequest: Promise<void> | null = null;

	constructor(rootElement: HTMLElement, config: NormalizedTrackSwitchConfig) {
		this.root = rootElement;
		this.variant = config.variant;
		this.alignmentConfig = config.alignment;
		this.features = normalizeFeatures(config.features);
		if (this.variant === "alignment") {
			this.features.exclusiveSolo = true;
			this.features.presets = false;
		}
		this.effectiveSingleSoloMode =
			this.variant === "alignment" ? true : this.features.exclusiveSolo;
		this.state = createInitialPlayerState(this.features.repeat);

		this.runtimes = config.tracks.map(function (track, index) {
			return createTrackRuntime(track, index);
		});

		const hasAnySelectedTrack = this.runtimes.some(function (runtime) {
			return runtime.state.solo;
		});
		if (!hasAnySelectedTrack && this.runtimes.length > 0) {
			if (this.features.exclusiveSolo) {
				this.runtimes[0].state.solo = true;
			} else {
				const hasExplicitSoloConfiguration = config.tracks.some(
					function (track) {
						return typeof track.solo === "boolean";
					},
				);

				if (!hasExplicitSoloConfiguration) {
					this.runtimes.forEach(function (runtime) {
						runtime.state.solo = true;
					});
				}
			}
		}

		const presetNames = !this.features.presets ? [] : derivePresetNames(config);
		this.presetCount = presetNames.length;

		this.audioEngine = new AudioEngine(
			this.features,
			this.state.volume,
			this.isAlignmentMode(),
		);
		this.waveformEngine = new WaveformEngine();
		this.sheetMusicEngine = new SheetMusicEngine((referenceTime) => {
			this.seekTo(referenceTime);
		});
		this.renderer = this.createRenderer(
			this.root,
			this.features,
			presetNames,
			config.trackGroups,
		);

		this.instanceId = allocateInstanceId();

		this.eventNamespace = ".trackswitch." + this.instanceId;

		this.renderer.initialize(this.runtimes);
		this.renderer.drawDummyWaveforms(this.waveformEngine);

		this.inputBinder = new InputBinder(this.root, this.features, this);
		this.inputBinder.bind();
		this.prefetchAudioDownloadSize();

		if (this.presetCount > 0) {
			this.applyPreset(0);
		} else {
			this.applyTrackProperties();
		}
		this.updateMainControls();

		if (this.runtimes.length === 0) {
			this.handleError("No tracks available.");
		}

		registerController(this);
	}

	protected createRenderer(
		root: HTMLElement,
		features: TrackSwitchFeatures,
		presetNames: string[],
		trackGroups: NormalizedTrackSwitchConfig["trackGroups"],
	): ViewRenderer {
		return new ViewRenderer(
			root,
			features,
			presetNames,
			trackGroups,
			(referenceTime) => {
				this.seekTo(referenceTime);
			},
			(referenceTime) => {
				return this.sheetMusicEngine.resolveReferenceBpm(referenceTime);
			},
		);
	}

	async load(): Promise<void> {
		return controllerPlayback.load(this);
	}

	async updateInit(nextInit: TrackSwitchInit): Promise<void> {
		return controllerHotReload.updateInit(this, nextInit);
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

	on<K extends TrackSwitchEventName>(
		eventName: K,
		handler: TrackSwitchEventHandler<K>,
	): () => void {
		return controllerEvents.on(this, eventName, handler);
	}

	off<K extends TrackSwitchEventName>(
		eventName: K,
		handler: TrackSwitchEventHandler<K>,
	): void {
		return controllerEvents.off(this, eventName, handler);
	}

	setKeyboardActive(): void {
		return controllerInput.setKeyboardActive(this);
	}

	openShortcutHelp(): void {
		return controllerInput.openShortcutHelp(this);
	}

	toggleShortcutHelp(): void {
		return controllerInput.toggleShortcutHelp(this);
	}

	closeShortcutHelp(): void {
		return controllerInput.closeShortcutHelp(this);
	}

	onOverlayActivate(event: ControllerPointerEvent): void {
		return controllerInput.onOverlayActivate(this, event);
	}

	onOverlayInfo(event: ControllerPointerEvent): void {
		return controllerInput.onOverlayInfo(this, event);
	}

	onShortcutHelpOverlay(event: ControllerPointerEvent): void {
		return controllerInput.onShortcutHelpOverlay(this, event);
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

	onTrackRowToggle(event: ControllerPointerEvent): void {
		return controllerInput.onTrackRowToggle(this, event);
	}

	onAlignmentSync(event: ControllerPointerEvent): void {
		return controllerInput.onAlignmentSync(this, event);
	}

	onVolume(event: ControllerPointerEvent): void {
		return controllerInput.onVolume(this, event);
	}

	onVolumeReset(event: ControllerPointerEvent): void {
		return controllerInput.onVolumeReset(this, event);
	}

	onTrackVolume(event: ControllerPointerEvent): void {
		return controllerInput.onTrackVolume(this, event);
	}

	onTrackVolumeReset(event: ControllerPointerEvent): void {
		return controllerInput.onTrackVolumeReset(this, event);
	}

	onTrackPan(event: ControllerPointerEvent): void {
		return controllerInput.onTrackPan(this, event);
	}

	onTrackPanReset(event: ControllerPointerEvent): void {
		return controllerInput.onTrackPanReset(this, event);
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

	onWaveformMinimapStart(event: ControllerPointerEvent): void {
		return controllerInput.onWaveformMinimapStart(this, event);
	}

	onPanelReorderStart(event: ControllerPointerEvent): void {
		if (!this.features.customizablePanelOrder) {
			return;
		}

		this.renderer.startPanelReorder(event);
	}

	onPanelReorderMove(event: ControllerPointerEvent): void {
		if (!this.features.customizablePanelOrder) {
			return;
		}

		this.renderer.movePanelReorder(event);
	}

	onPanelReorderEnd(event: ControllerPointerEvent): void {
		if (!this.features.customizablePanelOrder) {
			return;
		}

		this.renderer.endPanelReorder(event);
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

	public prefetchAudioDownloadSize(): Promise<void> {
		if (this.audioDownloadSizeRequest) {
			return this.audioDownloadSizeRequest;
		}

		this.audioDownloadSizeRequest = this.audioEngine
			.estimateAudioDownloadSize(this.runtimes)
			.then((info) => {
				if (this.isDestroyed) {
					return;
				}

				this.audioDownloadSizeInfo = info;
				this.renderer.updateOverlayDownloadInfo(info);
			})
			.catch(() => {
				if (this.isDestroyed) {
					return;
				}

				this.audioDownloadSizeInfo = {
					status: "unavailable",
					totalBytes: null,
					resolvedSourceCount: 0,
					totalSourceCount: 0,
				};
				this.renderer.updateOverlayDownloadInfo(this.audioDownloadSizeInfo);
			});

		return this.audioDownloadSizeRequest;
	}

	public requestWaveformRender(): void {
		return controllerSeek.requestWaveformRender(this);
	}

	public isWaveformSeekSurface(seekWrap: HTMLElement | null): boolean {
		return controllerSeek.isWaveformSeekSurface(this, seekWrap);
	}

	public startInteractiveSeek(
		event: ControllerPointerEvent,
		seekWrap: HTMLElement,
	): void {
		return controllerSeek.startInteractiveSeek(this, event, seekWrap);
	}

	public disableLoopWhenSeekOutsideRegion(): void {
		return controllerSeek.disableLoopWhenSeekOutsideRegion(this);
	}

	public tryStartPendingWaveformTouchSeek(
		event: ControllerPointerEvent,
		seekWrap: HTMLElement | null,
	): boolean {
		return controllerSeek.tryStartPendingWaveformTouchSeek(
			this,
			event,
			seekWrap,
		);
	}

	public tryActivatePendingWaveformTouchSeek(
		event: ControllerPointerEvent,
	): boolean {
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

	public tryStartPinchZoom(
		event: ControllerPointerEvent,
		seekWrap: HTMLElement | null,
	): boolean {
		return controllerSeek.tryStartPinchZoom(this, event, seekWrap);
	}

	public updateWaveformMinimapDrag(event: ControllerPointerEvent): boolean {
		return controllerSeek.updateWaveformMinimapDrag(this, event);
	}

	public endWaveformMinimapDrag(): void {
		return controllerSeek.endWaveformMinimapDrag(this);
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
		return false;
	}

	public hasSyncedVariant(runtime: TrackRuntime): boolean {
		return !!runtime.syncedSource && !!runtime.syncedSource.buffer;
	}

	public isTrackSyncLocked(trackIndex: number): boolean {
		void trackIndex;
		return false;
	}

	public setEffectiveSoloMode(singleSoloMode: boolean): void {
		this.effectiveSingleSoloMode = singleSoloMode;

		if (!singleSoloMode || this.runtimes.length === 0) {
			return;
		}

		const previousSoloIndex = this.getActiveSoloTrackIndex();
		const targetSoloIndex = previousSoloIndex >= 0 ? previousSoloIndex : 0;

		this.runtimes.forEach(function (runtime, index) {
			runtime.state.solo = index === targetSoloIndex;
		});
	}

	public toggleGlobalSync(): void {
		return;
	}

	public applyGlobalSyncState(syncOn: boolean): void {
		void syncOn;
	}

	public setRuntimeActiveVariant(
		runtime: TrackRuntime,
		variant: TrackSourceVariant,
	): boolean {
		const source =
			variant === "synced" ? runtime.syncedSource : runtime.baseSource;
		if (!source || !source.buffer) {
			return false;
		}

		runtime.activeVariant = variant;
		runtime.buffer = source.buffer;
		runtime.timing = source.timing;
		runtime.sourceIndex = source.sourceIndex;
		runtime.waveformSummary = source.waveformSummary;
		return true;
	}

	public shouldBypassAlignmentMapping(trackIndex: number): boolean {
		void trackIndex;
		return false;
	}

	public applyTrackProperties(): void {
		return controllerUi.applyTrackProperties(this);
	}

	public updateMainControls(): void {
		return controllerUi.updateMainControls(this);
	}

	public updatePlaybackPositionUi(): void {
		return controllerUi.updatePlaybackPositionUi(this);
	}

	public async initializeSheetMusic(): Promise<void> {
		return controllerPlayback.initializeSheetMusic(this);
	}

	public buildSheetMusicMeasureMaps(
		measureColumn: string,
		source: string,
	): Promise<SheetMusicMeasureMapsByAxis> {
		void source;
		if (measureColumn) {
			return Promise.reject(
				new Error(
					"Sheet music measure sync requires the alignment player variant.",
				),
			);
		}

		return Promise.resolve({
			base: null,
			sync: null,
		});
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

	public seekFromEvent(
		event: ControllerPointerEvent,
		usePreviewSnippet = true,
	): void {
		return controllerPlayback.seekFromEvent(this, event, usePreviewSnippet);
	}

	public findLongestDuration(): number {
		return controllerPlayback.findLongestDuration(this);
	}

	public static getRuntimeDuration(runtime: TrackRuntime): number {
		return runtime.timing
			? runtime.timing.effectiveDuration
			: runtime.buffer
				? runtime.buffer.duration
				: 0;
	}

	public async initializeAlignmentMode(): Promise<string | null> {
		return "Alignment mode requires the alignment player variant.";
	}

	public async buildAlignmentContext(): Promise<unknown | string> {
		return "Alignment mode requires the alignment player variant.";
	}

	public loadAlignmentCsv(): Promise<unknown> {
		return Promise.reject(
			new Error("Alignment mode requires the alignment player variant."),
		);
	}

	public collectUniqueAlignmentColumns(
		mappingByTrack: Map<number, string>,
	): string[] {
		const seenColumns = new Set<string>();
		const uniqueColumns: string[] = [];

		for (const [, rawColumn] of mappingByTrack) {
			const column = String(rawColumn || "").trim();
			if (!column || seenColumns.has(column)) {
				continue;
			}

			seenColumns.add(column);
			uniqueColumns.push(column);
		}

		return uniqueColumns;
	}

	public getWarpingMatrixContext(): WarpingMatrixRenderContext | undefined {
		return undefined;
	}

	public getAudibleTrackIndexesForWarpingMatrix(): number[] {
		return this.runtimes.map(function (_runtime, index) {
			return index;
		});
	}

	public resolveReferenceTimeColumn(config: {
		referenceTimeColumn?: string;
	}): string | null {
		const configuredReferenceTimeColumn =
			typeof config.referenceTimeColumn === "string"
				? config.referenceTimeColumn.trim()
				: "";

		return configuredReferenceTimeColumn || null;
	}

	public resolveReferenceTimeColumnSync(config: {
		referenceTimeColumnSync?: string;
	}): string | null {
		const configuredReferenceTimeColumnSync =
			typeof config.referenceTimeColumnSync === "string"
				? config.referenceTimeColumnSync.trim()
				: "";

		return configuredReferenceTimeColumnSync || null;
	}

	public resolveReferenceDuration(
		rows: Array<Record<string, number>>,
		referenceTimeColumn: string,
	): number | string {
		let maxReference = Number.NEGATIVE_INFINITY;

		rows.forEach(function (row: Record<string, unknown>) {
			const value = Number(row[referenceTimeColumn]);
			if (Number.isFinite(value) && value > maxReference) {
				maxReference = value;
			}
		});

		if (!Number.isFinite(maxReference)) {
			return (
				"Alignment CSV does not contain valid numeric values for referenceTimeColumn: " +
				referenceTimeColumn
			);
		}

		return Math.max(0, maxReference);
	}

	public resolveAlignmentMappingsByTrack(
		_config: unknown,
	): Map<number, string> | string {
		return "Alignment mode requires the alignment player variant.";
	}

	public getActiveSoloTrackIndex(): number {
		for (let index = 0; index < this.runtimes.length; index += 1) {
			if (this.runtimes[index].state.solo) {
				return index;
			}
		}

		if (this.effectiveSingleSoloMode && this.runtimes.length > 0) {
			return 0;
		}

		return -1;
	}

	public getActiveAlignmentAxisKey(): AlignmentReferenceAxisKey {
		return "base";
	}

	public isSyncReferenceAxisActive(): boolean {
		return false;
	}

	public isGlobalSyncAvailable(): boolean {
		return false;
	}

	public mapAlignmentAxisTime(
		time: number,
		fromAxisKey: AlignmentReferenceAxisKey,
		toAxisKey: AlignmentReferenceAxisKey,
	): number {
		void fromAxisKey;
		void toAxisKey;
		return Number.isFinite(time) ? time : 0;
	}

	public getAlignmentPlaybackTrackIndex(): number {
		return -1;
	}

	public currentPlaybackReferencePosition(): number {
		return this.audioEngine.currentTime - this.state.startTime;
	}

	public isFixedWaveformLocalAxisEnabled(): boolean {
		return controllerSeek.isFixedWaveformLocalAxisEnabled(this);
	}

	public getSeekTimelineContext(
		seekingElement: HTMLElement | null,
	): SeekTimelineContext {
		return controllerSeek.getSeekTimelineContext(this, seekingElement);
	}

	public getWaveformTimelineContext(): WaveformTimelineContext {
		return controllerSeek.getWaveformTimelineContext(this);
	}

	public getWaveformTimelineProjector(): TrackTimelineProjector | undefined {
		return controllerSeek.getWaveformTimelineProjector(this);
	}

	public referenceToTrackTime(
		trackIndex: number,
		referenceTime: number,
	): number {
		void trackIndex;
		return referenceTime;
	}

	public trackToReferenceTime(trackIndex: number, trackTime: number): number {
		void trackIndex;
		return trackTime;
	}

	public handleAlignmentTrackSwitch(nextActiveTrackIndex: number): void {
		void nextActiveTrackIndex;
	}

	public emit<K extends TrackSwitchEventName>(
		eventName: K,
		payload: TrackSwitchEventMap[K],
	): void {
		return controllerEvents.emit(this, eventName, payload);
	}

	public handleError(message: string): void {
		return controllerPlayback.handleError(this, message);
	}
}
