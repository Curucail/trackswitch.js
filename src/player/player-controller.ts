import type { ViewNormalizeContext } from "../config/ui-elements";
import {
	applyInitialGroupSolos,
	applyTrackPanAlgorithms,
	buildTrackGroups,
	createTrackRuntime,
	findGroupIndexForTrack,
	resetDisabledTrackVolumeControls,
	resolveGroupTrackIndexes,
	resolveSoloScopeTrackIndexes,
} from "../domain/runtime";
import { createInitialPlayerState, type PlayerAction } from "../domain/state";
import type {
	AlignmentConfig,
	AudioDownloadSizeInfo,
	LoopMarker,
	MarkersConfig,
	MediaConfig,
	NormalizedTrackSwitchConfig,
	PlaybackAnchor,
	PlayerState,
	PresetsConfig,
	ResolvedAlignment,
	ResolvedMarkerSet,
	TrackId,
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
import { isWaveformTrackAudible } from "../shared/waveform-source";
import {
	createRuntimeMarkerSet,
	type RuntimeMarkerSet,
} from "../timeline/marker";
import {
	type MediaProfile,
	resolveTimelineUnit,
} from "../timeline/media-profile";
import {
	IMPLICIT_REFERENCE_TIMELINE,
	type TimelineId,
	timelineId,
} from "../timeline/timeline";
import type { PianoRollSeekSurfaceMetadata } from "../ui/render-piano-roll";
import {
	type ImageSeekSurfaceMetadata,
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
import type { SoloMode, SoloUnit } from "./solo-units";
import * as controllerSolo from "./solo-units";
import * as controllerUi from "./ui-sync";

interface SeekTimelineContext {
	duration: number;
	toReferenceTime(timelineTime: number): number;
	fromReferenceTime(referenceTime: number): number;
	/**
	 * The anchor a position on this surface carries. Absent on a surface that
	 * works in reference coordinates, which has nothing finer to remember.
	 */
	toAnchor?(timelineTime: number): PlaybackAnchor | null;
	/** The current playback position on this surface's own timeline, from the anchor. */
	playbackPosition?(): number | null;
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
	public warpingMatrixView: TrackSwitchWarpingMatrixViewConfig | null;

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
	/**
	 * Unit conversions per medium for a player without an alignment, where there
	 * is no `ResolvedAlignment` to carry them. Empty in alignment mode.
	 */
	public mediaProfiles: ReadonlyMap<TimelineId, MediaProfile> = new Map();
	public markerSets: Map<string, ResolvedMarkerSet> = new Map();
	/** Marker set ids currently rendered somewhere in the configured views — see renderTimelineMarkers. */
	public visibleMarkerSetIds: ReadonlySet<string> = new Set();
	public runtimeMarkers: RuntimeMarkerSet;
	public alignmentPlaybackTrackIndex: number | null = null;
	public globalSyncEnabled = false;
	public trackGroups: TrackListGroup[] = [];
	/** How selections are scoped right now; the playback mode decides it. */
	public soloMode: SoloMode = "lists";
	/** Per trackList unit, the mix it was left with, by group index. */
	public readonly trackListSoloMemory = new Map<number, TrackId[]>();
	public readonly syncLockedTrackIndexes = new Set<number>();
	/** Solo state captured when global sync took over, restored when it is switched off. */
	public preSyncSoloStates: boolean[] | null = null;

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
	public fullscreen = false;
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
		this.features = { ...config.features };
		this.state = createInitialPlayerState(!!this.navigationBar?.repeatEnabled);
		this.runtimeMarkers = createRuntimeMarkerSet(IMPLICIT_REFERENCE_TIMELINE);

		this.runtimes = config.tracks.map((track, index) =>
			createTrackRuntime(track, index),
		);

		const trackGroups = buildTrackGroups(config.views);
		this.trackGroups = trackGroups;
		applyInitialGroupSolos(this.runtimes, trackGroups);

		const presetEntries = Object.entries(this.presets).map(([id, preset]) => ({
			id,
			label: preset.label ?? id,
		}));

		applyTrackPanAlgorithms(this.runtimes, trackGroups);
		resetDisabledTrackVolumeControls(this.runtimes, trackGroups);

		this.audioEngine = new AudioEngine(
			this.features,
			this.state.volume,
			!!this.alignmentConfig,
			!!this.navigationBar?.controls.includes("globalVolume"),
		);
		this.waveformEngine = new WaveformEngine();
		this.sheetMusicEngine = new SheetMusicEngine((referenceTime) => {
			this.seekTo(referenceTime);
		});
		this.renderer = new ViewRenderer(
			this.root,
			this.features,
			presetEntries,
			trackGroups,
			(referenceTime) => {
				this.seekTo(referenceTime);
			},
			(referenceTime) =>
				this.sheetMusicEngine.resolveReferenceBpm(referenceTime),
			config.css,
		);
		this.renderer.isTrackExclusive = (trackIndex: number) =>
			this.isTrackExclusive(trackIndex);
		this.renderer.isGroupExclusive = (groupIndex: number) =>
			this.isGroupExclusive(groupIndex);
		this.renderer.isTrackListUnitActive = (groupIndex: number) =>
			this.isTrackListUnitActive(groupIndex);
		// The rule an `audible` waveform follows, so a piano roll showing the same
		// selection can never disagree with the waveform beside it.
		this.renderer.isTrackAudible = (trackIndex: number) =>
			isWaveformTrackAudible(
				this.runtimes,
				trackIndex,
				"audible",
				this.isAlignmentMode(),
				(index: number) => this.isTrackExclusive(index),
			);
		if (config.alignment) {
			// Pre-load readout unit; the resolved alignment replaces this with the
			// declared unit and its converter once the media are profiled.
			this.renderer.setReferenceTimelineUnit(
				resolveTimelineUnit(config.media[config.alignment.referenceTimeline]),
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
		this.eventNamespace = `.trackswitch.${this.instanceId}`;

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

	/** Whether one list currently lets only a single one of its tracks sound. */
	public isGroupExclusive(groupIndex: number): boolean {
		if (this.soloMode === "free") {
			return false;
		}

		return !!this.trackGroups[groupIndex]?.exclusiveSolo;
	}

	public groupIndexForTrack(trackIndex: number): number {
		const trackId = this.runtimes[trackIndex]?.definition.id;
		if (trackId === undefined) {
			return -1;
		}

		return findGroupIndexForTrack(this.trackGroups, trackId);
	}

	/** Exclusivity for a track index alone — resolved through its first list. */
	public isTrackExclusive(trackIndex: number): boolean {
		return this.isGroupExclusive(this.groupIndexForTrack(trackIndex));
	}

	public hasAnyExclusiveGroup(): boolean {
		return this.trackGroups.some((group) =>
			this.isGroupExclusive(group.groupIndex),
		);
	}

	public trackIndexesInGroup(groupIndex: number): number[] {
		return resolveGroupTrackIndexes(
			this.runtimes,
			this.trackGroups[groupIndex],
		);
	}

	/** The tracks one exclusive selection covers — its list, and any list sharing its `soloGroup`. */
	public trackIndexesInSoloScope(groupIndex: number): number[] {
		return resolveSoloScopeTrackIndexes(
			this.runtimes,
			this.trackGroups,
			groupIndex,
		);
	}

	/** The selectable timelines of the alignment hierarchy's first level. */
	public soloUnits(): SoloUnit[] {
		return controllerSolo.soloUnits(this);
	}

	public activeSoloUnitIndex(): number {
		return controllerSolo.activeSoloUnitIndex(this);
	}

	public isTrackListUnitActive(groupIndex: number): boolean {
		return controllerSolo.isTrackListUnitActive(this, groupIndex);
	}

	public selectTrackListUnit(groupIndex: number): void {
		controllerSolo.selectTrackListUnit(this, groupIndex);
	}

	public collapseToSingleSelection(): void {
		controllerSolo.collapseToSingleSelection(this);
	}

	/**
	 * Re-seeks after a selection switched the audible timeline; a switch inside one
	 * unit means the same timeline, and leaves playback alone.
	 */
	public finishSoloUnitSwitch(previousUnitIndex: number): void {
		const nextTrackIndex = this.getActiveSoloTrackIndex();
		if (
			this.alignment &&
			this.soloMode === "alignment" &&
			nextTrackIndex >= 0 &&
			this.activeSoloUnitIndex() !== previousUnitIndex
		) {
			this.handleAlignmentTrackSwitch(nextTrackIndex);
			return;
		}

		this.updateMainControls();
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

	toggleSolo(trackIndex: number, exclusive = false, groupIndex?: number): void {
		controllerPlayback.toggleSolo(this, trackIndex, exclusive, groupIndex);
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

	toggleFullscreen(): void {
		controllerInput.toggleFullscreen(this);
	}

	onFullscreenToggle(event: ControllerPointerEvent): void {
		controllerInput.onFullscreenToggle(this, event);
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

	onPianoRollZoomWheel(event: ControllerPointerEvent): void {
		controllerSeek.onPianoRollZoomWheel(this, event);
	}

	onPianoRollMinimapStart(event: ControllerPointerEvent): void {
		controllerInput.onPianoRollMinimapStart(this, event);
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

	public isPianoRollSeekSurface(seekWrap: HTMLElement | null): boolean {
		return controllerSeek.isPianoRollSeekSurface(this, seekWrap);
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

	public trackGroupIndexFromTarget(target: EventTarget | null): number {
		return controllerSeek.trackGroupIndexFromTarget(this, target);
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

	public setSoloMode(soloMode: SoloMode): void {
		controllerAlignment.setSoloMode(this, soloMode);
	}

	/**
	 * The solo mode the current playback mode dictates. Alignment resolves to one
	 * audible timeline whatever the lists declare, because only one timeline can
	 * sit at the audible position; sync mode is what lets timelines sound
	 * together, since it runs them on a shared clock. Without alignment each list
	 * decides for itself.
	 */
	public restoreSoloMode(): void {
		if (!this.isAlignmentMode()) {
			this.setSoloMode("lists");
			return;
		}

		this.setSoloMode(this.globalSyncEnabled ? "free" : "alignment");
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

	public async renderSheetMusic(): Promise<void> {
		return controllerPlayback.renderSheetMusic(this);
	}

	public async attachSheetMusicMeasureMaps(): Promise<void> {
		return controllerPlayback.attachSheetMusicMeasureMaps(this);
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

	public currentPlaybackTrackPosition(): number {
		return controllerAlignment.currentPlaybackTrackPosition(this);
	}

	public currentPlaybackAnchor(): PlaybackAnchor | null {
		return controllerAlignment.currentPlaybackAnchor(this);
	}

	public trackPlaybackAnchor(
		trackIndex: number,
		trackTime: number,
	): PlaybackAnchor | null {
		return controllerAlignment.trackPlaybackAnchor(this, trackIndex, trackTime);
	}

	public projectAnchor(
		anchor: PlaybackAnchor | null,
		timeline: TimelineId,
	): number | null {
		return controllerAlignment.projectAnchor(this, anchor, timeline);
	}

	public playbackPositionOn(
		timeline: TimelineId,
		referencePosition?: number,
	): number | null {
		return controllerAlignment.playbackPositionOn(
			this,
			timeline,
			referencePosition,
		);
	}

	public trackPlaybackPosition(
		trackIndex: number,
		referencePosition?: number,
	): number | null {
		return controllerAlignment.trackPlaybackPosition(
			this,
			trackIndex,
			referencePosition,
		);
	}

	public hasReachedPlaybackEnd(): boolean {
		return controllerPlayback.hasReachedPlaybackEnd(this);
	}

	public isFixedWaveformLocalAxisEnabled(): boolean {
		return controllerSeek.isFixedWaveformLocalAxisEnabled(this);
	}

	public getSeekTimelineContext(
		seekingElement: HTMLElement | null,
	): SeekTimelineContext {
		return controllerSeek.getSeekTimelineContext(this, seekingElement);
	}

	public getPianoRollTimelineContext(
		pianoRollSurface: PianoRollSeekSurfaceMetadata | null,
	): SeekTimelineContext | null {
		return controllerSeek.getPianoRollTimelineContext(this, pianoRollSurface);
	}

	public getImageTimelineContext(
		imageSurface: ImageSeekSurfaceMetadata | null,
	): SeekTimelineContext | null {
		return controllerSeek.getImageTimelineContext(this, imageSurface);
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

	public trackToReferenceTime(
		trackIndex: number,
		trackTime: number,
		preferredReferenceTime?: number,
	): number {
		return controllerAlignment.trackToReferenceTime(
			this,
			trackIndex,
			trackTime,
			preferredReferenceTime,
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
