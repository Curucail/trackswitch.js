import type { TrackMarker, TrackRuntime } from "../domain/types";
import type { ControllerPointerEvent } from "../shared/seek";
import type { MarkerPlacement } from "../ui/render-markers";
import type { TrackSwitchControllerImpl } from "./player-controller";

const MARKER_TIME_EPSILON = 0.000001;
const MARKER_SNAP_DISTANCE_PX = 12;
const MARKER_PREVIOUS_JUMP_MARGIN = 0.8;

export function getActiveMarkerRuntimes(
	controller: TrackSwitchControllerImpl,
): TrackRuntime[] {
	return controller.runtimes.filter(
		(runtime) => runtime.state.solo && runtime.state.volume > 0,
	);
}

export function getMarkerReferenceTime(
	controller: TrackSwitchControllerImpl,
	marker: TrackMarker,
): number {
	return controller.trackToReferenceTime(marker.trackIndex, marker.time);
}

export function resolveMarkerPlacement(
	controller: TrackSwitchControllerImpl,
	seekWrap: HTMLElement,
	marker: TrackMarker,
): MarkerPlacement | null {
	const referenceTime = getMarkerReferenceTime(controller, marker);
	const timeline = controller.getSeekTimelineContext(seekWrap);
	if (!Number.isFinite(referenceTime) || timeline.duration <= 0) {
		return null;
	}

	return {
		referenceTime: referenceTime,
		surfaceTime: timeline.fromReferenceTime(referenceTime),
		duration: timeline.duration,
	};
}

export function renderMarkerLayers(
	controller: TrackSwitchControllerImpl,
): void {
	controller.renderer.renderTimelineMarkers(
		controller.runtimes,
		getActiveMarkerRuntimes(controller),
		(seekWrap, marker) => resolveMarkerPlacement(controller, seekWrap, marker),
	);
}

export function getNavigationMarkerTimes(
	controller: TrackSwitchControllerImpl,
): number[] {
	const times: number[] = [];
	getActiveMarkerRuntimes(controller).forEach((runtime) => {
		runtime.markers.forEach((marker) => {
			const time = getMarkerReferenceTime(controller, marker);
			if (
				Number.isFinite(time) &&
				time >= 0 &&
				time <= controller.longestDuration
			) {
				times.push(time);
			}
		});
	});
	times.sort((left, right) => left - right);

	const unique: number[] = [];
	times.forEach((time) => {
		const previous = unique[unique.length - 1];
		if (
			previous === undefined ||
			Math.abs(previous - time) > MARKER_TIME_EPSILON
		) {
			unique.push(time);
		}
	});
	return unique;
}

function getMarkerNavigationTargets(controller: TrackSwitchControllerImpl): {
	previous: number | null;
	next: number | null;
} {
	const position = controller.state.position;
	const times = getNavigationMarkerTimes(controller);
	let previous: number | null = null;
	let next: number | null = null;

	for (const time of times) {
		if (time < position - MARKER_PREVIOUS_JUMP_MARGIN) {
			previous = time;
			continue;
		}
		if (time > position + MARKER_TIME_EPSILON) {
			next = time;
			break;
		}
	}

	return { previous: previous, next: next };
}

export function updateMarkerNavigation(
	controller: TrackSwitchControllerImpl,
): void {
	const targets = getMarkerNavigationTargets(controller);
	controller.renderer.updateMarkerNavigationControls(
		targets.previous !== null,
		targets.next !== null,
	);
}

export function seekToAdjacentMarker(
	controller: TrackSwitchControllerImpl,
	direction: "previous" | "next",
): void {
	const target = getMarkerNavigationTargets(controller)[direction];
	if (target === null) {
		return;
	}
	controller.seekTo(target);
}

export function activateTimelineMarker(
	controller: TrackSwitchControllerImpl,
	markerElement: HTMLElement,
): void {
	const referenceTime = Number(
		markerElement.getAttribute("data-marker-reference-time"),
	);
	if (!Number.isFinite(referenceTime)) {
		return;
	}
	controller.seekTo(referenceTime);
}

export function moveTimelineMarkerFocus(
	markerElement: HTMLElement,
	direction: "previous" | "next",
): void {
	const layer = markerElement.closest(".timeline-marker-layer");
	if (!layer) {
		return;
	}
	const markers = Array.from(
		layer.querySelectorAll<HTMLElement>(".timeline-marker"),
	);
	const currentIndex = markers.indexOf(markerElement);
	if (currentIndex < 0) {
		return;
	}
	const offset = direction === "previous" ? -1 : 1;
	const nextIndex = Math.max(
		0,
		Math.min(markers.length - 1, currentIndex + offset),
	);
	const nextMarker = markers[nextIndex];
	if (!nextMarker || nextMarker === markerElement) {
		return;
	}
	markers.forEach((marker) => {
		marker.tabIndex = marker === nextMarker ? 0 : -1;
	});
	nextMarker.focus();
}

export function snapLoopEndToMarker(
	controller: TrackSwitchControllerImpl,
	seekWrap: HTMLElement | null,
	event: ControllerPointerEvent,
	rawTime: number,
	loopStart: number,
): number {
	if (!seekWrap || !Number.isFinite(event.pageX)) {
		return rawTime;
	}

	let closestTime: number | null = null;
	let closestDistance = Number.POSITIVE_INFINITY;
	seekWrap
		.querySelectorAll<HTMLElement>(".timeline-marker")
		.forEach((marker) => {
			const surfaceTime = Number(
				marker.getAttribute("data-marker-surface-time"),
			);
			const movingForward = rawTime >= loopStart;
			if (
				!Number.isFinite(surfaceTime) ||
				(movingForward
					? surfaceTime < loopStart + controller.loopMinDistance
					: surfaceTime > loopStart - controller.loopMinDistance)
			) {
				return;
			}

			const rect = marker.getBoundingClientRect();
			const scrollX = controller.root.ownerDocument.defaultView?.scrollX ?? 0;
			const markerCenterPageX = rect.left + scrollX + rect.width / 2;
			const distance = Math.abs((event.pageX as number) - markerCenterPageX);
			if (distance <= MARKER_SNAP_DISTANCE_PX && distance < closestDistance) {
				closestDistance = distance;
				closestTime = surfaceTime;
			}
		});

	return closestTime ?? rawTime;
}
