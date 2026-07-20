import { IMPLICIT_REFERENCE_TIMELINE } from "../timeline/timeline";
import type { ControllerPointerEvent } from "../shared/seek";
import type { TrackSwitchControllerImpl } from "./player-controller";
import { moveRuntimeMarker } from "../timeline/marker";

const MARKER_TIME_EPSILON = 0.000001;
const MARKER_SNAP_DISTANCE_PX = 12;
const MARKER_PREVIOUS_JUMP_MARGIN = 0.8;

export function renderMarkerLayers(
	controller: TrackSwitchControllerImpl,
): void {
	synchronizeRuntimeMarkers(controller);
	const referenceTimeline =
		controller.alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE;

	controller.renderer.renderTimelineMarkers({
		markerSets: controller.markerSets,
		alignmentMarkerSet: controller.alignment?.markerSet ?? null,
		referenceTimeline,
		projection: controller.alignment?.projection ?? null,
		getSeekTimelineContext: (seekWrap) =>
			controller.getSeekTimelineContext(seekWrap),
		formatReferenceValue: (value) =>
			controller.renderer.formatReferenceTimelineValue(value),
	});
}

export function synchronizeRuntimeMarkers(
	controller: TrackSwitchControllerImpl,
): void {
	const timeline =
		controller.alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE;
	controller.runtimeMarkers = moveRuntimeMarker(
		controller.runtimeMarkers,
		"playhead",
		timeline,
		controller.state.position,
	);
	controller.runtimeMarkers = moveRuntimeMarker(
		controller.runtimeMarkers,
		"loopA",
		timeline,
		controller.state.loop.pointA,
	);
	controller.runtimeMarkers = moveRuntimeMarker(
		controller.runtimeMarkers,
		"loopB",
		timeline,
		controller.state.loop.pointB,
	);
}

export function getNavigationMarkerTimes(
	controller: TrackSwitchControllerImpl,
): number[] {
	const referenceTimeline =
		controller.alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE;
	const projection = controller.alignment?.projection ?? null;
	const anySelectedTrack = controller.runtimes.some(
		(runtime) => runtime.state.solo,
	);
	const noSoloFallbackIsAudible =
		controller.features.exclusiveSolo &&
		!(controller.isAlignmentMode() && controller.globalSyncEnabled);
	const audibleTrackIds = new Set(
		controller.runtimes
			.filter(
				(runtime) =>
					runtime.state.volume > 0 &&
					(anySelectedTrack
						? runtime.state.solo
						: noSoloFallbackIsAudible),
			)
			.map((runtime) => runtime.definition.id),
	);

	const times: number[] = [];
	controller.markerSets.forEach((resolved) => {
		const isSharedTimeline =
			!controller.alignment && resolved.timeline === IMPLICIT_REFERENCE_TIMELINE;
		if (
			!audibleTrackIds.has(resolved.timeline) &&
			!(isSharedTimeline && audibleTrackIds.size > 0)
		) {
			return;
		}

		resolved.markerSet.markers.forEach((marker) => {
			const time = projection
				? projection.projectMarker(marker, referenceTimeline)
				: (marker.placements.values().next().value ?? null);
			if (
				time !== null &&
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
	const seekWrap = markerElement.closest(".seekwrap");
	if (!(seekWrap instanceof HTMLElement)) {
		return;
	}

	const surfaceTime = Number(
		markerElement.getAttribute("data-marker-surface-time"),
	);
	if (!Number.isFinite(surfaceTime)) {
		return;
	}

	const referenceTime = controller
		.getSeekTimelineContext(seekWrap)
		.toReferenceTime(surfaceTime);
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
	const movingForward = rawTime >= loopStart;
	return snapTimeToMarker(
		controller,
		seekWrap,
		event,
		rawTime,
		(surfaceTime) =>
			movingForward
				? surfaceTime >= loopStart + controller.loopMinDistance
				: surfaceTime <= loopStart - controller.loopMinDistance,
	);
}

export function snapLoopStartToMarker(
	controller: TrackSwitchControllerImpl,
	seekWrap: HTMLElement | null,
	event: ControllerPointerEvent,
	rawTime: number,
): number {
	return snapTimeToMarker(controller, seekWrap, event, rawTime);
}

function snapTimeToMarker(
	controller: TrackSwitchControllerImpl,
	seekWrap: HTMLElement | null,
	event: ControllerPointerEvent,
	rawTime: number,
	isCandidate: (surfaceTime: number) => boolean = () => true,
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
			if (!Number.isFinite(surfaceTime) || !isCandidate(surfaceTime)) {
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
