import type { PlayerAction } from "../domain/state";
import { playerStateReducer } from "../domain/state";
import type {
	LoopMarker,
	PlaybackAnchor,
	ResolvedAlignment,
	TrackRuntime,
} from "../domain/types";
import { clamp } from "../shared/math";
import type { ControllerPointerEvent } from "../shared/seek";
import { getSeekMetrics } from "../shared/seek";
import { moveRuntimeMarker } from "../timeline/marker";
import { resolveImplicitTimelineUnit } from "../timeline/media-profile";
import { playerTimeline } from "../timeline/timeline";
import { applyReferenceReadoutUnit } from "./alignment-actions";
import { loadMarkerSets } from "./marker-sets";
import { probeMediaProfiles } from "./media-profiles";
import type { TrackSwitchControllerImpl } from "./player-controller";
import { pauseOtherControllers, unregisterController } from "./player-registry";
import { toggleSoloWithinAlignment } from "./solo-units";

function getLoadErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}

	const fallback = String(error ?? "").trim();
	if (fallback.length > 0 && fallback !== "[object Object]") {
		return fallback;
	}

	return "Unexpected error while loading TrackSwitch.";
}

export async function load(ctx: TrackSwitchControllerImpl): Promise<void> {
	if (ctx.isDestroyed || ctx.isLoaded || ctx.isLoading) {
		return;
	}

	ctx.isLoading = true;
	ctx.renderer.setOverlayLoading(true);
	try {
		const prepared = await ctx.audioEngine.prepareForPlaybackStart();
		if (!prepared) {
			ctx.isLoading = false;
			ctx.renderer.setOverlayLoading(false);
			ctx.handleError(
				"Web Audio API is not supported in your browser. Please consider upgrading.",
			);
			return;
		}

		if (!ctx.iOSPlaybackUnlocked) {
			ctx.iOSPlaybackUnlocked = true;
			await ctx.audioEngine.unlockIOSPlayback();
		}

		ctx.globalSyncEnabled = false;
		ctx.syncLockedTrackIndexes.clear();
		ctx.preSyncSoloStates = null;
		ctx.soloMode = "lists";

		ctx.runtimes.forEach((runtime: TrackRuntime) => {
			runtime.successful = false;
			runtime.errored = false;
			runtime.buffer = null;
			runtime.gainNode = null;
			runtime.pannerNode = null;
			runtime.panUpmixNode = null;
			runtime.panSplitterNode = null;
			runtime.panGainLeftNode = null;
			runtime.panGainRightNode = null;
			runtime.panMergerNode = null;
			runtime.timing = null;
			runtime.sourceSampleRate = null;
			runtime.loudnessGain = 1;
			runtime.activeSource = null;
			runtime.sourceIndex = -1;
			runtime.activeVariant = "base";
			runtime.baseSource = {
				buffer: null,
				timing: null,
				sourceIndex: -1,
				sourceSampleRate: null,
				waveformSummary: null,
				loudnessGain: 1,
			};
			runtime.syncedSource = null;
			runtime.waveformSummary = null;
		});

		await ctx.audioEngine.loadTracks(ctx.runtimes);

		if (ctx.isDestroyed) {
			return;
		}

		ctx.runtimes.forEach((runtime: TrackRuntime) => {
			if (runtime.baseSource.buffer) {
				runtime.baseSource.waveformSummary = ctx.waveformEngine.createSummary(
					runtime.baseSource.buffer,
				);
			}

			if (runtime.syncedSource?.buffer) {
				runtime.syncedSource.waveformSummary = ctx.waveformEngine.createSummary(
					runtime.syncedSource.buffer,
				);
			}

			const activeSource =
				runtime.activeVariant === "synced"
					? runtime.syncedSource
					: runtime.baseSource;
			runtime.waveformSummary = activeSource
				? activeSource.waveformSummary
				: null;
		});

		ctx.isLoading = false;
		ctx.renderer.setOverlayLoading(false);

		const erroredTracks = ctx.runtimes.filter(
			(runtime: TrackRuntime) => runtime.errored,
		);

		if (erroredTracks.length > 0) {
			ctx.handleError("One or more audio files failed to load.");
			return;
		}

		ctx.longestDuration = ctx.findLongestDuration();
		ctx.alignment = null;
		ctx.alignmentPlaybackTrackIndex = null;

		// Every medium is parsed before the alignment resolves so it can read
		// their natural extents and unit conversions.
		await ctx.renderSheetMusic();

		if (ctx.isDestroyed) {
			return;
		}

		await ctx.renderer.loadMidiSources();

		if (ctx.isDestroyed) {
			return;
		}

		if (ctx.alignmentConfig) {
			const alignmentError = await ctx.initializeAlignmentMode();
			if (alignmentError) {
				ctx.handleError(alignmentError);
				return;
			}
		} else {
			// No alignment resolves the media profiles, so probe them here — but
			// only for a `media.timelineUnit`, the one thing left that needs a
			// conversion out of seconds.
			ctx.mediaProfiles = resolveImplicitTimelineUnit(ctx.media)
				? await probeMediaProfiles({
						media: ctx.media,
						runtimes: ctx.runtimes,
						midiBySource: ctx.renderer.getLoadedMidiBySource(),
						measuresByMediaId:
							ctx.sheetMusicEngine.getAvailableMeasuresByMediaId(),
					})
				: new Map();
			applyReferenceReadoutUnit(ctx);
		}

		if (ctx.isDestroyed) {
			return;
		}

		await ctx.attachSheetMusicMeasureMaps();

		if (ctx.isDestroyed) {
			return;
		}

		const alignment = ctx.alignment as ResolvedAlignment | null;
		ctx.markerSets = await loadMarkerSets(
			ctx.markersConfig,
			alignment,
			ctx.media,
			alignment?.profiles ?? ctx.mediaProfiles,
			ctx.longestDuration,
		);

		if (ctx.isDestroyed) {
			return;
		}

		await ctx.renderer.initializePianoRollDisplays(
			ctx.longestDuration,
			ctx.isAlignmentMode(),
		);
		// The notes exist now, so the first paint can already drop the channels
		// whose track starts out silent.
		ctx.renderer.updatePianoRollChannelVisibility(ctx.runtimes);

		if (ctx.isDestroyed) {
			return;
		}

		ctx.isLoaded = true;
		ctx.renderer.hideOverlayOnLoaded();

		ctx.updateMainControls();
		ctx.applyTrackProperties();

		ctx.emit("loaded", {
			longestDuration: ctx.longestDuration,
		});
	} catch (error) {
		if (ctx.isDestroyed) {
			return;
		}

		ctx.isLoading = false;
		ctx.renderer.setOverlayLoading(false);
		ctx.handleError(getLoadErrorMessage(error));
	}
}

export function destroy(ctx: TrackSwitchControllerImpl): void {
	if (ctx.isDestroyed) {
		return;
	}
	ctx.isDestroyed = true;

	if (ctx.timerMonitorPosition) {
		clearInterval(ctx.timerMonitorPosition);
		ctx.timerMonitorPosition = null;
	}
	if (ctx.resizeDebounceTimer) {
		clearTimeout(ctx.resizeDebounceTimer);
		ctx.resizeDebounceTimer = null;
	}
	if (ctx.waveformRenderFrameId !== null) {
		cancelAnimationFrame(ctx.waveformRenderFrameId);
		ctx.waveformRenderFrameId = null;
	}
	ctx.seekingElement = null;
	ctx.rightClickDragging = false;
	ctx.loopDragStart = null;
	ctx.draggingMarker = null;
	ctx.pinchZoomState = null;
	ctx.pendingWaveformTouchSeek = null;
	ctx.waveformMinimapDragState = null;

	if (ctx.state.playing) {
		ctx.stopAudio();
	}

	ctx.inputBinder.unbind();
	ctx.sheetMusicEngine.destroy();
	ctx.renderer.destroy();
	ctx.audioEngine.disconnect();

	ctx.listeners.loaded.clear();
	ctx.listeners.error.clear();
	ctx.listeners.position.clear();
	ctx.listeners.trackState.clear();

	unregisterController(ctx);
}

export function togglePlay(ctx: TrackSwitchControllerImpl): void {
	if (ctx.state.playing) {
		ctx.pause();
	} else {
		ctx.play();
	}
}

export function play(ctx: TrackSwitchControllerImpl): void {
	if (ctx.isDestroyed || !ctx.isLoaded) {
		return;
	}
	if (ctx.state.playing) {
		return;
	}

	let startPosition = ctx.state.position;

	if (ctx.hasReachedPlaybackEnd()) {
		startPosition = 0;
	}

	if (
		ctx.navigationBar?.controls.includes("looping") &&
		ctx.state.loop.enabled &&
		ctx.state.loop.pointA !== null &&
		ctx.state.loop.pointB !== null &&
		(ctx.state.position < ctx.state.loop.pointA ||
			ctx.state.position > ctx.state.loop.pointB)
	) {
		startPosition = ctx.state.loop.pointA;
	}

	ctx.startAudio(startPosition);
	ctx.pauseOthers();
	ctx.dispatch({ type: "set-playing", playing: true });
	ctx.updatePlaybackPositionUi();
}

export function pause(ctx: TrackSwitchControllerImpl): void {
	if (!ctx.state.playing) {
		return;
	}

	const position = ctx.currentPlaybackReferencePosition();
	const anchor = ctx.currentPlaybackAnchor();
	ctx.stopAudio();

	ctx.dispatch({ type: "set-position", position: position, anchor: anchor });
	ctx.dispatch({ type: "set-playing", playing: false });

	ctx.updateMainControls();
}

export function stop(ctx: TrackSwitchControllerImpl): void {
	if (ctx.state.playing) {
		ctx.stopAudio();
	}

	ctx.dispatch({ type: "set-position", position: 0 });
	ctx.dispatch({ type: "set-playing", playing: false });
	ctx.updateMainControls();
}

export function seekTo(ctx: TrackSwitchControllerImpl, seconds: number): void {
	const nextPosition = clamp(seconds, 0, ctx.longestDuration);

	if (ctx.state.playing) {
		ctx.stopAudio();
		ctx.startAudio(nextPosition);
	} else {
		ctx.dispatch({ type: "set-position", position: nextPosition });
	}

	ctx.updateMainControls();
}

export function seekRelative(
	ctx: TrackSwitchControllerImpl,
	seconds: number,
): void {
	let nextPosition = ctx.state.position + seconds;
	nextPosition = clamp(nextPosition, 0, ctx.longestDuration);

	if (
		ctx.navigationBar?.controls.includes("looping") &&
		ctx.state.loop.enabled &&
		ctx.state.loop.pointA !== null &&
		ctx.state.loop.pointB !== null
	) {
		const loopStart = ctx.state.loop.pointA;
		const loopEnd = ctx.state.loop.pointB;
		const loopLength = loopEnd - loopStart;
		if (loopLength > 0) {
			let relative = nextPosition - loopStart;
			relative = ((relative % loopLength) + loopLength) % loopLength;
			nextPosition = loopStart + relative;
		}
	}

	if (ctx.state.playing) {
		ctx.stopAudio();
		ctx.startAudio(nextPosition);
	} else {
		ctx.dispatch({ type: "set-position", position: nextPosition });
	}

	ctx.updateMainControls();
}

export function setRepeat(
	ctx: TrackSwitchControllerImpl,
	enabled: boolean,
): void {
	ctx.dispatch({ type: "set-repeat", enabled: enabled });
	ctx.updateMainControls();
}

export function setVolume(
	ctx: TrackSwitchControllerImpl,
	volumeZeroToOne: number,
): void {
	if (!ctx.navigationBar?.controls.includes("globalVolume")) {
		ctx.dispatch({ type: "set-volume", volume: 1 });
		ctx.audioEngine.setMasterVolume(1);
		ctx.renderer.setVolumeSlider(1);
		return;
	}

	ctx.dispatch({ type: "set-volume", volume: volumeZeroToOne });
	ctx.audioEngine.setMasterVolume(ctx.state.volume);
	ctx.renderer.setVolumeSlider(ctx.state.volume);
}

export function setPan(
	ctx: TrackSwitchControllerImpl,
	panMinusOneToOne: number,
): void {
	if (!ctx.navigationBar?.controls.includes("globalPan")) {
		ctx.dispatch({ type: "set-pan", pan: 0 });
		ctx.audioEngine.setMasterPan(0);
		ctx.renderer.setPanSlider(0);
		return;
	}

	ctx.dispatch({ type: "set-pan", pan: panMinusOneToOne });
	ctx.audioEngine.setMasterPan(ctx.state.pan);
	ctx.renderer.setPanSlider(ctx.state.pan);
}

export function setTrackVolume(
	ctx: TrackSwitchControllerImpl,
	trackIndex: number,
	volumeZeroToOne: number,
): void {
	if (
		!Number.isInteger(trackIndex) ||
		trackIndex < 0 ||
		trackIndex >= ctx.runtimes.length
	) {
		return;
	}

	if (ctx.isTrackSyncLocked(trackIndex)) {
		return;
	}

	const runtime = ctx.runtimes[trackIndex];
	runtime.state.volume = clamp(volumeZeroToOne, 0, 1);
	ctx.applyTrackProperties();
}

export function setTrackPan(
	ctx: TrackSwitchControllerImpl,
	trackIndex: number,
	panMinusOneToOne: number,
): void {
	if (
		!Number.isInteger(trackIndex) ||
		trackIndex < 0 ||
		trackIndex >= ctx.runtimes.length
	) {
		return;
	}

	if (ctx.isTrackSyncLocked(trackIndex)) {
		return;
	}

	const runtime = ctx.runtimes[trackIndex];
	const panSupported =
		runtime.panAlgorithm === "balance" ||
		ctx.audioEngine.supportsStereoPanning();
	runtime.state.pan = panSupported ? clamp(panMinusOneToOne, -1, 1) : 0;
	ctx.applyTrackProperties();
}

export function setLoopPoint(
	ctx: TrackSwitchControllerImpl,
	marker: LoopMarker,
): boolean {
	if (!ctx.navigationBar?.controls.includes("looping")) {
		return false;
	}

	const position = ctx.state.playing
		? ctx.currentPlaybackReferencePosition()
		: ctx.state.position;
	const currentPoint =
		marker === "A" ? ctx.state.loop.pointA : ctx.state.loop.pointB;
	if (
		currentPoint !== null &&
		Math.abs(currentPoint - position) < ctx.loopMinDistance
	) {
		ctx.state = {
			...ctx.state,
			loop: {
				...ctx.state.loop,
				enabled: false,
				pointA: marker === "A" ? null : ctx.state.loop.pointA,
				pointB: marker === "B" ? null : ctx.state.loop.pointB,
			},
		};
		ctx.updateMainControls();
		return false;
	}

	ctx.dispatch({
		type: "set-loop-point",
		marker: marker,
		position: position,
		minDistance: ctx.loopMinDistance,
	});

	const nextPoint =
		marker === "A" ? ctx.state.loop.pointA : ctx.state.loop.pointB;
	if (nextPoint === null) {
		ctx.updateMainControls();
		return false;
	}

	if (ctx.state.loop.pointA !== null && ctx.state.loop.pointB !== null) {
		const loopA = ctx.state.loop.pointA;
		const loopB = ctx.state.loop.pointB;
		activateLoopRange(ctx, loopA, loopB);
	}

	ctx.updateMainControls();
	return true;
}

export function activateLoopRange(
	ctx: TrackSwitchControllerImpl,
	loopA: number,
	loopB: number,
): void {
	ctx.state = {
		...ctx.state,
		loop: {
			...ctx.state.loop,
			enabled: true,
		},
	};

	if (
		ctx.state.playing &&
		(ctx.state.position < loopA || ctx.state.position > loopB)
	) {
		ctx.stopAudio();
		ctx.startAudio(loopA);
	}
}

export function toggleLoop(ctx: TrackSwitchControllerImpl): boolean {
	if (!ctx.navigationBar?.controls.includes("looping")) {
		return false;
	}

	if (ctx.state.loop.pointA === null || ctx.state.loop.pointB === null) {
		return false;
	}

	ctx.dispatch({ type: "toggle-loop" });

	if (
		ctx.state.loop.enabled &&
		ctx.state.loop.pointA !== null &&
		ctx.state.loop.pointB !== null &&
		(ctx.state.position < ctx.state.loop.pointA ||
			ctx.state.position > ctx.state.loop.pointB)
	) {
		if (ctx.state.playing) {
			ctx.stopAudio();
			ctx.startAudio(ctx.state.loop.pointA);
		} else {
			ctx.dispatch({
				type: "set-position",
				position: ctx.state.loop.pointA,
			});
		}
	}

	ctx.updateMainControls();
	return true;
}

export function clearLoop(ctx: TrackSwitchControllerImpl): void {
	ctx.dispatch({ type: "clear-loop" });
	ctx.rightClickDragging = false;
	ctx.loopDragStart = null;
	ctx.draggingMarker = null;
	ctx.updateMainControls();
}

/**
 * Exclusivity is scoped to one selection: a second list keeps whatever it had
 * selected unless it shares the clicked list's `soloGroup`. Alignment is the
 * exception: it resolves the whole player to one solo unit, and a click reads as a
 * move within that hierarchy.
 */
export function toggleSolo(
	ctx: TrackSwitchControllerImpl,
	trackIndex: number,
	exclusive: boolean,
	groupIndex?: number,
): void {
	const runtime = ctx.runtimes[trackIndex];
	if (!runtime) {
		return;
	}

	if (ctx.isTrackSyncLocked(trackIndex)) {
		return;
	}

	const resolvedGroupIndex = groupIndex ?? ctx.groupIndexForTrack(trackIndex);
	const previousUnitIndex = ctx.activeSoloUnitIndex();

	if (ctx.soloMode === "alignment") {
		toggleSoloWithinAlignment(ctx, trackIndex, resolvedGroupIndex, exclusive);
	} else {
		const singleSoloMode =
			exclusive || ctx.isGroupExclusive(resolvedGroupIndex);
		const currentState = runtime.state.solo;

		if (singleSoloMode) {
			ctx
				.trackIndexesInSoloScope(resolvedGroupIndex)
				.forEach((index: number) => {
					ctx.runtimes[index].state.solo = false;
				});
		}

		runtime.state.solo = singleSoloMode && currentState ? true : !currentState;
	}

	ctx.applyTrackProperties();
	ctx.finishSoloUnitSwitch(previousUnitIndex);
}

export function applyPreset(
	ctx: TrackSwitchControllerImpl,
	presetId: string,
): void {
	const preset = ctx.presets[presetId];
	if (!preset) {
		return;
	}

	const trackIds = new Set(preset.tracks);
	ctx.runtimes.forEach((runtime: TrackRuntime) => {
		runtime.state.solo = trackIds.has(runtime.definition.id);
	});

	// A preset may name more than the current mode can play at once — an
	// exclusive list then keeps the first of its named tracks, and alignment
	// keeps the first named solo unit.
	ctx.collapseToSingleSelection();

	ctx.applyTrackProperties();
}

/** Phase A — render the scores; their measure extents feed alignment resolution. */
export async function renderSheetMusic(
	ctx: TrackSwitchControllerImpl,
): Promise<void> {
	const hosts = ctx.renderer.getPreparedSheetMusicHosts();

	if (hosts.length === 0) {
		ctx.sheetMusicEngine.destroy();
		return;
	}

	await ctx.sheetMusicEngine.initialize(hosts);
}

/** Phase B — attach the alignment-derived measure maps to the rendered scores. */
export async function attachSheetMusicMeasureMaps(
	ctx: TrackSwitchControllerImpl,
): Promise<void> {
	if (ctx.sheetMusicEngine.entries.length === 0) {
		return;
	}

	await ctx.sheetMusicEngine.attachMeasureMaps(
		(measureColumn: string, source: string) =>
			ctx.buildSheetMusicMeasureMaps(measureColumn, source),
	);
	ctx.sheetMusicEngine.updatePosition(
		ctx.state.position,
		ctx.isSyncReferenceAxisActive(),
	);
}

export function dispatch(
	ctx: TrackSwitchControllerImpl,
	action: PlayerAction,
): void {
	ctx.state = playerStateReducer(ctx.state, action);
	// Position and loop points are reference-timeline coordinates.
	const positionTimeline = playerTimeline(ctx.alignment);
	if (action.type === "set-position") {
		ctx.runtimeMarkers = moveRuntimeMarker(
			ctx.runtimeMarkers,
			"playhead",
			positionTimeline,
			ctx.state.position,
		);
	} else if (action.type === "set-loop-point") {
		ctx.runtimeMarkers = moveRuntimeMarker(
			ctx.runtimeMarkers,
			action.marker === "A" ? "loopA" : "loopB",
			positionTimeline,
			action.marker === "A" ? ctx.state.loop.pointA : ctx.state.loop.pointB,
		);
	} else if (action.type === "clear-loop") {
		ctx.runtimeMarkers = moveRuntimeMarker(
			ctx.runtimeMarkers,
			"loopA",
			positionTimeline,
			null,
		);
		ctx.runtimeMarkers = moveRuntimeMarker(
			ctx.runtimeMarkers,
			"loopB",
			positionTimeline,
			null,
		);
	}
}

export function pauseOthers(ctx: TrackSwitchControllerImpl): void {
	if (!ctx.features.muteOtherPlayerInstances) {
		return;
	}

	pauseOtherControllers(ctx);
}

export function startAudio(
	ctx: TrackSwitchControllerImpl,
	newPosition: number | undefined,
	snippetDuration: number | undefined,
): void {
	const requestedPosition =
		typeof newPosition === "number" ? newPosition : ctx.state.position;
	let enginePosition = requestedPosition;
	let nextReferencePosition = requestedPosition;
	let nextAnchor: PlaybackAnchor | null = null;

	if (ctx.isAlignmentMode() && ctx.alignment) {
		const activeTrackIndex = ctx.getAlignmentPlaybackTrackIndex();
		if (activeTrackIndex < 0) {
			return;
		}

		// An anchor for ctx position already says where on ctx track to start;
		// re-deriving it from the reference would round it to the edge of any
		// stretch the alignment holds at one reference value.
		enginePosition =
			ctx.trackPlaybackPosition(activeTrackIndex, requestedPosition) ??
			ctx.referenceToTrackTime(activeTrackIndex, requestedPosition);
		nextReferencePosition = ctx.trackToReferenceTime(
			activeTrackIndex,
			enginePosition,
			requestedPosition,
		);
		ctx.alignmentPlaybackTrackIndex = activeTrackIndex;
		nextAnchor = ctx.trackPlaybackAnchor(activeTrackIndex, enginePosition);
	} else {
		ctx.alignmentPlaybackTrackIndex = null;
	}

	const startResult = ctx.audioEngine.start(
		ctx.runtimes,
		enginePosition,
		snippetDuration,
	);
	if (!startResult) {
		ctx.alignmentPlaybackTrackIndex = null;
		return;
	}

	ctx.dispatch({
		type: "set-position",
		position: clamp(nextReferencePosition, 0, ctx.longestDuration),
		anchor: nextAnchor,
	});
	ctx.dispatch({ type: "set-start-time", startTime: startResult.startTime });

	if (ctx.timerMonitorPosition) {
		clearInterval(ctx.timerMonitorPosition);
	}

	ctx.timerMonitorPosition = setInterval(() => {
		ctx.monitorPosition();
	}, 16);
}

export function stopAudio(ctx: TrackSwitchControllerImpl): void {
	ctx.audioEngine.stop(ctx.runtimes);
	ctx.alignmentPlaybackTrackIndex = null;
	if (ctx.timerMonitorPosition) {
		clearInterval(ctx.timerMonitorPosition);
		ctx.timerMonitorPosition = null;
	}
}

export function monitorPosition(ctx: TrackSwitchControllerImpl): void {
	if (ctx.isDestroyed) {
		return;
	}

	if (ctx.state.playing && !ctx.state.currentlySeeking) {
		const currentPosition = ctx.currentPlaybackReferencePosition();
		ctx.dispatch({
			type: "set-position",
			position: currentPosition,
			anchor: ctx.currentPlaybackAnchor(),
		});
	}

	if (
		ctx.navigationBar?.controls.includes("looping") &&
		ctx.state.loop.enabled &&
		ctx.state.loop.pointB !== null &&
		ctx.state.position >= ctx.state.loop.pointB &&
		!ctx.state.currentlySeeking
	) {
		ctx.stopAudio();
		ctx.startAudio(ctx.state.loop.pointA ?? 0);
		return;
	}

	// Playback ends when the selected audio runs out. It can omit the final
	// reference occurrence and therefore end before the reference extent.
	if (ctx.hasReachedPlaybackEnd() && !ctx.state.currentlySeeking) {
		ctx.stopAudio();

		if (ctx.state.repeat) {
			ctx.dispatch({ type: "set-position", position: 0 });
			ctx.startAudio(0);
			ctx.dispatch({ type: "set-playing", playing: true });
		} else {
			ctx.dispatch({ type: "set-playing", playing: false });
		}
	}

	ctx.updateMainControls();
}

/**
 * True once there is nothing left to play. In alignment mode that is decided by
 * the lead track's own duration, so a recording keeps sounding through material
 * the alignment does not cover; otherwise the shared duration decides.
 */
export function hasReachedPlaybackEnd(ctx: TrackSwitchControllerImpl): boolean {
	if (ctx.isAlignmentMode() && ctx.alignmentPlaybackTrackIndex !== null) {
		const runtime = ctx.runtimes[ctx.alignmentPlaybackTrackIndex];
		const trackDuration = runtime?.timing?.effectiveDuration;
		if (
			trackDuration !== undefined &&
			Number.isFinite(trackDuration) &&
			trackDuration > 0
		) {
			return ctx.currentPlaybackTrackPosition() >= trackDuration;
		}
	}

	return ctx.state.position >= ctx.longestDuration;
}

export function seekFromEvent(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	usePreviewSnippet: boolean,
	animate = false,
): void {
	const seekTimelineContext = ctx.getSeekTimelineContext(ctx.seekingElement);
	const metrics = getSeekMetrics(
		ctx.seekingElement,
		event,
		seekTimelineContext.duration,
	);
	if (!metrics) {
		return;
	}

	const newPosition = seekTimelineContext.toReferenceTime(metrics.time);
	// A seek on a surface with its own timeline means the spot that was
	// clicked, not the reference value it summarizes to — inside a stretch the
	// alignment holds at one reference value those are not the same place.
	const anchor = seekTimelineContext.toAnchor?.(metrics.time) ?? null;

	if (metrics.posXRel >= 0 && metrics.posXRel <= metrics.seekWidth) {
		if (ctx.state.playing) {
			ctx.dispatch({ type: "set-position", position: newPosition, anchor });
			ctx.stopAudio();
			ctx.startAudio(newPosition, usePreviewSnippet ? 0.03 : undefined);
		} else {
			ctx.dispatch({ type: "set-position", position: newPosition, anchor });
		}
	} else {
		ctx.dispatch({ type: "set-position", position: newPosition, anchor });
	}

	ctx.updateMainControls(animate);
}

export function findLongestDuration(ctx: TrackSwitchControllerImpl): number {
	let longest = 0;

	ctx.runtimes.forEach((runtime: TrackRuntime) => {
		const duration = (
			ctx.constructor as typeof TrackSwitchControllerImpl
		).getRuntimeDuration(runtime);

		if (duration > longest) {
			longest = duration;
		}
	});

	return longest;
}

export function handleError(
	ctx: TrackSwitchControllerImpl,
	message: string,
): void {
	ctx.isLoaded = false;
	ctx.isLoading = false;
	ctx.alignment = null;
	ctx.alignmentPlaybackTrackIndex = null;
	ctx.globalSyncEnabled = false;
	ctx.syncLockedTrackIndexes.clear();
	ctx.preSyncSoloStates = null;
	ctx.soloMode = "lists";

	ctx.stopAudio();

	if (ctx.resizeDebounceTimer) {
		clearTimeout(ctx.resizeDebounceTimer);
		ctx.resizeDebounceTimer = null;
	}
	if (ctx.waveformRenderFrameId !== null) {
		cancelAnimationFrame(ctx.waveformRenderFrameId);
		ctx.waveformRenderFrameId = null;
	}
	ctx.pinchZoomState = null;
	ctx.waveformMinimapDragState = null;
	ctx.sheetMusicEngine.destroy();
	ctx.renderer.destroyPianoRollDisplays();

	ctx.renderer.showError(message, ctx.runtimes);
	ctx.emit("error", { message: message });
}
