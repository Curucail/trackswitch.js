import type { ViewNormalizeContext } from "../config/ui-elements";
import { normalizeFeatures } from "../domain/options";
import { createTrackRuntime } from "../domain/runtime";
import { createInitialPlayerState, type PlayerAction } from "../domain/state";
import type {
	AlignmentConfig,
	AudioDownloadSizeInfo,
	LoopMarker,
	MarkersConfig,
	MediaConfig,
	NormalizedTrackSwitchConfig,
	PlayerState,
	PresetsConfig,
	ResolvedAlignment,
	ResolvedMarkerSet,
	TrackListGroup,
	TrackRuntime,
	TrackSourceVariant,
	TrackSwitchController,
	TrackSwitchEventHandler,
	TrackSwitchEventMap,
	TrackSwitchEventName,
	TrackSwitchFeatures,
	TrackSwitchInit,
	TrackSwitchNavigationBarViewConfig,
	TrackSwitchSnapshot,
	TrackSwitchWarpingMatrixViewConfig,
} from "../domain/types";
import { AudioEngine } from "../engine/audio-engine";
import type { SheetMusicMeasureMapsByAxis } from "../engine/sheet-music/types";
import { SheetMusicEngine } from "../engine/sheet-music-engine";
import {
	type TrackTimelineProjector,
	WaveformEngine,
} from "../engine/waveform-engine";
import { InputBinder, type InputController } from "../input/dom-event-binder";
import type { MeasureMapPoint } from "../shared/measure-map";
import type { ControllerPointerEvent } from "../shared/seek";
import {
	createRuntimeMarkerSet,
	type RuntimeMarkerSet,
} from "../timeline/marker";
import { IMPLICIT_REFERENCE_TIMELINE, timelineId } from "../timeline/timeline";
import {
	ViewRenderer,
	type WarpingMatrixRenderContext,
	type WaveformTimelineContext,
} from "../ui/view-renderer";
import * as controllerAlignment from "./alignment-actions";
import * as controllerEvents from "./event-emitter";
import * as controllerHotReload from "./hot-reload-actions";
import * as controllerInput from "./input-actions";
import * as controllerMarkers from "./marker-actions";
import * as controllerPlayback from "./playback-actions";
import { allocateInstanceId, registerController } from "./player-registry";
import * as controllerSeek from "./seek-actions";
import * as controllerUi from "./ui-sync";

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
	public readonly features: TrackSwitchFeatures;
	public readonly audioEngine: AudioEngine;
	public readonly waveformEngine: WaveformEngine;
	public readonly sheetMusicEngine: SheetMusicEngine;
	public readonly renderer: ViewRenderer;
	public readonly inputBinder: InputBinder;
	public alignmentConfig: AlignmentConfig | undefined;
	public markersConfig: MarkersConfig;
	public media: MediaConfig;
	public presets: PresetsConfig;
	public navigationBar: TrackSwitchNavigationBarViewConfig | null;
	public readonly warpingMatrixView: TrackSwitchWarpingMatrixViewConfig | null;

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
	public alignment: ResolvedAlignment | null = null;
	public markerSets: Map<string, ResolvedMarkerSet> = new Map();
	public runtimeMarkers: RuntimeMarkerSet;
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
	public shortcutHelpOpen = false;
	public markerNavigationDialogOpen = false;
	public audioDownloadSizeInfo: AudioDownloadSizeInfo = {
		status: "calculating",
		totalBytes: null,
		resolvedSourceCount: 0,
		totalSourceCount: 0,
	};
	public audioDownloadSizeRequest: Promise<void> | null = null;

	constructor(rootElement: HTMLElement, config: NormalizedTrackSwitchConfig) {
		this.root = rootElement;
		this.alignmentConfig = config.alignment;
		this.media = config.media;
		this.markersConfig = config.markers;
		this.presets = config.presets;
		this.navigationBar =
			config.views.find((view) => view.type === "navigationBar") ?? null;
		this.warpingMatrixView =
			(config.views.find((view) => view.type === "warpingMatrix") as
				| TrackSwitchWarpingMatrixViewConfig
				| undefined) ?? null;
		this.features = normalizeFeatures(config.features);
		if (this.alignmentConfig) {
			this.features.exclusiveSolo = true;
		}
		this.effectiveSingleSoloMode = this.features.exclusiveSolo;
		this.state = createInitialPlayerState(!!this.navigationBar?.repeat);
		this.runtimeMarkers = createRuntimeMarkerSet(IMPLICIT_REFERENCE_TIMELINE);

		this.runtimes = config.tracks.map((track, index) =>
			createTrackRuntime(track, index),
		);

		const hasAnySelectedTrack = this.runtimes.some(
			(runtime) => runtime.state.solo,
		);
		if (!hasAnySelectedTrack && this.runtimes.length > 0) {
			if (this.features.exclusiveSolo) {
				this.runtimes[0].state.solo = true;
			} else {
				const hasExplicitSoloConfiguration = config.tracks.some(
					(track) => typeof track.solo === "boolean",
				);

				if (!hasExplicitSoloConfiguration) {
					this.runtimes.forEach((runtime) => {
						runtime.state.solo = true;
					});
				}
			}
		}

		const presetEntries = Object.entries(this.presets).map(([id, preset]) => ({
			id,
			label: preset.label ?? id,
		}));

		this.audioEngine = new AudioEngine(
			this.features,
			this.state.volume,
			!!this.alignmentConfig,
			!!this.navigationBar?.globalVolume,
		);
		this.waveformEngine = new WaveformEngine();
		this.sheetMusicEngine = new SheetMusicEngine((referenceTime) => {
			this.seekTo(referenceTime);
		});
		this.renderer = new ViewRenderer(
			this.root,
			this.features,
			presetEntries,
			this.buildTrackGroups(config),
			(referenceTime) => {
				this.seekTo(referenceTime);
			},
			(referenceTime) =>
				this.sheetMusicEngine.resolveReferenceBpm(referenceTime),
		);
		if (config.alignment) {
			this.renderer.setReferenceTimelineUnit(
				config.media[config.alignment.referenceTimeline]?.type === "musicxml"
					? "measure"
					: "seconds",
			);
		}
		this.renderer.hasAlignment = !!this.alignmentConfig;
		const viewContext: ViewNormalizeContext = {
			media: config.media,
			trackIds: config.tracks.map((track) => track.id),
			markerSetIds: new Set(Object.keys(config.markers)),
			hasAlignment: !!config.alignment,
			alignmentTimelines: new Set(
				config.alignment ? Object.keys(config.alignment.timelines) : [],
			),
		};
		this.renderer.renderViews(config.views, viewContext);

		this.instanceId = allocateInstanceId();
		this.eventNamespace = ".trackswitch." + this.instanceId;

		this.renderer.initialize(this.runtimes);
		this.renderer.drawDummyWaveforms(this.waveformEngine);

		this.inputBinder = new InputBinder(this.root, this.features, this);
		this.inputBinder.bind();
		this.prefetchAudioDownloadSize();

		const firstPresetId = Object.keys(this.presets)[0];
		if (firstPresetId) {
			this.applyPreset(firstPresetId);
		} else {
			this.applyTrackProperties();
		}
		this.updateMainControls();
		this.renderer.drawDummyWarpingMatrices();

		if (this.runtimes.length === 0) {
			this.handleError("No tracks available.");
		}

		registerController(this);
	}

	private buildTrackGroups(
		config: NormalizedTrackSwitchConfig,
	): TrackListGroup[] {
		let groupIndex = 0;
		const groups: TrackListGroup[] = [];
		config.views.forEach((view) => {
			if (view.type !== "trackList") {
				return;
			}
			groups.push({
				groupIndex: groupIndex,
				trackIds: view.tracks,
				rowHeight: view.rowHeight,
				trackVolumeControls: !!view.trackVolumeControls,
				trackPanControls: !!view.trackPanControls,
			});
			groupIndex += 1;
		});
		return groups;
	}

	async load(): Promise<void> {
		return controllerPlayback.load(this);
	}

	async updateConfig(nextConfig: TrackSwitchInit): Promise<void> {
		return controllerHotReload.updateConfig(this, nextConfig);
	}

	destroy(): void {
		controllerPlayback.destroy(this);
	}

	togglePlay(): void {
		controllerPlayback.togglePlay(this);
	}

	play(): void {
		controllerPlayback.play(this);
	}

	pause(): void {
		controllerPlayback.pause(this);
	}

	stop(): void {
		controllerPlayback.stop(this);
	}

	seekTo(seconds: number): void {
		controllerPlayback.seekTo(this, seconds);
	}

	seekRelative(seconds: number): void {
		controllerPlayback.seekRelative(this, seconds);
	}

	setRepeat(enabled: boolean): void {
		controllerPlayback.setRepeat(this, enabled);
	}

	setVolume(volumeZeroToOne: number): void {
		controllerPlayback.setVolume(this, volumeZeroToOne);
	}

	setTrackVolume(trackIndex: number, volumeZeroToOne: number): void {
		controllerPlayback.setTrackVolume(this, trackIndex, volumeZeroToOne);
	}

	setTrackPan(trackIndex: number, panMinusOneToOne: number): void {
		controllerPlayback.setTrackPan(this, trackIndex, panMinusOneToOne);
	}

	setLoopPoint(marker: LoopMarker): boolean {
		return controllerPlayback.setLoopPoint(this, marker);
	}

	toggleLoop(): boolean {
		return controllerPlayback.toggleLoop(this);
	}

	clearLoop(): void {
		controllerPlayback.clearLoop(this);
	}

	toggleSolo(trackIndex: number, exclusive = false): void {
		controllerPlayback.toggleSolo(this, trackIndex, exclusive);
	}

	applyPreset(presetId: string): void {
		controllerPlayback.applyPreset(this, presetId);
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
		controllerEvents.off(this, eventName, handler);
	}

	setKeyboardActive(): void {
		controllerInput.setKeyboardActive(this);
	}

	openShortcutHelp(): void {
		controllerInput.openShortcutHelp(this);
	}

	toggleShortcutHelp(): void {
		controllerInput.toggleShortcutHelp(this);
	}

	closeShortcutHelp(): void {
		controllerInput.closeShortcutHelp(this);
	}

	onOverlayActivate(event: ControllerPointerEvent): void {
		controllerInput.onOverlayActivate(this, event);
	}

	onShortcutHelpOverlay(event: ControllerPointerEvent): void {
		controllerInput.onShortcutHelpOverlay(this, event);
	}

	onPlayPause(event: ControllerPointerEvent): void {
		controllerInput.onPlayPause(this, event);
	}

	onStop(event: ControllerPointerEvent): void {
		controllerInput.onStop(this, event);
	}

	onRepeat(event: ControllerPointerEvent): void {
		controllerInput.onRepeat(this, event);
	}

	onTimelineMarkerActivate(event: ControllerPointerEvent): void {
		controllerInput.onTimelineMarkerActivate(this, event);
	}

	onTimelineMarkerKeydown(event: ControllerPointerEvent): void {
		controllerInput.onTimelineMarkerKeydown(this, event);
	}

	onAdjacentMarker(
		event: ControllerPointerEvent,
		direction: "previous" | "next",
	): void {
		controllerInput.onAdjacentMarker(this, event, direction);
	}

	onMarkerNavigationOpen(event: ControllerPointerEvent): void {
		controllerInput.onMarkerNavigationOpen(this, event);
	}

	onMarkerNavigationOverlay(event: ControllerPointerEvent): void {
		controllerInput.onMarkerNavigationOverlay(this, event);
	}

	onMarkerNavigationInput(event: ControllerPointerEvent): void {
		controllerInput.onMarkerNavigationInput(this, event);
	}

	onMarkerNavigationSubmit(event: ControllerPointerEvent): void {
		controllerInput.onMarkerNavigationSubmit(this, event);
	}

	onMarkerNavigationKeydown(event: ControllerPointerEvent): void {
		controllerInput.onMarkerNavigationKeydown(this, event);
	}

	onSeekStart(event: ControllerPointerEvent): void {
		controllerInput.onSeekStart(this, event);
	}

	onSeekMove(event: ControllerPointerEvent): void {
		controllerSeek.onSeekMove(this, event);
	}

	onSeekEnd(event: ControllerPointerEvent): void {
		controllerInput.onSeekEnd(this, event);
	}

	onSolo(event: ControllerPointerEvent): void {
		controllerInput.onSolo(this, event);
	}

	onTrackRowToggle(event: ControllerPointerEvent): void {
		controllerInput.onTrackRowToggle(this, event);
	}

	onAlignmentSync(event: ControllerPointerEvent): void {
		controllerInput.onAlignmentSync(this, event);
	}

	onVolume(event: ControllerPointerEvent): void {
		controllerInput.onVolume(this, event);
	}

	onVolumeReset(event: ControllerPointerEvent): void {
		controllerInput.onVolumeReset(this, event);
	}

	onTrackVolume(event: ControllerPointerEvent): void {
		controllerInput.onTrackVolume(this, event);
	}

	onTrackVolumeReset(event: ControllerPointerEvent): void {
		controllerInput.onTrackVolumeReset(this, event);
	}

	onTrackPan(event: ControllerPointerEvent): void {
		controllerInput.onTrackPan(this, event);
	}

	onTrackPanReset(event: ControllerPointerEvent): void {
		controllerInput.onTrackPanReset(this, event);
	}

	onPreset(event: ControllerPointerEvent): void {
		controllerInput.onPreset(this, event);
	}

	onPresetScroll(event: ControllerPointerEvent): void {
		controllerInput.onPresetScroll(this, event);
	}

	onWaveformZoomWheel(event: ControllerPointerEvent): void {
		controllerSeek.onWaveformZoomWheel(this, event);
	}

	onWaveformMinimapStart(event: ControllerPointerEvent): void {
		controllerInput.onWaveformMinimapStart(this, event);
	}

	onMidiZoomWheel(event: ControllerPointerEvent): void {
		controllerSeek.onMidiZoomWheel(this, event);
	}

	onMidiMinimapStart(event: ControllerPointerEvent): void {
		controllerInput.onMidiMinimapStart(this, event);
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
		controllerInput.onSetLoopA(this, event);
	}

	onSetLoopB(event: ControllerPointerEvent): void {
		controllerInput.onSetLoopB(this, event);
	}

	onToggleLoop(event: ControllerPointerEvent): void {
		controllerInput.onToggleLoop(this, event);
	}

	onClearLoop(event: ControllerPointerEvent): void {
		controllerInput.onClearLoop(this, event);
	}

	onMarkerDragStart(event: ControllerPointerEvent): void {
		controllerInput.onMarkerDragStart(this, event);
	}

	onKeyboard(event: ControllerPointerEvent): void {
		controllerInput.onKeyboard(this, event);
	}

	public getKeyboardTrackIndex(event: ControllerPointerEvent): number | null {
		return controllerInput.getKeyboardTrackIndex(this, event);
	}

	onResize(): void {
		controllerInput.onResize(this);
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
		controllerSeek.requestWaveformRender(this);
	}

	public isWaveformSeekSurface(seekWrap: HTMLElement | null): boolean {
		return controllerSeek.isWaveformSeekSurface(this, seekWrap);
	}

	public isMidiSeekSurface(seekWrap: HTMLElement | null): boolean {
		return controllerSeek.isMidiSeekSurface(this, seekWrap);
	}

	public startInteractiveSeek(
		event: ControllerPointerEvent,
		seekWrap: HTMLElement,
	): void {
		controllerSeek.startInteractiveSeek(this, event, seekWrap);
	}

	public disableLoopWhenSeekOutsideRegion(): void {
		controllerSeek.disableLoopWhenSeekOutsideRegion(this);
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
		controllerSeek.applyPendingWaveformTouchSeekTap(this, event);
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
		controllerSeek.endWaveformMinimapDrag(this);
	}

	public updatePinchZoom(event: ControllerPointerEvent): boolean {
		return controllerSeek.updatePinchZoom(this, event);
	}

	public endPinchZoom(): void {
		controllerSeek.endPinchZoom(this);
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
		controllerAlignment.setEffectiveSoloMode(this, singleSoloMode);
	}

	public toggleGlobalSync(): void {
		controllerAlignment.toggleGlobalSync(this);
	}

	public applyGlobalSyncState(syncOn: boolean): void {
		controllerAlignment.applyGlobalSyncState(this, syncOn);
	}

	public setRuntimeActiveVariant(
		runtime: TrackRuntime,
		variant: TrackSourceVariant,
	): boolean {
		return controllerAlignment.setRuntimeActiveVariant(this, runtime, variant);
	}

	public shouldBypassAlignmentMapping(trackIndex: number): boolean {
		return controllerAlignment.shouldBypassAlignmentMapping(this, trackIndex);
	}

	public applyTrackProperties(): void {
		controllerUi.applyTrackProperties(this);
	}

	public updateMainControls(): void {
		controllerUi.updateMainControls(this);
	}

	public renderMarkerLayers(): void {
		controllerMarkers.renderMarkerLayers(this);
	}

	public synchronizeRuntimeMarkers(): void {
		controllerMarkers.synchronizeRuntimeMarkers(this);
	}

	public updateMarkerNavigation(): void {
		controllerMarkers.updateMarkerNavigation(this);
	}

	public seekToAdjacentMarker(direction: "previous" | "next"): void {
		controllerMarkers.seekToAdjacentMarker(this, direction);
	}

	public updatePlaybackPositionUi(): void {
		controllerUi.updatePlaybackPositionUi(this);
	}

	public async initializeSheetMusic(): Promise<void> {
		return controllerPlayback.initializeSheetMusic(this);
	}

	/** `measureColumn` here is the score's mediaID (see config/ui-elements.ts injectSheetMusic). */
	public buildSheetMusicMeasureMaps(
		measureColumn: string,
		source: string,
	): Promise<SheetMusicMeasureMapsByAxis> {
		void source;
		if (!measureColumn || !this.alignment) {
			return Promise.resolve({ base: null, sync: null });
		}

		const scoreTimeline = timelineId(measureColumn);
		const referenceTimeline = this.alignment.referenceTimeline;
		const points: MeasureMapPoint[] = [];

		for (const marker of this.alignment.markerSet.markers) {
			const start = marker.placements.get(referenceTimeline);
			const measure = marker.placements.get(scoreTimeline);
			if (start !== undefined && measure !== undefined) {
				points.push({ start, measure });
			}
		}

		points.sort((a, b) =>
			a.start === b.start ? a.measure - b.measure : a.start - b.start,
		);

		return Promise.resolve({
			base: points.length > 0 ? points : null,
			sync: null,
		});
	}

	public dispatch(action: PlayerAction): void {
		controllerPlayback.dispatch(this, action);
	}

	public pauseOthers(): void {
		controllerPlayback.pauseOthers(this);
	}

	public startAudio(newPosition?: number, snippetDuration?: number): void {
		controllerPlayback.startAudio(this, newPosition, snippetDuration);
	}

	public stopAudio(): void {
		controllerPlayback.stopAudio(this);
	}

	public monitorPosition(): void {
		controllerPlayback.monitorPosition(this);
	}

	public seekFromEvent(
		event: ControllerPointerEvent,
		usePreviewSnippet = true,
	): void {
		controllerPlayback.seekFromEvent(this, event, usePreviewSnippet);
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
		return controllerAlignment.initializeAlignmentMode(this);
	}

	public getWarpingMatrixContext(): WarpingMatrixRenderContext | undefined {
		return controllerAlignment.getWarpingMatrixContext(this);
	}

	public getAudibleTrackIndexesForWarpingMatrix(): number[] {
		return controllerAlignment.getAudibleTrackIndexesForWarpingMatrix(this);
	}

	public getActiveSoloTrackIndex(): number {
		return controllerAlignment.getActiveSoloTrackIndex(this);
	}

	public isSyncReferenceAxisActive(): boolean {
		return controllerAlignment.isSyncReferenceAxisActive(this);
	}

	public isGlobalSyncAvailable(): boolean {
		return controllerAlignment.isGlobalSyncAvailable(this);
	}

	public getAlignmentPlaybackTrackIndex(): number {
		return controllerAlignment.getAlignmentPlaybackTrackIndex(this);
	}

	public currentPlaybackReferencePosition(): number {
		return controllerAlignment.currentPlaybackReferencePosition(this);
	}

	public isFixedWaveformLocalAxisEnabled(): boolean {
		return controllerSeek.isFixedWaveformLocalAxisEnabled(this);
	}

	public getSeekTimelineContext(
		seekingElement: HTMLElement | null,
	): SeekTimelineContext {
		return controllerSeek.getSeekTimelineContext(this, seekingElement);
	}

	public getMidiTimelineContext(
		midiSurface: unknown,
	): SeekTimelineContext | null {
		return controllerSeek.getMidiTimelineContext(this, midiSurface);
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
		return controllerAlignment.referenceToTrackTime(
			this,
			trackIndex,
			referenceTime,
		);
	}

	public trackToReferenceTime(trackIndex: number, trackTime: number): number {
		return controllerAlignment.trackToReferenceTime(
			this,
			trackIndex,
			trackTime,
		);
	}

	public getTrackAlignmentPoints(
		trackIndex: number,
	): Array<{ referenceTime: number; trackTime: number }> {
		return controllerAlignment.getTrackAlignmentPoints(this, trackIndex);
	}

	public handleAlignmentTrackSwitch(nextActiveTrackIndex: number): void {
		controllerAlignment.handleAlignmentTrackSwitch(this, nextActiveTrackIndex);
	}

	public emit<K extends TrackSwitchEventName>(
		eventName: K,
		payload: TrackSwitchEventMap[K],
	): void {
		controllerEvents.emit(this, eventName, payload);
	}

	public handleError(message: string): void {
		controllerPlayback.handleError(this, message);
	}
}
