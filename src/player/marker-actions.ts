import type { ResolvedMarkerSet } from "../domain/types";
import type { ControllerPointerEvent } from "../shared/seek";
import { moveRuntimeMarker } from "../timeline/marker";
import { IMPLICIT_REFERENCE_TIMELINE } from "../timeline/timeline";
import type { TrackSwitchControllerImpl } from "./player-controller";

const MARKER_TIME_EPSILON = 0.000001;
const MARKER_SNAP_DISTANCE_PX = 12;
const MARKER_PREVIOUS_JUMP_MARGIN = 0.8;

export interface MarkerNavigationSelection {
	setId: string;
	markerId: string;
}

export interface MarkerNavigationDialogValues {
	jumpMarker: MarkerNavigationSelection | null;
	loopAMarker: MarkerNavigationSelection | null;
	loopBMarker: MarkerNavigationSelection | null;
}

export interface MarkerNavigationMarkerOption {
	id: string;
	label?: string;
	referenceTime: number;
	formattedTime: string;
}

export interface MarkerNavigationSetOption {
	id: string;
	markers: MarkerNavigationMarkerOption[];
}

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

export function getAudibleMarkerSets(
	controller: TrackSwitchControllerImpl,
): ResolvedMarkerSet[] {
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
					(anySelectedTrack ? runtime.state.solo : noSoloFallbackIsAudible),
			)
			.map((runtime) => runtime.definition.id),
	);

	const sets: ResolvedMarkerSet[] = [];
	controller.markerSets.forEach((resolved) => {
		const isSharedTimeline =
			!controller.alignment &&
			resolved.timeline === IMPLICIT_REFERENCE_TIMELINE;
		if (
			!audibleTrackIds.has(resolved.timeline) &&
			!(isSharedTimeline && audibleTrackIds.size > 0)
		) {
			return;
		}
		sets.push(resolved);
	});
	return sets;
}

function getDialogMarkerSets(
	controller: TrackSwitchControllerImpl,
): ResolvedMarkerSet[] {
	return Array.from(controller.markerSets.values());
}

function resolveMarkerReferenceTime(
	controller: TrackSwitchControllerImpl,
	marker: ResolvedMarkerSet["markerSet"]["markers"][number],
): number | null {
	const referenceTimeline =
		controller.alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE;
	const projection = controller.alignment?.projection ?? null;
	const time = projection
		? projection.projectMarker(marker, referenceTimeline)
		: (marker.placements.values().next().value ?? null);
	return time !== null &&
		Number.isFinite(time) &&
		time >= 0 &&
		time <= controller.longestDuration
		? time
		: null;
}

function getDialogMarkerSetOptions(
	controller: TrackSwitchControllerImpl,
): MarkerNavigationSetOption[] {
	return getDialogMarkerSets(controller)
		.map((set) => {
			const markers = set.markerSet.markers
				.filter((marker) => !marker.hidden)
				.map((marker) => {
					const referenceTime = resolveMarkerReferenceTime(controller, marker);
					if (referenceTime === null) {
						return null;
					}
					const label = marker.label?.trim();
					const option: MarkerNavigationMarkerOption = {
						id: marker.id,
						referenceTime: referenceTime,
						formattedTime:
							controller.renderer.formatReferenceTimelineValue(referenceTime),
					};
					if (label) {
						option.label = label;
					}
					return option;
				})
				.filter(
					(marker): marker is MarkerNavigationMarkerOption => marker !== null,
				)
				.sort(
					(left, right) =>
						left.referenceTime - right.referenceTime ||
						left.id.localeCompare(right.id, undefined, { numeric: true }),
				);
			return { id: String(set.id), markers: markers };
		})
		.filter((set) => set.markers.length > 0);
}

function hasDialogMarkers(controller: TrackSwitchControllerImpl): boolean {
	return getDialogMarkerSets(controller).some((set) =>
		set.markerSet.markers.some(
			(marker) =>
				!marker.hidden &&
				resolveMarkerReferenceTime(controller, marker) !== null,
		),
	);
}

export function getNavigationMarkerTimes(
	controller: TrackSwitchControllerImpl,
): number[] {
	const times: number[] = [];
	getAudibleMarkerSets(controller).forEach((resolved) => {
		resolved.markerSet.markers.forEach((marker) => {
			const time = resolveMarkerReferenceTime(controller, marker);
			if (time !== null) {
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
	const canOpenDialog = hasDialogMarkers(controller);
	controller.renderer.updateMarkerNavigationControls(
		targets.previous !== null,
		targets.next !== null,
		canOpenDialog,
	);
	if (controller.markerNavigationDialogOpen) {
		const dialogSets = getDialogMarkerSetOptions(controller);
		if (dialogSets.length === 0) {
			closeMarkerNavigationDialog(controller);
		} else {
			controller.renderer.updateMarkerNavigationDialogSets(dialogSets);
		}
	}
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

export function openMarkerNavigationDialog(
	controller: TrackSwitchControllerImpl,
): void {
	const sets = getDialogMarkerSetOptions(controller);
	if (sets.length === 0) {
		return;
	}
	controller.markerNavigationDialogOpen = true;
	controller.renderer.openMarkerNavigationDialog(sets);
}

export function closeMarkerNavigationDialog(
	controller: TrackSwitchControllerImpl,
): void {
	if (!controller.markerNavigationDialogOpen) {
		return;
	}
	controller.markerNavigationDialogOpen = false;
	controller.renderer.closeMarkerNavigationDialog();
}

function resolveDialogMarker(
	controller: TrackSwitchControllerImpl,
	selection: MarkerNavigationSelection | null,
	fieldName: string,
): { time: number | null; error: string | null } {
	if (!selection) {
		return { time: null, error: null };
	}
	const set = getDialogMarkerSets(controller).find(
		(candidate) => String(candidate.id) === selection.setId,
	);
	if (!set) {
		return {
			time: null,
			error: `${fieldName} marker set is no longer available. Choose another marker.`,
		};
	}
	const marker = set.markerSet.markers.find(
		(candidate) => !candidate.hidden && candidate.id === selection.markerId,
	);
	const time = marker ? resolveMarkerReferenceTime(controller, marker) : null;
	return time === null
		? {
				time: null,
				error: `${fieldName} is no longer available. Choose another marker.`,
			}
		: { time, error: null };
}

export function submitMarkerNavigationDialog(
	controller: TrackSwitchControllerImpl,
	values: MarkerNavigationDialogValues,
): void {
	const jumpRequested = values.jumpMarker !== null;
	const loopARequested = values.loopAMarker !== null;
	const loopBRequested = values.loopBMarker !== null;
	if (!jumpRequested && !loopARequested && !loopBRequested) {
		closeMarkerNavigationDialog(controller);
		return;
	}
	if (loopARequested !== loopBRequested) {
		controller.renderer.setMarkerNavigationDialogError(
			"Choose both loop point A and loop point B.",
		);
		return;
	}

	const jump = resolveDialogMarker(
		controller,
		values.jumpMarker,
		"Jump marker",
	);
	const loopA = resolveDialogMarker(
		controller,
		values.loopAMarker,
		"Loop point A",
	);
	const loopB = resolveDialogMarker(
		controller,
		values.loopBMarker,
		"Loop point B",
	);
	const resolutionError = jump.error ?? loopA.error ?? loopB.error;
	if (resolutionError) {
		controller.renderer.setMarkerNavigationDialogError(resolutionError);
		return;
	}

	let loopStart: number | null = null;
	let loopEnd: number | null = null;
	if (loopARequested && loopA.time !== null && loopB.time !== null) {
		loopStart = Math.min(loopA.time, loopB.time);
		loopEnd = Math.max(loopA.time, loopB.time);
		if (loopEnd - loopStart < controller.loopMinDistance) {
			controller.renderer.setMarkerNavigationDialogError(
				"Loop points must be different markers with enough time between them.",
			);
			return;
		}
	}

	if (loopStart !== null && loopEnd !== null) {
		controller.state = {
			...controller.state,
			loop: { pointA: loopStart, pointB: loopEnd, enabled: true },
		};
		synchronizeRuntimeMarkers(controller);
	}

	closeMarkerNavigationDialog(controller);
	if (jumpRequested && jump.time !== null) {
		controller.seekTo(jump.time);
		return;
	}
	if (
		loopStart !== null &&
		loopEnd !== null &&
		(controller.state.position < loopStart ||
			controller.state.position > loopEnd)
	) {
		controller.seekTo(loopStart);
		return;
	}
	controller.updateMainControls();
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
