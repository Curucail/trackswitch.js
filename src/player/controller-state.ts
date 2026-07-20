import type {
	TrackRuntime,
	TrackState,
	TrackSwitchEventMap,
	TrackSwitchSnapshot,
	TrackSwitchUiState,
} from "../domain/types";
import type { TrackSwitchControllerImpl } from "./player-controller";
import { markerPlacement } from "../timeline/marker";
import { IMPLICIT_REFERENCE_TIMELINE } from "../timeline/timeline";

function runtimeValue(
	controller: TrackSwitchControllerImpl,
	marker: typeof controller.runtimeMarkers.playhead | null,
	fallback: number | null,
): number | null {
	if (!marker) return null;
	const timeline =
		controller.alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE;
	return markerPlacement(marker, timeline) ?? fallback;
}

export function createTrackStateSnapshot(runtime: TrackRuntime): TrackState {
	return {
		solo: runtime.state.solo,
		volume: runtime.state.volume,
		pan: runtime.state.pan,
	};
}

export function createControllerSnapshot(
	controller: TrackSwitchControllerImpl,
): TrackSwitchSnapshot {
	return {
		isLoaded: controller.isLoaded,
		isLoading: controller.isLoading,
		isDestroyed: controller.isDestroyed,
		longestDuration: controller.longestDuration,
		features: { ...controller.features },
		state: {
			...controller.state,
			loop: { ...controller.state.loop },
		},
		tracks: controller.runtimes.map(createTrackStateSnapshot),
	};
}

export function createUiState(
	controller: TrackSwitchControllerImpl,
): TrackSwitchUiState {
	const position = runtimeValue(
		controller,
		controller.runtimeMarkers.playhead,
		controller.state.position,
	) as number;
	return {
		playing: controller.state.playing,
		repeat: controller.state.repeat,
		position,
		longestDuration: controller.longestDuration,
		syncEnabled: controller.globalSyncEnabled,
		syncAvailable: controller.isGlobalSyncAvailable(),
		loop: {
			pointA: runtimeValue(
				controller,
				controller.runtimeMarkers.loopA,
				controller.state.loop.pointA,
			),
			pointB: runtimeValue(
				controller,
				controller.runtimeMarkers.loopB,
				controller.state.loop.pointB,
			),
			enabled: controller.state.loop.enabled,
		},
	};
}

export function createPositionEventPayload(
	controller: TrackSwitchControllerImpl,
): TrackSwitchEventMap["position"] {
	return {
		position:
			runtimeValue(
				controller,
				controller.runtimeMarkers.playhead,
				controller.state.position,
			) ?? 0,
		duration: controller.longestDuration,
	};
}

export function createTrackStateEventPayload(
	index: number,
	runtime: TrackRuntime,
): TrackSwitchEventMap["trackState"] {
	return {
		index,
		state: createTrackStateSnapshot(runtime),
	};
}
