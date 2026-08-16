import type { PlaybackAnchor, TrackRuntime } from "../domain/types";
import type { TrackTimelineProjector } from "../engine/waveform-engine";
import { closestInRoot, getOwnerWindow } from "../shared/dom";
import { clamp } from "../shared/math";
import type { ControllerPointerEvent } from "../shared/seek";
import { getSeekMetrics } from "../shared/seek";
import { resolveAudibleWaveformTrackIndex } from "../shared/waveform-source";
import { timelineId } from "../timeline/timeline";
import type { PianoRollSeekSurfaceMetadata } from "../ui/render-piano-roll";
import type {
	ImageSeekSurfaceMetadata,
	WaveformTimelineContext,
} from "../ui/view-renderer";
import { snapLoopEndToMarker } from "./marker-actions";
import type { TrackSwitchControllerImpl } from "./player-controller";

interface SeekTimelineContext {
	duration: number;
	toReferenceTime(timelineTime: number): number;
	fromReferenceTime(referenceTime: number): number;
	toAnchor?(timelineTime: number): PlaybackAnchor | null;
	playbackPosition?(): number | null;
}

const WAVEFORM_WHEEL_ZOOM_SPEED = 0.002;
const WAVEFORM_TRACKPAD_DELTA_BOOST = 8;
const WAVEFORM_ZOOM_OUT_DELTA_BOOST = 1.35;
const WAVEFORM_MAX_WHEEL_DELTA = 240;

function normalizeWaveformWheelDelta(event: WheelEvent): number {
	let deltaY = event.deltaY;

	if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
		deltaY *= 16;
	} else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		const ownerNode =
			event.currentTarget instanceof Node
				? event.currentTarget
				: event.target instanceof Node
					? event.target
					: null;
		deltaY *= Math.max(1, getOwnerWindow(ownerNode).innerHeight);
	} else if (Math.abs(deltaY) < 16) {
		deltaY *= WAVEFORM_TRACKPAD_DELTA_BOOST;
	}

	if (deltaY > 0) {
		deltaY *= WAVEFORM_ZOOM_OUT_DELTA_BOOST;
	}

	return clamp(deltaY, -WAVEFORM_MAX_WHEEL_DELTA, WAVEFORM_MAX_WHEEL_DELTA);
}

function handleWaveformAuxiliarySeekState(
	controller: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	if (controller.waveformMinimapDragState) {
		if (updateTimelineMinimapDrag(controller, event)) {
			event.preventDefault();
			event.stopPropagation();
		}
		return true;
	}

	if (controller.pendingWaveformTouchSeek) {
		if (controller.tryActivatePendingWaveformTouchSeek(event)) {
			event.preventDefault();
			event.stopPropagation();
		}
		return true;
	}

	if (controller.pinchZoomState) {
		if (controller.updatePinchZoom(event)) {
			event.preventDefault();
		}
		return true;
	}

	return false;
}

function updateDraggedLoopMarker(
	controller: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	if (controller.draggingMarker === null) {
		return false;
	}

	event.preventDefault();
	const seekTimelineContext = controller.getSeekTimelineContext(
		controller.seekingElement,
	);
	const metrics = getSeekMetrics(
		controller.seekingElement,
		event,
		seekTimelineContext.duration,
	);
	if (!metrics) {
		return true;
	}

	let newTime = metrics.time;
	if (controller.draggingMarker === "A") {
		const loopPointB =
			controller.state.loop.pointB === null
				? null
				: seekTimelineContext.fromReferenceTime(controller.state.loop.pointB);
		if (loopPointB !== null) {
			newTime = snapLoopEndToMarker(
				controller,
				controller.seekingElement,
				event,
				newTime,
				loopPointB,
			);
			newTime = Math.min(newTime, loopPointB - controller.loopMinDistance);
		}
		newTime = Math.max(0, newTime);
		controller.state = {
			...controller.state,
			loop: {
				...controller.state.loop,
				pointA: seekTimelineContext.toReferenceTime(newTime),
			},
		};
	} else {
		const loopPointA =
			controller.state.loop.pointA === null
				? null
				: seekTimelineContext.fromReferenceTime(controller.state.loop.pointA);
		if (loopPointA !== null) {
			newTime = snapLoopEndToMarker(
				controller,
				controller.seekingElement,
				event,
				newTime,
				loopPointA,
			);
			newTime = Math.max(newTime, loopPointA + controller.loopMinDistance);
		}
		newTime = Math.min(seekTimelineContext.duration, newTime);
		controller.state = {
			...controller.state,
			loop: {
				...controller.state.loop,
				pointB: seekTimelineContext.toReferenceTime(newTime),
			},
		};
	}

	controller.updateMainControls();
	return true;
}

function updateRightClickLoopSelection(
	controller: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	if (
		!controller.navigationBar?.controls.includes("looping") ||
		!controller.rightClickDragging
	) {
		return false;
	}

	event.preventDefault();

	const seekTimelineContext = controller.getSeekTimelineContext(
		controller.seekingElement,
	);
	const metrics = getSeekMetrics(
		controller.seekingElement,
		event,
		seekTimelineContext.duration,
	);
	if (!metrics || controller.loopDragStart === null) {
		return true;
	}

	const loopStart = controller.loopDragStart;
	const snappedTime = snapLoopEndToMarker(
		controller,
		controller.seekingElement,
		event,
		metrics.time,
		loopStart,
	);
	const movingForward = snappedTime >= loopStart;
	const loopEnd = movingForward
		? Math.min(
				seekTimelineContext.duration,
				Math.max(snappedTime, loopStart + controller.loopMinDistance),
			)
		: Math.max(
				0,
				Math.min(snappedTime, loopStart - controller.loopMinDistance),
			);
	const mappedStart = seekTimelineContext.toReferenceTime(
		movingForward ? loopStart : loopEnd,
	);
	const mappedEnd = seekTimelineContext.toReferenceTime(
		movingForward ? loopEnd : loopStart,
	);

	controller.state = {
		...controller.state,
		loop: {
			...controller.state.loop,
			pointA: Math.min(mappedStart, mappedEnd),
			pointB: Math.max(mappedStart, mappedEnd),
			enabled: false,
		},
	};

	controller.updateMainControls();
	return true;
}
export function onSeekMove(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!ctx.isLoaded) {
		return;
	}

	if (handleWaveformAuxiliarySeekState(ctx, event)) {
		return;
	}

	if (updateDraggedLoopMarker(ctx, event)) {
		return;
	}

	if (updateRightClickLoopSelection(ctx, event)) {
		return;
	}

	if (ctx.state.currentlySeeking) {
		event.preventDefault();
		ctx.seekFromEvent(event);
	}
}

export function onWaveformZoomWheel(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const wheelEvent = event.originalEvent as WheelEvent | undefined;
	const deltaY = wheelEvent ? normalizeWaveformWheelDelta(wheelEvent) : 0;
	if (typeof deltaY !== "number" || !Number.isFinite(deltaY) || deltaY === 0) {
		return;
	}

	const wrapper = closestInRoot(ctx.root, event.target, ".waveform-wrap");
	if (!wrapper) {
		return;
	}

	const seekWrap = wrapper.querySelector(
		'.seekwrap[data-seek-surface="waveform"]',
	);
	if (!(seekWrap instanceof HTMLElement)) {
		return;
	}

	const zoomDuration = ctx.getSeekTimelineContext(seekWrap).duration;
	if (!ctx.renderer.isWaveformZoomEnabled(seekWrap, zoomDuration)) {
		return;
	}

	const currentZoom = ctx.renderer.getWaveformZoom(seekWrap);
	if (currentZoom === null) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();

	const zoomFactor = Math.exp(-1 * deltaY * WAVEFORM_WHEEL_ZOOM_SPEED);
	const nextZoom = currentZoom * zoomFactor;
	const changed = ctx.renderer.setWaveformZoom(
		seekWrap,
		nextZoom,
		zoomDuration,
		Number.isFinite(event.pageX) ? event.pageX : undefined,
	);

	if (changed) {
		ctx.requestWaveformRender();
		ctx.updateMainControls();
	}
}

export function onPianoRollZoomWheel(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const wheelEvent = event.originalEvent as WheelEvent | undefined;
	const deltaY = wheelEvent ? normalizeWaveformWheelDelta(wheelEvent) : 0;
	if (typeof deltaY !== "number" || !Number.isFinite(deltaY) || deltaY === 0) {
		return;
	}

	const wrapper = closestInRoot(ctx.root, event.target, ".piano-roll-wrap");
	if (!wrapper) {
		return;
	}

	const seekWrap = wrapper.querySelector(
		'.seekwrap[data-seek-surface="piano-roll"]',
	);
	if (!(seekWrap instanceof HTMLElement)) {
		return;
	}

	const zoomDuration = ctx.getSeekTimelineContext(seekWrap).duration;
	if (!ctx.renderer.isPianoRollZoomEnabled(seekWrap, zoomDuration)) {
		return;
	}

	const currentZoom = ctx.renderer.getPianoRollZoom(seekWrap);
	if (currentZoom === null) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();

	const zoomFactor = Math.exp(-1 * deltaY * WAVEFORM_WHEEL_ZOOM_SPEED);
	const nextZoom = currentZoom * zoomFactor;
	const changed = ctx.renderer.setPianoRollZoom(
		seekWrap,
		nextZoom,
		zoomDuration,
		Number.isFinite(event.pageX) ? event.pageX : undefined,
	);

	if (changed) {
		ctx.updateMainControls();
	}
}

function updateTimelineMinimapDrag(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	if (!ctx.waveformMinimapDragState) {
		return false;
	}

	if (event.type === "touchmove" && ctx.getActiveTouchCount(event) >= 2) {
		ctx.endWaveformMinimapDrag();
		return false;
	}

	if (!Number.isFinite(event.pageX)) {
		return true;
	}

	const rect = ctx.waveformMinimapDragState.minimapNode.getBoundingClientRect();
	const minimapWidth = Math.max(
		1,
		rect.width || ctx.waveformMinimapDragState.minimapNode.clientWidth,
	);
	const ownerWindow = getOwnerWindow(ctx.waveformMinimapDragState.minimapNode);
	const pointerRatio = clamp(
		((event.pageX as number) - (rect.left + ownerWindow.scrollX)) /
			minimapWidth,
		0,
		1,
	);
	const seekWrap = ctx.waveformMinimapDragState.seekWrap;
	const startRatio =
		pointerRatio - ctx.waveformMinimapDragState.pointerOffsetRatio;
	if (ctx.isPianoRollSeekSurface(seekWrap)) {
		ctx.renderer.setPianoRollMinimapViewportStart(seekWrap, startRatio);
	} else {
		ctx.renderer.setWaveformMinimapViewportStart(seekWrap, startRatio);
	}
	return true;
}

export function updateWaveformMinimapDrag(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	return updateTimelineMinimapDrag(ctx, event);
}

export function endWaveformMinimapDrag(ctx: TrackSwitchControllerImpl): void {
	ctx.waveformMinimapDragState = null;
}

export function requestWaveformRender(ctx: TrackSwitchControllerImpl): void {
	if (ctx.waveformRenderFrameId !== null) {
		return;
	}

	ctx.waveformRenderFrameId = requestAnimationFrame(() => {
		ctx.waveformRenderFrameId = null;
		ctx.renderer.renderWaveforms(
			ctx.waveformEngine,
			ctx.runtimes,
			ctx.longestDuration,
			ctx.getWaveformTimelineProjector(),
			ctx.getWaveformTimelineContext(),
		);
	});
}

export function isWaveformSeekSurface(seekWrap: HTMLElement | null): boolean {
	return (
		!!seekWrap && seekWrap.getAttribute("data-seek-surface") === "waveform"
	);
}

export function isPianoRollSeekSurface(seekWrap: HTMLElement | null): boolean {
	return (
		!!seekWrap && seekWrap.getAttribute("data-seek-surface") === "piano-roll"
	);
}

export function startInteractiveSeek(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	seekWrap: HTMLElement,
): void {
	ctx.seekingElement = seekWrap;
	// The initial click/tap of a seek gesture is a discrete jump, worth
	// animating; a drag's own per-pixel `onSeekMove` calls track the pointer
	// live and should not queue an animation behind it.
	ctx.seekFromEvent(event, true, true);
	ctx.dispatch({ type: "set-seeking", seeking: true });
	ctx.disableLoopWhenSeekOutsideRegion();
}

export function disableLoopWhenSeekOutsideRegion(
	ctx: TrackSwitchControllerImpl,
): void {
	if (
		ctx.state.loop.enabled &&
		ctx.state.loop.pointA !== null &&
		ctx.state.loop.pointB !== null &&
		(ctx.state.position < ctx.state.loop.pointA ||
			ctx.state.position > ctx.state.loop.pointB)
	) {
		ctx.state = {
			...ctx.state,
			loop: {
				...ctx.state.loop,
				enabled: false,
			},
		};
	}
}

export function tryStartPendingWaveformTouchSeek(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	seekWrap: HTMLElement | null,
): boolean {
	if (
		event.type !== "touchstart" ||
		(!ctx.isWaveformSeekSurface(seekWrap) &&
			!ctx.isPianoRollSeekSurface(seekWrap)) ||
		ctx.getActiveTouchCount(event) !== 1 ||
		!seekWrap
	) {
		return false;
	}

	if (!Number.isFinite(event.pageX)) {
		return false;
	}

	if (!Number.isFinite(event.pageY)) {
		return false;
	}

	ctx.pendingWaveformTouchSeek = {
		seekWrap: seekWrap,
		startPageX: event.pageX as number,
		startPageY: event.pageY as number,
	};
	ctx.seekingElement = seekWrap;
	return true;
}

export function tryActivatePendingWaveformTouchSeek(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	if (!ctx.pendingWaveformTouchSeek) {
		return false;
	}

	if (ctx.getActiveTouchCount(event) >= 2) {
		return false;
	}

	if (!Number.isFinite(event.pageX)) {
		return false;
	}

	if (!Number.isFinite(event.pageY)) {
		return false;
	}

	const deltaX = Math.abs(
		(event.pageX as number) - ctx.pendingWaveformTouchSeek.startPageX,
	);
	const deltaY = Math.abs(
		(event.pageY as number) - ctx.pendingWaveformTouchSeek.startPageY,
	);

	if (deltaY >= ctx.touchSeekMoveThresholdPx && deltaY > deltaX) {
		ctx.pendingWaveformTouchSeek = null;
		ctx.seekingElement = null;
		return false;
	}

	if (deltaX < ctx.touchSeekMoveThresholdPx || deltaX < deltaY) {
		return false;
	}

	const seekWrap = ctx.pendingWaveformTouchSeek.seekWrap;
	ctx.pendingWaveformTouchSeek = null;
	ctx.startInteractiveSeek(event, seekWrap);
	return true;
}

export function applyPendingWaveformTouchSeekTap(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!ctx.pendingWaveformTouchSeek) {
		return;
	}

	if (Number.isFinite(event.pageX) && Number.isFinite(event.pageY)) {
		const deltaX = Math.abs(
			(event.pageX as number) - ctx.pendingWaveformTouchSeek.startPageX,
		);
		const deltaY = Math.abs(
			(event.pageY as number) - ctx.pendingWaveformTouchSeek.startPageY,
		);
		if (
			deltaX >= ctx.touchSeekMoveThresholdPx ||
			deltaY >= ctx.touchSeekMoveThresholdPx
		) {
			ctx.pendingWaveformTouchSeek = null;
			ctx.seekingElement = null;
			return;
		}
	}

	ctx.seekingElement = ctx.pendingWaveformTouchSeek.seekWrap;
	ctx.pendingWaveformTouchSeek = null;
	ctx.seekFromEvent(event, false, true);
}

export function getTouchPair(
	event: ControllerPointerEvent,
): [Touch, Touch] | null {
	const touchEvent = event.originalEvent as TouchEvent | undefined;
	const touches = touchEvent?.touches;
	if (!touches || touches.length < 2) {
		return null;
	}

	const first = touches[0];
	const second = touches[1];
	if (!first || !second) {
		return null;
	}

	return [first, second] as [Touch, Touch];
}

export function getTouchDistance(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): number | null {
	const touchPair = ctx.getTouchPair(event);
	if (!touchPair) {
		return null;
	}

	const [first, second] = touchPair;
	const distance = Math.hypot(
		first.pageX - second.pageX,
		first.pageY - second.pageY,
	);
	if (!Number.isFinite(distance) || distance <= 0) {
		return null;
	}

	return distance;
}

export function getTouchCenterPageX(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): number | null {
	const touchPair = ctx.getTouchPair(event);
	if (!touchPair) {
		return null;
	}

	const [first, second] = touchPair;
	return (first.pageX + second.pageX) / 2;
}

export function getActiveTouchCount(event: ControllerPointerEvent): number {
	const touchEvent = event.originalEvent as TouchEvent | undefined;
	if (!touchEvent?.touches) {
		return 0;
	}

	return touchEvent.touches.length;
}

export function tryStartPinchZoom(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	seekWrap: HTMLElement | null,
): boolean {
	if (event.type !== "touchstart") {
		return false;
	}

	if (ctx.pinchZoomState) {
		return true;
	}

	if (
		!seekWrap ||
		(seekWrap.getAttribute("data-seek-surface") !== "waveform" &&
			seekWrap.getAttribute("data-seek-surface") !== "piano-roll")
	) {
		return false;
	}

	const zoomDuration = ctx.getSeekTimelineContext(seekWrap).duration;
	const zoomEnabled = ctx.isPianoRollSeekSurface(seekWrap)
		? ctx.renderer.isPianoRollZoomEnabled(seekWrap, zoomDuration)
		: ctx.renderer.isWaveformZoomEnabled(seekWrap, zoomDuration);
	if (!zoomEnabled) {
		return false;
	}

	const initialDistance = ctx.getTouchDistance(event);
	if (initialDistance === null) {
		return false;
	}

	const initialZoom = ctx.isPianoRollSeekSurface(seekWrap)
		? ctx.renderer.getPianoRollZoom(seekWrap)
		: ctx.renderer.getWaveformZoom(seekWrap);
	if (initialZoom === null) {
		return false;
	}

	ctx.pinchZoomState = {
		seekWrap: seekWrap,
		initialDistance: initialDistance,
		initialZoom: initialZoom,
	};
	ctx.pendingWaveformTouchSeek = null;
	ctx.waveformMinimapDragState = null;

	if (ctx.state.currentlySeeking) {
		ctx.dispatch({ type: "set-seeking", seeking: false });
	}
	ctx.seekingElement = seekWrap;
	ctx.rightClickDragging = false;
	ctx.loopDragStart = null;
	ctx.draggingMarker = null;
	return true;
}

export function updatePinchZoom(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	if (!ctx.pinchZoomState) {
		return false;
	}

	const distance = ctx.getTouchDistance(event);
	if (distance === null) {
		ctx.endPinchZoom();
		return false;
	}

	const anchorPageX = ctx.getTouchCenterPageX(event);
	const scale = distance / ctx.pinchZoomState.initialDistance;
	const zoomDuration = ctx.getSeekTimelineContext(
		ctx.pinchZoomState.seekWrap,
	).duration;
	const changed = ctx.isPianoRollSeekSurface(ctx.pinchZoomState.seekWrap)
		? ctx.renderer.setPianoRollZoom(
				ctx.pinchZoomState.seekWrap,
				ctx.pinchZoomState.initialZoom * scale,
				zoomDuration,
				anchorPageX === null ? undefined : anchorPageX,
			)
		: ctx.renderer.setWaveformZoom(
				ctx.pinchZoomState.seekWrap,
				ctx.pinchZoomState.initialZoom * scale,
				zoomDuration,
				anchorPageX === null ? undefined : anchorPageX,
			);

	if (changed) {
		if (ctx.isWaveformSeekSurface(ctx.pinchZoomState.seekWrap)) {
			ctx.requestWaveformRender();
		}
		ctx.updateMainControls();
	}

	return true;
}

export function endPinchZoom(ctx: TrackSwitchControllerImpl): void {
	ctx.pinchZoomState = null;
	if (ctx.state.currentlySeeking) {
		ctx.dispatch({ type: "set-seeking", seeking: false });
	}
	ctx.pendingWaveformTouchSeek = null;
	ctx.seekingElement = null;
}

export function trackIndexFromTarget(
	ctx: TrackSwitchControllerImpl,
	target: EventTarget | null,
): number {
	const track = closestInRoot(ctx.root, target, ".track[data-track-index]");
	if (!track) {
		return -1;
	}

	const rawIndex = track.getAttribute("data-track-index");
	const parsed = Number(rawIndex);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return -1;
	}

	return Math.floor(parsed);
}

/**
 * Which `trackList` the clicked row lives in — a track may be listed by several,
 * and only the one that was clicked decides how the toggle behaves.
 */
export function trackGroupIndexFromTarget(
	ctx: TrackSwitchControllerImpl,
	target: EventTarget | null,
): number {
	const list = closestInRoot(
		ctx.root,
		target,
		".track_list[data-track-group-index]",
	);
	if (!list) {
		return -1;
	}

	const parsed = Number(list.getAttribute("data-track-group-index"));
	if (!Number.isFinite(parsed) || parsed < 0) {
		return -1;
	}

	return Math.floor(parsed);
}

export function isFixedWaveformLocalAxisEnabled(
	ctx: TrackSwitchControllerImpl,
): boolean {
	return ctx.isAlignmentMode() && !!ctx.alignment && !ctx.globalSyncEnabled;
}

export function getSeekTimelineContext(
	ctx: TrackSwitchControllerImpl,
	seekingElement: HTMLElement | null,
): SeekTimelineContext {
	const referenceContext: SeekTimelineContext = {
		duration: ctx.longestDuration,
		toReferenceTime: (timelineTime: number): number =>
			clamp(timelineTime, 0, ctx.longestDuration),
		fromReferenceTime: (referenceTime: number): number =>
			clamp(referenceTime, 0, ctx.longestDuration),
	};

	if (!seekingElement) {
		return referenceContext;
	}

	if (ctx.isPianoRollSeekSurface(seekingElement) && ctx.isAlignmentMode()) {
		const pianoRollSurface = ctx.renderer.findPianoRollSurface(seekingElement);
		return (
			ctx.getPianoRollTimelineContext(pianoRollSurface) || referenceContext
		);
	}

	if (ctx.isAlignmentMode()) {
		const imageSurface = ctx.renderer.findImageSurface(seekingElement);
		if (imageSurface) {
			return ctx.getImageTimelineContext(imageSurface) || referenceContext;
		}
	}

	if (!ctx.isFixedWaveformLocalAxisEnabled()) {
		return referenceContext;
	}

	const waveformSurface = ctx.renderer.findWaveformSurface(seekingElement);
	if (!waveformSurface) {
		return referenceContext;
	}

	const trackIndex = resolveAudibleWaveformTrackIndex(
		ctx.runtimes,
		waveformSurface.waveformSource,
		ctx.isAlignmentMode(),
		(trackIndex: number) => ctx.isTrackExclusive(trackIndex),
	);
	if (trackIndex === null) {
		return referenceContext;
	}
	const runtime = ctx.runtimes[trackIndex];
	if (!runtime) {
		return referenceContext;
	}

	const trackDuration = (
		ctx.constructor as typeof TrackSwitchControllerImpl
	).getRuntimeDuration(runtime);
	if (!Number.isFinite(trackDuration) || trackDuration <= 0) {
		return referenceContext;
	}

	let longestTrackDuration = trackDuration;
	for (let i = 0; i < ctx.runtimes.length; i++) {
		const rt = ctx.runtimes[i];
		if (rt) {
			const d = (
				ctx.constructor as typeof TrackSwitchControllerImpl
			).getRuntimeDuration(rt);
			if (Number.isFinite(d) && d > longestTrackDuration)
				longestTrackDuration = d;
		}
	}
	const axisDuration =
		waveformSurface.timeAxis === "individual"
			? trackDuration
			: longestTrackDuration;

	return {
		duration: axisDuration,
		toAnchor: (sharedTime: number) =>
			ctx.trackPlaybackAnchor(trackIndex, clamp(sharedTime, 0, trackDuration)),
		playbackPosition: () => ctx.trackPlaybackPosition(trackIndex),
		toReferenceTime: (sharedTime: number): number => {
			const clampedTrackTime = clamp(sharedTime, 0, trackDuration);
			return clamp(
				ctx.trackToReferenceTime(
					trackIndex,
					clampedTrackTime,
					ctx.state.position,
				),
				0,
				ctx.longestDuration,
			);
		},
		fromReferenceTime: (referenceTime: number): number => {
			const clampedReferenceTime = clamp(referenceTime, 0, ctx.longestDuration);
			return clamp(
				ctx.referenceToTrackTime(trackIndex, clampedReferenceTime),
				0,
				trackDuration,
			);
		},
	};
}

export function getPianoRollTimelineContext(
	ctx: TrackSwitchControllerImpl,
	pianoRollSurface: PianoRollSeekSurfaceMetadata | null,
): SeekTimelineContext | null {
	if (!pianoRollSurface || !ctx.isAlignmentMode()) {
		return null;
	}

	const pianoRollDuration = Number(pianoRollSurface.pianoRollDurationSeconds);
	if (!Number.isFinite(pianoRollDuration) || pianoRollDuration <= 0) {
		return null;
	}

	const alignmentColumn =
		typeof pianoRollSurface.alignmentColumn === "string"
			? pianoRollSurface.alignmentColumn.trim()
			: "";
	const pianoRollTimeline = alignmentColumn
		? timelineId(alignmentColumn)
		: null;
	return (
		buildProjectedTimelineContext(
			ctx,
			pianoRollTimeline,
			pianoRollDuration,
		) ?? {
			// No timeline declared for ctx MIDI: it shares the reference
			// timeline, so local and reference coordinates coincide.
			duration: pianoRollDuration,
			toReferenceTime: (pianoRollTime: number): number =>
				clamp(pianoRollTime, 0, ctx.longestDuration),
			fromReferenceTime: (referenceTime: number): number =>
				clamp(referenceTime, 0, pianoRollDuration),
		}
	);
}

export function getImageTimelineContext(
	ctx: TrackSwitchControllerImpl,
	imageSurface: ImageSeekSurfaceMetadata | null,
): SeekTimelineContext | null {
	if (!imageSurface || !ctx.isAlignmentMode()) {
		return null;
	}

	const alignmentColumn =
		typeof imageSurface.alignmentColumn === "string"
			? imageSurface.alignmentColumn.trim()
			: "";
	if (!alignmentColumn) {
		return null;
	}

	// An image's native coordinate is percent of its width, which is also what
	// the seek geometry works in.
	return buildProjectedTimelineContext(ctx, timelineId(alignmentColumn), 100);
}

/**
 * Maps a surface's own timeline to and from reference coordinates with the same
 * piecewise-linear projection the audio tracks use, so every surface reports a
 * shared musical position in its own units. Null when the timeline is not
 * reachable from the reference.
 */
function buildProjectedTimelineContext(
	ctx: TrackSwitchControllerImpl,
	timeline: ReturnType<typeof timelineId> | null,
	surfaceDuration: number,
): {
	duration: number;
	toReferenceTime(surfaceValue: number): number;
	fromReferenceTime(referenceTime: number): number;
	toAnchor(surfaceValue: number): PlaybackAnchor;
	playbackPosition(): number | null;
} | null {
	const referenceTimeline = ctx.alignment?.referenceTimeline;
	const projection = ctx.alignment?.projection;
	if (
		!timeline ||
		!projection ||
		!referenceTimeline ||
		!projection.canProject(referenceTimeline, timeline) ||
		!projection.canProject(timeline, referenceTimeline)
	) {
		return null;
	}

	return {
		duration: surfaceDuration,
		toAnchor: (surfaceValue: number) => ({
			timeline,
			value: clamp(surfaceValue, 0, surfaceDuration),
		}),
		playbackPosition: (): number | null => {
			const position = ctx.playbackPositionOn(timeline);
			return position === null ? null : clamp(position, 0, surfaceDuration);
		},
		toReferenceTime: (surfaceValue: number): number =>
			clamp(
				projection.project(
					clamp(surfaceValue, 0, surfaceDuration),
					timeline,
					referenceTimeline,
				),
				0,
				ctx.longestDuration,
			),
		fromReferenceTime: (referenceTime: number): number =>
			clamp(
				projection.project(referenceTime, referenceTimeline, timeline),
				0,
				surfaceDuration,
			),
	};
}

export function getWaveformTimelineContext(
	ctx: TrackSwitchControllerImpl,
): WaveformTimelineContext {
	return {
		enabled: ctx.isFixedWaveformLocalAxisEnabled(),
		referenceToTrackTime: (
			trackIndex: number,
			referenceTime: number,
		): number => {
			const runtime = ctx.runtimes[trackIndex];
			if (!runtime) {
				return 0;
			}

			const trackDuration = (
				ctx.constructor as typeof TrackSwitchControllerImpl
			).getRuntimeDuration(runtime);
			if (!Number.isFinite(trackDuration) || trackDuration <= 0) {
				return 0;
			}

			const clampedReferenceTime = clamp(referenceTime, 0, ctx.longestDuration);
			return clamp(
				ctx.referenceToTrackTime(trackIndex, clampedReferenceTime),
				0,
				trackDuration,
			);
		},
		getPlaybackPosition: (trackIndex: number): number | null => {
			const position = ctx.trackPlaybackPosition(trackIndex);
			if (position === null) {
				return null;
			}

			const runtime = ctx.runtimes[trackIndex];
			if (!runtime) {
				return null;
			}

			const trackDuration = (
				ctx.constructor as typeof TrackSwitchControllerImpl
			).getRuntimeDuration(runtime);
			if (!Number.isFinite(trackDuration) || trackDuration <= 0) {
				return null;
			}

			return clamp(position, 0, trackDuration);
		},
		getTrackDuration: (trackIndex: number): number => {
			const runtime = ctx.runtimes[trackIndex];
			if (!runtime) {
				return 0;
			}

			const duration = (
				ctx.constructor as typeof TrackSwitchControllerImpl
			).getRuntimeDuration(runtime);
			if (!Number.isFinite(duration) || duration <= 0) {
				return 0;
			}

			return duration;
		},
		getTrackCount: (): number => ctx.runtimes.length,
		getTrackAlignmentPoints: (
			trackIndex: number,
		): Array<{ referenceTime: number; trackTime: number }> => {
			return ctx.getTrackAlignmentPoints(trackIndex);
		},
	};
}

export function getWaveformTimelineProjector(
	ctx: TrackSwitchControllerImpl,
): TrackTimelineProjector | undefined {
	if (!ctx.isAlignmentMode() || !ctx.alignment) {
		return undefined;
	}

	const trackIndexByRuntime = new Map<TrackRuntime, number>();
	const trackIndexByDefinition = new Map<object, number>();

	ctx.runtimes.forEach((runtime: TrackRuntime, index: number) => {
		trackIndexByRuntime.set(runtime, index);
		trackIndexByDefinition.set(runtime.definition, index);
	});

	return (runtime: TrackRuntime, trackTimelineTime: number): number => {
		const directIndex = trackIndexByRuntime.get(runtime);
		if (directIndex !== undefined) {
			return ctx.trackToReferenceTime(directIndex, trackTimelineTime);
		}

		const definitionIndex = trackIndexByDefinition.get(runtime.definition);
		if (definitionIndex !== undefined) {
			return ctx.trackToReferenceTime(definitionIndex, trackTimelineTime);
		}

		return trackTimelineTime;
	};
}
