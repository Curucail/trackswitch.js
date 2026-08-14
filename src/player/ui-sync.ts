import {
	createPositionEventPayload,
	createTrackStateEventPayload,
	createUiState,
} from "./controller-state";
import type { TrackSwitchControllerImpl } from "./player-controller";

function emitPositionUpdate(controller: TrackSwitchControllerImpl): void {
	controller.emit("position", createPositionEventPayload(controller));
}

function shouldSuppressWaveformPlaybackFollow(
	controller: TrackSwitchControllerImpl,
): boolean {
	return (
		!!controller.waveformMinimapDragState ||
		!!controller.pinchZoomState ||
		!!controller.pendingWaveformTouchSeek ||
		(controller.state.currentlySeeking &&
			controller.isWaveformSeekSurface(controller.seekingElement))
	);
}

function shouldSuppressPianoRollPlaybackFollow(
	controller: TrackSwitchControllerImpl,
): boolean {
	return (
		!!controller.waveformMinimapDragState ||
		!!controller.pinchZoomState ||
		(controller.state.currentlySeeking &&
			controller.isPianoRollSeekSurface(controller.seekingElement))
	);
}

export function applyTrackProperties(ctx: TrackSwitchControllerImpl): void {
	const stereoPanningSupported = ctx.audioEngine.supportsStereoPanning();
	// With nothing soloed at all, a track of an exclusive list still sounds — that
	// list always means one of its tracks. Global sync silences the fallback.
	const silentFallback = ctx.isAlignmentMode() && ctx.globalSyncEnabled;
	const noSoloFallbackGates = ctx.runtimes.map((_runtime, index) =>
		!silentFallback && ctx.isTrackExclusive(index) ? 1 : 0,
	);
	// Only "pan" tracks need StereoPannerNode — "balance" tracks mix with plain
	// gain nodes and keep working wherever an AudioContext exists at all.
	ctx.runtimes.forEach((runtime) => {
		if (runtime.panAlgorithm === "pan" && !stereoPanningSupported) {
			runtime.state.pan = 0;
		}
	});

	ctx.renderer.updateTrackControls(
		ctx.runtimes,
		ctx.syncLockedTrackIndexes,
		stereoPanningSupported,
		ctx.globalSyncEnabled,
	);
	ctx.audioEngine.applyTrackStateGains(ctx.runtimes, noSoloFallbackGates);
	ctx.renderer.switchPosterImage(ctx.runtimes);
	ctx.renderer.renderWaveforms(
		ctx.waveformEngine,
		ctx.runtimes,
		ctx.longestDuration,
		ctx.getWaveformTimelineProjector(),
		ctx.getWaveformTimelineContext(),
	);
	ctx.renderer.updatePianoRollChannelVisibility(ctx.runtimes);
	ctx.renderMarkerLayers();
	ctx.updateMarkerNavigation();

	ctx.runtimes.forEach((runtime, index) => {
		ctx.emit("trackState", createTrackStateEventPayload(index, runtime));
	});
}

export function updateMainControls(
	ctx: TrackSwitchControllerImpl,
	animate = false,
): void {
	ctx.synchronizeRuntimeMarkers();
	const uiState = createUiState(ctx);
	const suppressWaveformPlaybackFollow =
		shouldSuppressWaveformPlaybackFollow(ctx);

	ctx.renderer.updateMainControls(
		uiState,
		ctx.runtimes,
		ctx.getWaveformTimelineContext(),
		ctx.getWarpingMatrixContext(),
	);
	ctx.renderer.updateWaveformPlaybackFollow(
		uiState,
		ctx.runtimes,
		ctx.getWaveformTimelineContext(),
		suppressWaveformPlaybackFollow,
		animate,
	);
	ctx.renderer.updatePianoRollPlaybackState(
		uiState,
		shouldSuppressPianoRollPlaybackFollow(ctx),
		ctx.isAlignmentMode(),
		(surface) => ctx.getPianoRollTimelineContext(surface),
		animate,
	);
	ctx.updateMarkerNavigation();
	ctx.sheetMusicEngine.updatePosition(
		ctx.state.position,
		ctx.isSyncReferenceAxisActive(),
		ctx.renderer.isTimelineCovered ?? undefined,
	);

	emitPositionUpdate(ctx);
}

export function updatePlaybackPositionUi(ctx: TrackSwitchControllerImpl): void {
	ctx.synchronizeRuntimeMarkers();
	const uiState = createUiState(ctx);
	const suppressWaveformPlaybackFollow =
		shouldSuppressWaveformPlaybackFollow(ctx);

	ctx.renderer.updatePlaybackPosition(
		uiState,
		ctx.runtimes,
		ctx.getWaveformTimelineContext(),
		ctx.getWarpingMatrixContext(),
	);
	ctx.renderer.updateWaveformPlaybackFollow(
		uiState,
		ctx.runtimes,
		ctx.getWaveformTimelineContext(),
		suppressWaveformPlaybackFollow,
	);
	ctx.renderer.updatePianoRollPlaybackState(
		uiState,
		shouldSuppressPianoRollPlaybackFollow(ctx),
		ctx.isAlignmentMode(),
		(surface) => ctx.getPianoRollTimelineContext(surface),
	);
	ctx.updateMarkerNavigation();
	ctx.sheetMusicEngine.updatePosition(
		ctx.state.position,
		ctx.isSyncReferenceAxisActive(),
		ctx.renderer.isTimelineCovered ?? undefined,
	);

	emitPositionUpdate(ctx);
}
