import { normalizeTrackSwitchConfig } from "../config/normalize-init";
import type { ViewNormalizeContext } from "../config/ui-elements";
import { normalizeFeatures } from "../domain/options";
import { createTrackRuntime } from "../domain/runtime";
import { createInitialPlayerState } from "../domain/state";
import type {
	NormalizedTrackSwitchConfig,
	ResolvedAlignment,
	TrackRuntime,
	TrackSwitchFeatures,
	TrackSwitchInit,
} from "../domain/types";
import { clamp } from "../shared/math";
import { IMPLICIT_REFERENCE_TIMELINE } from "../timeline/timeline";
import { buildResolvedAlignment } from "./alignment-context";
import { loadMarkerSets } from "./marker-sets";
import type { TrackSwitchControllerImpl } from "./player-controller";

function resolveControllerFeatures(
	config: NormalizedTrackSwitchConfig,
): TrackSwitchFeatures {
	const features = normalizeFeatures(config.features);
	if (config.alignment) {
		features.exclusiveSolo = true;
	}
	return features;
}

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
	features: TrackSwitchFeatures,
): TrackRuntime[] {
	const runtimes = config.tracks.map((track, index) =>
		createTrackRuntime(track, index),
	);

	const hasAnySelectedTrack = runtimes.some((runtime) => runtime.state.solo);
	if (!hasAnySelectedTrack && runtimes.length > 0) {
		if (features.exclusiveSolo) {
			runtimes[0].state.solo = true;
		} else {
			const hasExplicitSoloConfiguration = config.tracks.some(
				(track) => typeof track.solo === "boolean",
			);

			if (!hasExplicitSoloConfiguration) {
				runtimes.forEach((runtime) => {
					runtime.state.solo = true;
				});
			}
		}
	}

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
): Promise<void> {
	const wasPlaying = controller.state.playing;
	const previousPosition = wasPlaying
		? controller.currentPlaybackReferencePosition()
		: controller.state.position;

	if (wasPlaying) {
		controller.stopAudio();
	}

	resetTransientInteractionState(controller);
	controller.sheetMusicEngine.destroy();
	controller.renderer.destroy();
	controller.inputBinder.unbind();
	applyFeatures(controller.features, features);

	controller.renderer.renderViews(config.views, buildViewContext(config));

	controller.presets = config.presets;
	controller.media = config.media;
	controller.markersConfig = config.markers;
	controller.renderer.updateConfig(
		buildPresetEntries(config),
		buildTrackGroups(config),
	);
	controller.effectiveSingleSoloMode = controller.isAlignmentMode()
		? true
		: controller.features.exclusiveSolo;

	controller.renderer.initialize(controller.runtimes);
	controller.renderer.hideOverlayOnLoaded();
	controller.inputBinder.bind();
	controller.longestDuration = controller.findLongestDuration();

	if (controller.alignment) {
		controller.longestDuration = controller.alignment.referenceExtent.end;
		controller.setEffectiveSoloMode(true);
	} else if (controller.features.exclusiveSolo) {
		controller.setEffectiveSoloMode(true);
	}

	controller.markerSets = await loadMarkerSets(
		controller.markersConfig,
		controller.alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE,
		controller.alignment?.projection ?? null,
		controller.longestDuration,
	);

	restoreAudioPreservingState(controller, previousPosition, wasPlaying);
	await controller.initializeSheetMusic();
	await controller.renderer.initializeMidiDisplays(
		controller.longestDuration,
		controller.isAlignmentMode(),
	);
	controller.updateMainControls();
}

function buildTrackGroups(config: NormalizedTrackSwitchConfig) {
	let groupIndex = 0;
	const groups: Array<{
		groupIndex: number;
		trackIds: string[];
		rowHeight: number | undefined;
	}> = [];
	config.views.forEach((view) => {
		if (view.type !== "trackList") {
			return;
		}
		groups.push({
			groupIndex,
			trackIds: view.tracks,
			rowHeight: view.rowHeight,
		});
		groupIndex += 1;
	});
	return groups;
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
		const nextFeatures = resolveControllerFeatures(nextConfig);

		if (canReuseLoadedRuntimes(controller, nextConfig)) {
			await applyAudioPreservingConfig(controller, nextConfig, nextFeatures);
			return;
		}

		const nextRuntimes = createRuntimes(nextConfig, nextFeatures);
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

		const stagedAlignment: ResolvedAlignment | null = nextConfig.alignment
			? await buildResolvedAlignment(nextConfig.alignment, nextConfig.media)
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
			stagedAlignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE,
			stagedAlignment?.projection ?? null,
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
		controller.sheetMusicEngine.destroy();
		controller.renderer.destroy();
		controller.inputBinder.unbind();
		applyFeatures(controller.features, nextFeatures);

		controller.renderer.renderViews(
			nextConfig.views,
			buildViewContext(nextConfig),
		);

		controller.runtimes = nextRuntimes;
		controller.media = nextConfig.media;
		controller.presets = nextConfig.presets;
		controller.markersConfig = nextConfig.markers;
		controller.markerSets = stagedMarkerSets;
		controller.renderer.updateConfig(
			buildPresetEntries(nextConfig),
			buildTrackGroups(nextConfig),
		);
		controller.alignmentConfig = nextConfig.alignment;
		controller.alignment = stagedAlignment;
		const referenceDefinition = stagedAlignment?.timelines.get(
			stagedAlignment.referenceTimeline,
		);
		controller.renderer.setReferenceTimelineUnit(
			referenceDefinition?.unit ?? "seconds",
		);
		controller.alignmentPlaybackTrackIndex = null;
		controller.globalSyncEnabled = false;
		controller.syncLockedTrackIndexes.clear();
		controller.preSyncSoloTrackIndex = null;
		controller.effectiveSingleSoloMode = controller.isAlignmentMode()
			? true
			: controller.features.exclusiveSolo;
		controller.audioDownloadSizeRequest = null;
		controller.audioDownloadSizeInfo = {
			status: "calculating",
			totalBytes: null,
			resolvedSourceCount: 0,
			totalSourceCount: 0,
		};

		controller.renderer.initialize(controller.runtimes);
		controller.renderer.hideOverlayOnLoaded();
		controller.inputBinder.bind();
		controller.longestDuration = controller.findLongestDuration();

		if (controller.alignment) {
			controller.longestDuration = controller.alignment.referenceExtent.end;
			controller.setEffectiveSoloMode(true);
		}

		await controller.initializeSheetMusic();
		await controller.renderer.initializeMidiDisplays(
			controller.longestDuration,
			controller.isAlignmentMode(),
		);

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
