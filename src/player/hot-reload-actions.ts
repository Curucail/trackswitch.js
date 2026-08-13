import { normalizeTrackSwitchConfig } from "../config/normalize-init";
import type { ViewNormalizeContext } from "../config/ui-elements";
import {
	applyInitialGroupSolos,
	applyTrackPanAlgorithms,
	buildTrackGroups,
	createTrackRuntime,
	resetDisabledTrackVolumeControls,
} from "../domain/runtime";
import { createInitialPlayerState } from "../domain/state";
import type {
	NormalizedTrackSwitchConfig,
	ResolvedAlignment,
	TrackListGroup,
	TrackRuntime,
	TrackSwitchFeatures,
	TrackSwitchInit,
	TrackSwitchWarpingMatrixViewConfig,
} from "../domain/types";
import { clamp } from "../shared/math";
import { resolveImplicitTimelineUnit } from "../timeline/media-profile";
import { applyReferenceReadoutUnit } from "./alignment-actions";
import { buildResolvedAlignment } from "./alignment-context";
import { loadMarkerSets } from "./marker-sets";
import { probeMediaProfiles } from "./media-profiles";
import type { TrackSwitchControllerImpl } from "./player-controller";
import {
	detachPreservableSheetMusicViews,
	rebindPreservedSheetMusicViews,
	restorePreservedSheetMusicViews,
} from "./sheet-music-hot-reload";

function buildPresetEntries(
	config: NormalizedTrackSwitchConfig,
): Array<{ id: string; label: string }> {
	return Object.entries(config.presets).map(([id, preset]) => ({
		id,
		label: preset.label ?? id,
	}));
}

function buildViewContext(
	config: NormalizedTrackSwitchConfig,
): ViewNormalizeContext {
	return {
		media: config.media,
		trackIds: config.tracks.map((track) => track.id),
		markerSetIds: new Set(Object.keys(config.markers)),
		hasAlignment: !!config.alignment,
		alignmentTimelines: new Set(
			config.alignment ? Object.keys(config.alignment.timelines) : [],
		),
	};
}

function createRuntimes(
	config: NormalizedTrackSwitchConfig,
	trackGroups: TrackListGroup[],
): TrackRuntime[] {
	const runtimes = config.tracks.map((track, index) =>
		createTrackRuntime(track, index),
	);

	applyInitialGroupSolos(runtimes, trackGroups);

	return runtimes;
}

function configsMatch(left: unknown, right: unknown): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function canReuseLoadedRuntimes(
	controller: TrackSwitchControllerImpl,
	config: NormalizedTrackSwitchConfig,
): boolean {
	return (
		configsMatch(
			controller.runtimes.map((runtime) => runtime.definition),
			config.tracks,
		) && configsMatch(controller.alignmentConfig, config.alignment)
	);
}

function applyFeatures(
	target: TrackSwitchFeatures,
	source: TrackSwitchFeatures,
): void {
	(Object.keys(source) as Array<keyof TrackSwitchFeatures>).forEach((key) => {
		target[key] = source[key];
	});
}

function resetTransientInteractionState(
	controller: TrackSwitchControllerImpl,
): void {
	if (controller.resizeDebounceTimer) {
		clearTimeout(controller.resizeDebounceTimer);
		controller.resizeDebounceTimer = null;
	}
	if (controller.waveformRenderFrameId !== null) {
		cancelAnimationFrame(controller.waveformRenderFrameId);
		controller.waveformRenderFrameId = null;
	}

	controller.seekingElement = null;
	controller.rightClickDragging = false;
	controller.loopDragStart = null;
	controller.draggingMarker = null;
	controller.pinchZoomState = null;
	controller.pendingWaveformTouchSeek = null;
	controller.waveformMinimapDragState = null;
	controller.shortcutHelpOpen = false;
	controller.markerNavigationDialogOpen = false;
	controller.fullscreen = false;
}

function applyFirstPresetOrTrackProperties(
	controller: TrackSwitchControllerImpl,
): void {
	const firstPresetId = Object.keys(controller.presets)[0];
	if (firstPresetId) {
		controller.applyPreset(firstPresetId);
	} else {
		controller.applyTrackProperties();
	}
}

interface TimelineZoomState {
	zoom: number;
	viewportStart: number;
}

interface PlayerZoomState {
	waveforms: TimelineZoomState[];
	midi: TimelineZoomState[];
}

function captureZoomState(
	controller: TrackSwitchControllerImpl,
): PlayerZoomState {
	return {
		waveforms: controller.renderer.waveformSeekSurfaces.map((surface) => ({
			zoom: surface.zoom,
			viewportStart:
				controller.renderer.getWaveformMinimapViewport(surface.seekWrap)
					?.startRatio ?? 0,
		})),
		midi: controller.renderer.midiSeekSurfaces.map((surface) => ({
			zoom: surface.zoom,
			viewportStart:
				controller.renderer.getMidiMinimapViewport(surface.seekWrap)
					?.startRatio ?? 0,
		})),
	};
}

function restoreZoomState(
	controller: TrackSwitchControllerImpl,
	zoomState: PlayerZoomState,
): void {
	zoomState.waveforms.forEach((state, index) => {
		const surface = controller.renderer.waveformSeekSurfaces[index];
		if (!surface) return;
		const duration = controller.getSeekTimelineContext(
			surface.seekWrap,
		).duration;
		controller.renderer.setWaveformZoom(surface.seekWrap, state.zoom, duration);
		controller.renderer.setWaveformMinimapViewportStart(
			surface.seekWrap,
			state.viewportStart,
		);
	});

	zoomState.midi.forEach((state, index) => {
		const surface = controller.renderer.midiSeekSurfaces[index];
		if (!surface) return;
		const duration = controller.getSeekTimelineContext(
			surface.seekWrap,
		).duration;
		controller.renderer.setMidiZoom(surface.seekWrap, state.zoom, duration);
		controller.renderer.setMidiMinimapViewportStart(
			surface.seekWrap,
			state.viewportStart,
		);
	});
}

function restoreAudioPreservingState(
	controller: TrackSwitchControllerImpl,
	previousPosition: number,
	wasPlaying: boolean,
): void {
	controller.state.position = clamp(
		previousPosition,
		0,
		controller.longestDuration,
	);
	controller.audioEngine.setMasterVolume(controller.state.volume);
	controller.renderer.setVolumeSlider(controller.state.volume);

	applyFirstPresetOrTrackProperties(controller);

	if (wasPlaying) {
		controller.startAudio(controller.state.position);
		controller.dispatch({ type: "set-playing", playing: true });
	}

	controller.updateMainControls();
	controller.emit("loaded", { longestDuration: controller.longestDuration });
}

async function applyAudioPreservingConfig(
	controller: TrackSwitchControllerImpl,
	config: NormalizedTrackSwitchConfig,
	features: TrackSwitchFeatures,
	zoomState: PlayerZoomState,
): Promise<void> {
	const wasPlaying = controller.state.playing;
	const previousPosition = wasPlaying
		? controller.currentPlaybackReferencePosition()
		: controller.state.position;

	if (wasPlaying) {
		controller.stopAudio();
	}

	resetTransientInteractionState(controller);
	const preservedSheetMusic = detachPreservableSheetMusicViews(
		controller,
		config,
	);
	if (!preservedSheetMusic) {
		controller.sheetMusicEngine.destroy();
	}
	controller.renderer.destroy();
	controller.inputBinder.unbind();
	applyFeatures(controller.features, features);

	controller.renderer.renderViews(config.views, buildViewContext(config));
	if (preservedSheetMusic) {
		restorePreservedSheetMusicViews(controller, preservedSheetMusic);
	}

	controller.presets = config.presets;
	controller.navigationBar =
		config.views.find((view) => view.type === "navigationBar") ?? null;
	controller.warpingMatrixView =
		(config.views.find((view) => view.type === "warpingMatrix") as
			| TrackSwitchWarpingMatrixViewConfig
			| undefined) ?? null;
	controller.audioEngine.setGlobalVolumeEnabled(
		!!controller.navigationBar?.controls.includes("globalVolume"),
	);
	controller.media = config.media;
	controller.markersConfig = config.markers;
	const trackGroups = buildTrackGroups(config.views);
	controller.trackGroups = trackGroups;
	applyTrackPanAlgorithms(controller.runtimes, trackGroups);
	resetDisabledTrackVolumeControls(controller.runtimes, trackGroups);
	controller.audioEngine.refreshPanningGraph(controller.runtimes);
	controller.renderer.updateConfig(
		buildPresetEntries(config),
		trackGroups,
		config.css,
	);
	controller.soloMode = "lists";
	controller.trackListSoloMemory.clear();

	controller.renderer.initialize(controller.runtimes);
	if (preservedSheetMusic) {
		rebindPreservedSheetMusicViews(controller, preservedSheetMusic);
	}
	controller.renderer.hideOverlayOnLoaded();
	controller.inputBinder.bind();
	controller.longestDuration = controller.findLongestDuration();

	if (controller.alignment) {
		controller.longestDuration = controller.alignment.referenceExtent.end;
	}
	controller.restoreSoloMode();

	controller.markerSets = await loadMarkerSets(
		controller.markersConfig,
		controller.alignment,
		controller.media,
		controller.alignment?.profiles ?? controller.mediaProfiles,
		controller.longestDuration,
	);

	restoreAudioPreservingState(controller, previousPosition, wasPlaying);
	if (!preservedSheetMusic) {
		await controller.renderSheetMusic();
	}
	await controller.attachSheetMusicMeasureMaps();
	await controller.renderer.initializeMidiDisplays(
		controller.longestDuration,
		controller.isAlignmentMode(),
	);
	restoreZoomState(controller, zoomState);
	controller.updateMainControls();
}

function getHotReloadErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}

	const fallback = String(error ?? "").trim();
	return fallback && fallback !== "[object Object]"
		? fallback
		: "Unexpected error while updating TrackSwitch.";
}

async function updateConfigNow(
	controller: TrackSwitchControllerImpl,
	nextInit: TrackSwitchInit,
): Promise<void> {
	if (controller.isDestroyed) {
		throw new Error("TrackSwitch controller has already been destroyed.");
	}
	if (!controller.isLoaded) {
		throw new Error(
			"TrackSwitch hot reload requires the player to be loaded first.",
		);
	}

	let stagedRuntimes: TrackRuntime[] | null = null;
	let committed = false;

	try {
		const nextConfig = normalizeTrackSwitchConfig(nextInit);
		const nextFeatures = nextConfig.features;
		const zoomState = captureZoomState(controller);

		if (canReuseLoadedRuntimes(controller, nextConfig)) {
			await applyAudioPreservingConfig(
				controller,
				nextConfig,
				nextFeatures,
				zoomState,
			);
			return;
		}

		const nextTrackGroups = buildTrackGroups(nextConfig.views);
		const nextRuntimes = createRuntimes(nextConfig, nextTrackGroups);
		applyTrackPanAlgorithms(nextRuntimes, nextTrackGroups);
		resetDisabledTrackVolumeControls(nextRuntimes, nextTrackGroups);
		stagedRuntimes = nextRuntimes;
		await controller.audioEngine.loadTracks(nextRuntimes);

		nextRuntimes.forEach((runtime: TrackRuntime) => {
			if (runtime.baseSource.buffer) {
				runtime.baseSource.waveformSummary =
					controller.waveformEngine.createSummary(runtime.baseSource.buffer);
			}

			if (runtime.syncedSource?.buffer) {
				runtime.syncedSource.waveformSummary =
					controller.waveformEngine.createSummary(runtime.syncedSource.buffer);
			}

			const activeSource =
				runtime.activeVariant === "synced"
					? runtime.syncedSource
					: runtime.baseSource;
			runtime.waveformSummary = activeSource
				? activeSource.waveformSummary
				: null;
		});

		const erroredTracks = nextRuntimes.filter((runtime) => runtime.errored);
		if (erroredTracks.length > 0) {
			controller.audioEngine.disconnectRuntimes(nextRuntimes);
			throw new Error("One or more audio files failed to load.");
		}

		// The new views are not rendered yet, so scores cannot be measured here;
		// their profile falls back to the CSV extent, which is harmless because a
		// A score needs no unit conversion and never supplies the audio clock.
		const stagedProfiles =
			nextConfig.alignment || resolveImplicitTimelineUnit(nextConfig.media)
				? await probeMediaProfiles({
						media: nextConfig.media,
						runtimes: nextRuntimes,
						midiBySource: controller.renderer.getLoadedMidiBySource(),
					})
				: new Map();
		const stagedAlignment: ResolvedAlignment | null = nextConfig.alignment
			? await buildResolvedAlignment(
					nextConfig.alignment,
					nextConfig.media,
					stagedProfiles,
				)
			: null;
		const stagedLongestDuration = stagedAlignment
			? stagedAlignment.referenceExtent.end
			: nextRuntimes.reduce(
					(longest, runtime) =>
						Math.max(
							longest,
							runtime.timing?.effectiveDuration ??
								runtime.buffer?.duration ??
								0,
						),
					0,
				);
		const stagedMarkerSets = await loadMarkerSets(
			nextConfig.markers,
			stagedAlignment,
			nextConfig.media,
			stagedAlignment?.profiles ?? stagedProfiles,
			stagedLongestDuration,
		);

		const wasPlaying = controller.state.playing;
		const previousPosition = wasPlaying
			? controller.currentPlaybackReferencePosition()
			: controller.state.position;
		const previousLoop = { ...controller.state.loop };
		const previousRepeat = controller.state.repeat;
		const previousVolume = controller.state.volume;
		const oldRuntimes = controller.runtimes;

		if (wasPlaying) {
			controller.stopAudio();
		}
		controller.audioEngine.disconnectRuntimes(oldRuntimes);
		committed = true;
		resetTransientInteractionState(controller);
		const preservedSheetMusic = detachPreservableSheetMusicViews(
			controller,
			nextConfig,
		);
		if (!preservedSheetMusic) {
			controller.sheetMusicEngine.destroy();
		}
		controller.renderer.destroy();
		controller.inputBinder.unbind();
		applyFeatures(controller.features, nextFeatures);

		controller.renderer.renderViews(
			nextConfig.views,
			buildViewContext(nextConfig),
		);
		if (preservedSheetMusic) {
			restorePreservedSheetMusicViews(controller, preservedSheetMusic);
		}

		controller.runtimes = nextRuntimes;
		controller.media = nextConfig.media;
		controller.presets = nextConfig.presets;
		controller.navigationBar =
			nextConfig.views.find((view) => view.type === "navigationBar") ?? null;
		controller.warpingMatrixView =
			(nextConfig.views.find((view) => view.type === "warpingMatrix") as
				| TrackSwitchWarpingMatrixViewConfig
				| undefined) ?? null;
		controller.audioEngine.setGlobalVolumeEnabled(
			!!controller.navigationBar?.controls.includes("globalVolume"),
		);
		controller.markersConfig = nextConfig.markers;
		controller.markerSets = stagedMarkerSets;
		controller.trackGroups = nextTrackGroups;
		controller.renderer.updateConfig(
			buildPresetEntries(nextConfig),
			nextTrackGroups,
			nextConfig.css,
		);
		controller.alignmentConfig = nextConfig.alignment;
		controller.alignment = stagedAlignment;
		controller.mediaProfiles = stagedAlignment ? new Map() : stagedProfiles;
		applyReferenceReadoutUnit(controller);
		controller.alignmentPlaybackTrackIndex = null;
		controller.globalSyncEnabled = false;
		controller.syncLockedTrackIndexes.clear();
		controller.preSyncSoloStates = null;
		controller.soloMode = "lists";
		controller.trackListSoloMemory.clear();
		controller.audioDownloadSizeRequest = null;
		controller.audioDownloadSizeInfo = {
			status: "calculating",
			totalBytes: null,
			resolvedSourceCount: 0,
			totalSourceCount: 0,
		};

		controller.renderer.initialize(controller.runtimes);
		if (preservedSheetMusic) {
			rebindPreservedSheetMusicViews(controller, preservedSheetMusic);
		}
		controller.renderer.hideOverlayOnLoaded();
		controller.inputBinder.bind();
		controller.longestDuration = controller.findLongestDuration();

		if (controller.alignment) {
			controller.longestDuration = controller.alignment.referenceExtent.end;
		}
		controller.restoreSoloMode();

		if (!preservedSheetMusic) {
			await controller.renderSheetMusic();
		}
		await controller.attachSheetMusicMeasureMaps();
		await controller.renderer.initializeMidiDisplays(
			controller.longestDuration,
			controller.isAlignmentMode(),
		);
		restoreZoomState(controller, zoomState);

		const nextPosition = clamp(previousPosition, 0, controller.longestDuration);
		controller.state = {
			...createInitialPlayerState(previousRepeat),
			volume: previousVolume,
			position: nextPosition,
			loop: {
				enabled: previousLoop.enabled,
				pointA:
					previousLoop.pointA === null
						? null
						: clamp(previousLoop.pointA, 0, controller.longestDuration),
				pointB:
					previousLoop.pointB === null
						? null
						: clamp(previousLoop.pointB, 0, controller.longestDuration),
			},
		};
		if (
			controller.state.loop.pointA !== null &&
			controller.state.loop.pointB !== null &&
			controller.state.loop.pointA > controller.state.loop.pointB
		) {
			const pointA = controller.state.loop.pointA;
			controller.state.loop.pointA = controller.state.loop.pointB;
			controller.state.loop.pointB = pointA;
		}

		applyFirstPresetOrTrackProperties(controller);
		controller.audioEngine.setMasterVolume(controller.state.volume);
		controller.renderer.setVolumeSlider(controller.state.volume);
		controller.prefetchAudioDownloadSize();

		if (wasPlaying) {
			controller.startAudio(controller.state.position);
			controller.dispatch({ type: "set-playing", playing: true });
		}

		controller.updateMainControls();
		controller.emit("loaded", { longestDuration: controller.longestDuration });
	} catch (error) {
		if (stagedRuntimes && !committed) {
			controller.audioEngine.disconnectRuntimes(stagedRuntimes);
		}
		const message = getHotReloadErrorMessage(error);
		controller.emit("error", { message });
		throw error instanceof Error ? error : new Error(message);
	}
}

const configUpdateQueues = new WeakMap<
	TrackSwitchControllerImpl,
	Promise<void>
>();

export async function updateConfig(
	controller: TrackSwitchControllerImpl,
	nextInit: TrackSwitchInit,
): Promise<void> {
	const previousUpdate =
		configUpdateQueues.get(controller) || Promise.resolve();
	const nextUpdate = previousUpdate
		.catch(() => {
			// Keep later config updates from being blocked by an earlier failure.
		})
		.then(() => updateConfigNow(controller, nextInit));

	configUpdateQueues.set(controller, nextUpdate);

	try {
		await nextUpdate;
	} finally {
		if (configUpdateQueues.get(controller) === nextUpdate) {
			configUpdateQueues.delete(controller);
		}
	}
}
