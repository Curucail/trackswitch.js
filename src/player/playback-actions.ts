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

export function load(ctx: TrackSwitchControllerImpl): Promise<void> {
	return async function (this: TrackSwitchControllerImpl) {
		if (this.isDestroyed || this.isLoaded || this.isLoading) {
			return;
		}

		this.isLoading = true;
		this.renderer.setOverlayLoading(true);
		try {
			const prepared = await this.audioEngine.prepareForPlaybackStart();
			if (!prepared) {
				this.isLoading = false;
				this.renderer.setOverlayLoading(false);
				this.handleError(
					"Web Audio API is not supported in your browser. Please consider upgrading.",
				);
				return;
			}

			if (!this.iOSPlaybackUnlocked) {
				this.iOSPlaybackUnlocked = true;
				await this.audioEngine.unlockIOSPlayback();
			}

			this.globalSyncEnabled = false;
			this.syncLockedTrackIndexes.clear();
			this.preSyncSoloStates = null;
			this.soloMode = "lists";

			this.runtimes.forEach((runtime: TrackRuntime) => {
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
				runtime.activeSource = null;
				runtime.sourceIndex = -1;
				runtime.activeVariant = "base";
				runtime.baseSource = {
					buffer: null,
					timing: null,
					sourceIndex: -1,
					sourceSampleRate: null,
					waveformSummary: null,
				};
				runtime.syncedSource = null;
				runtime.waveformSummary = null;
			});

			await this.audioEngine.loadTracks(this.runtimes);

			if (this.isDestroyed) {
				return;
			}

			this.runtimes.forEach((runtime: TrackRuntime) => {
				if (runtime.baseSource.buffer) {
					runtime.baseSource.waveformSummary =
						this.waveformEngine.createSummary(runtime.baseSource.buffer);
				}

				if (runtime.syncedSource?.buffer) {
					runtime.syncedSource.waveformSummary =
						this.waveformEngine.createSummary(runtime.syncedSource.buffer);
				}

				const activeSource =
					runtime.activeVariant === "synced"
						? runtime.syncedSource
						: runtime.baseSource;
				runtime.waveformSummary = activeSource
					? activeSource.waveformSummary
					: null;
			});

			this.isLoading = false;
			this.renderer.setOverlayLoading(false);

			const erroredTracks = this.runtimes.filter(
				(runtime: TrackRuntime) => runtime.errored,
			);

			if (erroredTracks.length > 0) {
				this.handleError("One or more audio files failed to load.");
				return;
			}

			this.longestDuration = this.findLongestDuration();
			this.alignment = null;
			this.alignmentPlaybackTrackIndex = null;

			// Every medium is parsed before the alignment resolves so it can read
			// their natural extents and unit conversions.
			await this.renderSheetMusic();

			if (this.isDestroyed) {
				return;
			}

			await this.renderer.loadMidiSources();

			if (this.isDestroyed) {
				return;
			}

			if (this.alignmentConfig) {
				const alignmentError = await this.initializeAlignmentMode();
				if (alignmentError) {
					this.handleError(alignmentError);
					return;
				}
			} else {
				// No alignment resolves the media profiles, so probe them here — but
				// only for a `media.timelineUnit`, the one thing left that needs a
				// conversion out of seconds.
				this.mediaProfiles = resolveImplicitTimelineUnit(this.media)
					? await probeMediaProfiles({
							media: this.media,
							runtimes: this.runtimes,
							midiBySource: this.renderer.getLoadedMidiBySource(),
							measuresByMediaId:
								this.sheetMusicEngine.getAvailableMeasuresByMediaId(),
						})
					: new Map();
				applyReferenceReadoutUnit(this);
			}

			if (this.isDestroyed) {
				return;
			}

			await this.attachSheetMusicMeasureMaps();

			if (this.isDestroyed) {
				return;
			}

			const alignment = this.alignment as ResolvedAlignment | null;
			this.markerSets = await loadMarkerSets(
				this.markersConfig,
				alignment,
				this.media,
				alignment?.profiles ?? this.mediaProfiles,
				this.longestDuration,
			);

			if (this.isDestroyed) {
				return;
			}

			await this.renderer.initializeMidiDisplays(
				this.longestDuration,
				this.isAlignmentMode(),
			);

			if (this.isDestroyed) {
				return;
			}

			this.isLoaded = true;
			this.renderer.hideOverlayOnLoaded();

			this.updateMainControls();
			this.applyTrackProperties();

			this.emit("loaded", {
				longestDuration: this.longestDuration,
			});
		} catch (error) {
			if (this.isDestroyed) {
				return;
			}

			this.isLoading = false;
			this.renderer.setOverlayLoading(false);
			this.handleError(getLoadErrorMessage(error));
		}
	}.call(ctx);
}

export function destroy(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.isDestroyed) {
			return;
		}
		this.isDestroyed = true;

		if (this.timerMonitorPosition) {
			clearInterval(this.timerMonitorPosition);
			this.timerMonitorPosition = null;
		}
		if (this.resizeDebounceTimer) {
			clearTimeout(this.resizeDebounceTimer);
			this.resizeDebounceTimer = null;
		}
		if (this.waveformRenderFrameId !== null) {
			cancelAnimationFrame(this.waveformRenderFrameId);
			this.waveformRenderFrameId = null;
		}
		this.seekingElement = null;
		this.rightClickDragging = false;
		this.loopDragStart = null;
		this.draggingMarker = null;
		this.pinchZoomState = null;
		this.pendingWaveformTouchSeek = null;
		this.waveformMinimapDragState = null;

		if (this.state.playing) {
			this.stopAudio();
		}

		this.inputBinder.unbind();
		this.sheetMusicEngine.destroy();
		this.renderer.destroy();
		this.audioEngine.disconnect();

		this.listeners.loaded.clear();
		this.listeners.error.clear();
		this.listeners.position.clear();
		this.listeners.trackState.clear();

		unregisterController(this);
	}).call(ctx);
}

export function togglePlay(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.state.playing) {
			this.pause();
		} else {
			this.play();
		}
	}).call(ctx);
}

export function play(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.isDestroyed || !this.isLoaded) {
			return;
		}
		if (this.state.playing) {
			return;
		}

		let startPosition = this.state.position;

		if (this.hasReachedPlaybackEnd()) {
			startPosition = 0;
		}

		if (
			this.navigationBar?.controls.includes("looping") &&
			this.state.loop.enabled &&
			this.state.loop.pointA !== null &&
			this.state.loop.pointB !== null &&
			(this.state.position < this.state.loop.pointA ||
				this.state.position > this.state.loop.pointB)
		) {
			startPosition = this.state.loop.pointA;
		}

		this.startAudio(startPosition);
		this.pauseOthers();
		this.dispatch({ type: "set-playing", playing: true });
		this.updatePlaybackPositionUi();
	}).call(ctx);
}

export function pause(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (!this.state.playing) {
			return;
		}

		const position = this.currentPlaybackReferencePosition();
		const anchor = this.currentPlaybackAnchor();
		this.stopAudio();

		this.dispatch({ type: "set-position", position: position, anchor: anchor });
		this.dispatch({ type: "set-playing", playing: false });

		this.updateMainControls();
	}).call(ctx);
}

export function stop(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.state.playing) {
			this.stopAudio();
		}

		this.dispatch({ type: "set-position", position: 0 });
		this.dispatch({ type: "set-playing", playing: false });
		this.updateMainControls();
	}).call(ctx);
}

export function seekTo(ctx: TrackSwitchControllerImpl, seconds: number): void {
	(function (this: TrackSwitchControllerImpl, seconds: number) {
		const nextPosition = clamp(seconds, 0, this.longestDuration);

		if (this.state.playing) {
			this.stopAudio();
			this.startAudio(nextPosition);
		} else {
			this.dispatch({ type: "set-position", position: nextPosition });
		}

		this.updateMainControls();
	}).call(ctx, seconds);
}

export function seekRelative(
	ctx: TrackSwitchControllerImpl,
	seconds: number,
): void {
	(function (this: TrackSwitchControllerImpl, seconds: number) {
		let nextPosition = this.state.position + seconds;
		nextPosition = clamp(nextPosition, 0, this.longestDuration);

		if (
			this.navigationBar?.controls.includes("looping") &&
			this.state.loop.enabled &&
			this.state.loop.pointA !== null &&
			this.state.loop.pointB !== null
		) {
			const loopStart = this.state.loop.pointA;
			const loopEnd = this.state.loop.pointB;
			const loopLength = loopEnd - loopStart;
			if (loopLength > 0) {
				let relative = nextPosition - loopStart;
				relative = ((relative % loopLength) + loopLength) % loopLength;
				nextPosition = loopStart + relative;
			}
		}

		if (this.state.playing) {
			this.stopAudio();
			this.startAudio(nextPosition);
		} else {
			this.dispatch({ type: "set-position", position: nextPosition });
		}

		this.updateMainControls();
	}).call(ctx, seconds);
}

export function setRepeat(
	ctx: TrackSwitchControllerImpl,
	enabled: boolean,
): void {
	(function (this: TrackSwitchControllerImpl, enabled: boolean) {
		this.dispatch({ type: "set-repeat", enabled: enabled });
		this.updateMainControls();
	}).call(ctx, enabled);
}

export function setVolume(
	ctx: TrackSwitchControllerImpl,
	volumeZeroToOne: number,
): void {
	(function (this: TrackSwitchControllerImpl, volumeZeroToOne: number) {
		if (!this.navigationBar?.controls.includes("globalVolume")) {
			this.dispatch({ type: "set-volume", volume: 1 });
			this.audioEngine.setMasterVolume(1);
			this.renderer.setVolumeSlider(1);
			return;
		}

		this.dispatch({ type: "set-volume", volume: volumeZeroToOne });
		this.audioEngine.setMasterVolume(this.state.volume);
		this.renderer.setVolumeSlider(this.state.volume);
	}).call(ctx, volumeZeroToOne);
}

export function setTrackVolume(
	ctx: TrackSwitchControllerImpl,
	trackIndex: number,
	volumeZeroToOne: number,
): void {
	(function (
		this: TrackSwitchControllerImpl,
		trackIndex: number,
		volumeZeroToOne: number,
	) {
		if (
			!Number.isInteger(trackIndex) ||
			trackIndex < 0 ||
			trackIndex >= this.runtimes.length
		) {
			return;
		}

		if (this.isTrackSyncLocked(trackIndex)) {
			return;
		}

		const runtime = this.runtimes[trackIndex];
		runtime.state.volume = clamp(volumeZeroToOne, 0, 1);
		this.applyTrackProperties();
	}).call(ctx, trackIndex, volumeZeroToOne);
}

export function setTrackPan(
	ctx: TrackSwitchControllerImpl,
	trackIndex: number,
	panMinusOneToOne: number,
): void {
	(function (
		this: TrackSwitchControllerImpl,
		trackIndex: number,
		panMinusOneToOne: number,
	) {
		if (
			!Number.isInteger(trackIndex) ||
			trackIndex < 0 ||
			trackIndex >= this.runtimes.length
		) {
			return;
		}

		if (this.isTrackSyncLocked(trackIndex)) {
			return;
		}

		const runtime = this.runtimes[trackIndex];
		runtime.state.pan = this.audioEngine.supportsStereoPanning()
			? clamp(panMinusOneToOne, -1, 1)
			: 0;
		this.applyTrackProperties();
	}).call(ctx, trackIndex, panMinusOneToOne);
}

export function setLoopPoint(
	ctx: TrackSwitchControllerImpl,
	marker: LoopMarker,
): boolean {
	return function (this: TrackSwitchControllerImpl, marker: LoopMarker) {
		if (!this.navigationBar?.controls.includes("looping")) {
			return false;
		}

		const position = this.state.playing
			? this.currentPlaybackReferencePosition()
			: this.state.position;
		const currentPoint =
			marker === "A" ? this.state.loop.pointA : this.state.loop.pointB;
		if (
			currentPoint !== null &&
			Math.abs(currentPoint - position) < this.loopMinDistance
		) {
			this.state = {
				...this.state,
				loop: {
					...this.state.loop,
					enabled: false,
					pointA: marker === "A" ? null : this.state.loop.pointA,
					pointB: marker === "B" ? null : this.state.loop.pointB,
				},
			};
			this.updateMainControls();
			return false;
		}

		this.dispatch({
			type: "set-loop-point",
			marker: marker,
			position: position,
			minDistance: this.loopMinDistance,
		});

		const nextPoint =
			marker === "A" ? this.state.loop.pointA : this.state.loop.pointB;
		if (nextPoint === null) {
			this.updateMainControls();
			return false;
		}

		if (this.state.loop.pointA !== null && this.state.loop.pointB !== null) {
			const loopA = this.state.loop.pointA;
			const loopB = this.state.loop.pointB;
			activateLoopRange(this, loopA, loopB);
		}

		this.updateMainControls();
		return true;
	}.call(ctx, marker);
}

export function activateLoopRange(
	ctx: TrackSwitchControllerImpl,
	loopA: number,
	loopB: number,
): void {
	(function (this: TrackSwitchControllerImpl, loopA: number, loopB: number) {
		this.state = {
			...this.state,
			loop: {
				...this.state.loop,
				enabled: true,
			},
		};

		if (
			this.state.playing &&
			(this.state.position < loopA || this.state.position > loopB)
		) {
			this.stopAudio();
			this.startAudio(loopA);
		}
	}).call(ctx, loopA, loopB);
}

export function toggleLoop(ctx: TrackSwitchControllerImpl): boolean {
	return function (this: TrackSwitchControllerImpl) {
		if (!this.navigationBar?.controls.includes("looping")) {
			return false;
		}

		if (this.state.loop.pointA === null || this.state.loop.pointB === null) {
			return false;
		}

		this.dispatch({ type: "toggle-loop" });

		if (
			this.state.loop.enabled &&
			this.state.loop.pointA !== null &&
			this.state.loop.pointB !== null &&
			(this.state.position < this.state.loop.pointA ||
				this.state.position > this.state.loop.pointB)
		) {
			if (this.state.playing) {
				this.stopAudio();
				this.startAudio(this.state.loop.pointA);
			} else {
				this.dispatch({
					type: "set-position",
					position: this.state.loop.pointA,
				});
			}
		}

		this.updateMainControls();
		return true;
	}.call(ctx);
}

export function clearLoop(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		this.dispatch({ type: "clear-loop" });
		this.rightClickDragging = false;
		this.loopDragStart = null;
		this.draggingMarker = null;
		this.updateMainControls();
	}).call(ctx);
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
	(function (
		this: TrackSwitchControllerImpl,
		trackIndex: number,
		exclusive: boolean,
		groupIndex: number | undefined,
	) {
		const runtime = this.runtimes[trackIndex];
		if (!runtime) {
			return;
		}

		if (this.isTrackSyncLocked(trackIndex)) {
			return;
		}

		const resolvedGroupIndex =
			groupIndex ?? this.groupIndexForTrack(trackIndex);
		const previousUnitIndex = this.activeSoloUnitIndex();

		if (this.soloMode === "alignment") {
			toggleSoloWithinAlignment(
				this,
				trackIndex,
				resolvedGroupIndex,
				exclusive,
			);
		} else {
			const singleSoloMode =
				exclusive || this.isGroupExclusive(resolvedGroupIndex);
			const currentState = runtime.state.solo;

			if (singleSoloMode) {
				this.trackIndexesInSoloScope(resolvedGroupIndex).forEach(
					(index: number) => {
						this.runtimes[index].state.solo = false;
					},
				);
			}

			runtime.state.solo =
				singleSoloMode && currentState ? true : !currentState;
		}

		this.applyTrackProperties();
		this.finishSoloUnitSwitch(previousUnitIndex);
	}).call(ctx, trackIndex, exclusive, groupIndex);
}

export function applyPreset(
	ctx: TrackSwitchControllerImpl,
	presetId: string,
): void {
	(function (this: TrackSwitchControllerImpl, presetId: string) {
		const preset = this.presets[presetId];
		if (!preset) {
			return;
		}

		const trackIds = new Set(preset.tracks);
		this.runtimes.forEach((runtime: TrackRuntime) => {
			runtime.state.solo = trackIds.has(runtime.definition.id);
		});

		// A preset may name more than the current mode can play at once — an
		// exclusive list then keeps the first of its named tracks, and alignment
		// keeps the first named solo unit.
		this.collapseToSingleSelection();

		this.applyTrackProperties();
	}).call(ctx, presetId);
}

/** Phase A — render the scores; their measure extents feed alignment resolution. */
export function renderSheetMusic(
	ctx: TrackSwitchControllerImpl,
): Promise<void> {
	return async function (this: TrackSwitchControllerImpl) {
		const hosts = this.renderer.getPreparedSheetMusicHosts();

		if (hosts.length === 0) {
			this.sheetMusicEngine.destroy();
			return;
		}

		await this.sheetMusicEngine.initialize(hosts);
	}.call(ctx);
}

/** Phase B — attach the alignment-derived measure maps to the rendered scores. */
export function attachSheetMusicMeasureMaps(
	ctx: TrackSwitchControllerImpl,
): Promise<void> {
	return async function (this: TrackSwitchControllerImpl) {
		if (this.sheetMusicEngine.entries.length === 0) {
			return;
		}

		await this.sheetMusicEngine.attachMeasureMaps(
			(measureColumn: string, source: string) =>
				this.buildSheetMusicMeasureMaps(measureColumn, source),
		);
		this.sheetMusicEngine.updatePosition(
			this.state.position,
			this.isSyncReferenceAxisActive(),
		);
	}.call(ctx);
}

export function dispatch(
	ctx: TrackSwitchControllerImpl,
	action: PlayerAction,
): void {
	(function (this: TrackSwitchControllerImpl, action: PlayerAction) {
		this.state = playerStateReducer(this.state, action);
		// Position and loop points are reference-timeline coordinates.
		const positionTimeline = playerTimeline(this.alignment);
		if (action.type === "set-position") {
			this.runtimeMarkers = moveRuntimeMarker(
				this.runtimeMarkers,
				"playhead",
				positionTimeline,
				this.state.position,
			);
		} else if (action.type === "set-loop-point") {
			this.runtimeMarkers = moveRuntimeMarker(
				this.runtimeMarkers,
				action.marker === "A" ? "loopA" : "loopB",
				positionTimeline,
				action.marker === "A" ? this.state.loop.pointA : this.state.loop.pointB,
			);
		} else if (action.type === "clear-loop") {
			this.runtimeMarkers = moveRuntimeMarker(
				this.runtimeMarkers,
				"loopA",
				positionTimeline,
				null,
			);
			this.runtimeMarkers = moveRuntimeMarker(
				this.runtimeMarkers,
				"loopB",
				positionTimeline,
				null,
			);
		}
	}).call(ctx, action);
}

export function pauseOthers(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (!this.features.muteOtherPlayerInstances) {
			return;
		}

		pauseOtherControllers(this);
	}).call(ctx);
}

export function startAudio(
	ctx: TrackSwitchControllerImpl,
	newPosition: number | undefined,
	snippetDuration: number | undefined,
): void {
	(function (
		this: TrackSwitchControllerImpl,
		newPosition: number | undefined,
		snippetDuration: number | undefined,
	) {
		const requestedPosition =
			typeof newPosition === "number" ? newPosition : this.state.position;
		let enginePosition = requestedPosition;
		let nextReferencePosition = requestedPosition;
		let nextAnchor: PlaybackAnchor | null = null;

		if (this.isAlignmentMode() && this.alignment) {
			const activeTrackIndex = this.getAlignmentPlaybackTrackIndex();
			if (activeTrackIndex < 0) {
				return;
			}

			// An anchor for this position already says where on this track to start;
			// re-deriving it from the reference would round it to the edge of any
			// stretch the alignment holds at one reference value.
			enginePosition =
				this.trackPlaybackPosition(activeTrackIndex, requestedPosition) ??
				this.referenceToTrackTime(activeTrackIndex, requestedPosition);
			nextReferencePosition = this.trackToReferenceTime(
				activeTrackIndex,
				enginePosition,
				requestedPosition,
			);
			this.alignmentPlaybackTrackIndex = activeTrackIndex;
			nextAnchor = this.trackPlaybackAnchor(activeTrackIndex, enginePosition);
		} else {
			this.alignmentPlaybackTrackIndex = null;
		}

		const startResult = this.audioEngine.start(
			this.runtimes,
			enginePosition,
			snippetDuration,
		);
		if (!startResult) {
			this.alignmentPlaybackTrackIndex = null;
			return;
		}

		this.dispatch({
			type: "set-position",
			position: clamp(nextReferencePosition, 0, this.longestDuration),
			anchor: nextAnchor,
		});
		this.dispatch({ type: "set-start-time", startTime: startResult.startTime });

		if (this.timerMonitorPosition) {
			clearInterval(this.timerMonitorPosition);
		}

		this.timerMonitorPosition = setInterval(() => {
			this.monitorPosition();
		}, 16);
	}).call(ctx, newPosition, snippetDuration);
}

export function stopAudio(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		this.audioEngine.stop(this.runtimes);
		this.alignmentPlaybackTrackIndex = null;
		if (this.timerMonitorPosition) {
			clearInterval(this.timerMonitorPosition);
			this.timerMonitorPosition = null;
		}
	}).call(ctx);
}

export function monitorPosition(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.isDestroyed) {
			return;
		}

		if (this.state.playing && !this.state.currentlySeeking) {
			const currentPosition = this.currentPlaybackReferencePosition();
			this.dispatch({
				type: "set-position",
				position: currentPosition,
				anchor: this.currentPlaybackAnchor(),
			});
		}

		if (
			this.navigationBar?.controls.includes("looping") &&
			this.state.loop.enabled &&
			this.state.loop.pointB !== null &&
			this.state.position >= this.state.loop.pointB &&
			!this.state.currentlySeeking
		) {
			this.stopAudio();
			this.startAudio(this.state.loop.pointA ?? 0);
			return;
		}

		// Playback ends when the selected audio runs out. It can omit the final
		// reference occurrence and therefore end before the reference extent.
		if (this.hasReachedPlaybackEnd() && !this.state.currentlySeeking) {
			this.stopAudio();

			if (this.state.repeat) {
				this.dispatch({ type: "set-position", position: 0 });
				this.startAudio(0);
				this.dispatch({ type: "set-playing", playing: true });
			} else {
				this.dispatch({ type: "set-playing", playing: false });
			}
		}

		this.updateMainControls();
	}).call(ctx);
}

/**
 * True once there is nothing left to play. In alignment mode that is decided by
 * the lead track's own duration, so a recording keeps sounding through material
 * the alignment does not cover; otherwise the shared duration decides.
 */
export function hasReachedPlaybackEnd(ctx: TrackSwitchControllerImpl): boolean {
	return function (this: TrackSwitchControllerImpl): boolean {
		if (this.isAlignmentMode() && this.alignmentPlaybackTrackIndex !== null) {
			const runtime = this.runtimes[this.alignmentPlaybackTrackIndex];
			const trackDuration = runtime?.timing?.effectiveDuration;
			if (
				trackDuration !== undefined &&
				Number.isFinite(trackDuration) &&
				trackDuration > 0
			) {
				return this.currentPlaybackTrackPosition() >= trackDuration;
			}
		}

		return this.state.position >= this.longestDuration;
	}.call(ctx);
}

export function seekFromEvent(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	usePreviewSnippet: boolean,
): void {
	(function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
		usePreviewSnippet: boolean,
	) {
		const seekTimelineContext = this.getSeekTimelineContext(
			this.seekingElement,
		);
		const metrics = getSeekMetrics(
			this.seekingElement,
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
			if (this.state.playing) {
				this.dispatch({ type: "set-position", position: newPosition, anchor });
				this.stopAudio();
				this.startAudio(newPosition, usePreviewSnippet ? 0.03 : undefined);
			} else {
				this.dispatch({ type: "set-position", position: newPosition, anchor });
			}
		} else {
			this.dispatch({ type: "set-position", position: newPosition, anchor });
		}

		this.updateMainControls();
	}).call(ctx, event, usePreviewSnippet);
}

export function findLongestDuration(ctx: TrackSwitchControllerImpl): number {
	return function (this: TrackSwitchControllerImpl) {
		let longest = 0;

		this.runtimes.forEach((runtime: TrackRuntime) => {
			const duration = (
				ctx.constructor as typeof TrackSwitchControllerImpl
			).getRuntimeDuration(runtime);

			if (duration > longest) {
				longest = duration;
			}
		});

		return longest;
	}.call(ctx);
}

export function handleError(
	ctx: TrackSwitchControllerImpl,
	message: string,
): void {
	(function (this: TrackSwitchControllerImpl, message: string) {
		this.isLoaded = false;
		this.isLoading = false;
		this.alignment = null;
		this.alignmentPlaybackTrackIndex = null;
		this.globalSyncEnabled = false;
		this.syncLockedTrackIndexes.clear();
		this.preSyncSoloStates = null;
		this.soloMode = "lists";

		this.stopAudio();

		if (this.resizeDebounceTimer) {
			clearTimeout(this.resizeDebounceTimer);
			this.resizeDebounceTimer = null;
		}
		if (this.waveformRenderFrameId !== null) {
			cancelAnimationFrame(this.waveformRenderFrameId);
			this.waveformRenderFrameId = null;
		}
		this.pinchZoomState = null;
		this.waveformMinimapDragState = null;
		this.sheetMusicEngine.destroy();
		this.renderer.destroyMidiDisplays();

		this.renderer.showError(message, this.runtimes);
		this.emit("error", { message: message });
	}).call(ctx, message);
}
