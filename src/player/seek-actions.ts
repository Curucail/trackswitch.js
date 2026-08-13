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
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!this.isLoaded) {
			return;
		}

		if (handleWaveformAuxiliarySeekState(this, event)) {
			return;
		}

		if (updateDraggedLoopMarker(this, event)) {
			return;
		}

		if (updateRightClickLoopSelection(this, event)) {
			return;
		}

		if (this.state.currentlySeeking) {
			event.preventDefault();
			this.seekFromEvent(event);
		}
	}).call(ctx, event);
}

export function onWaveformZoomWheel(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const wheelEvent = event.originalEvent as WheelEvent | undefined;
		const deltaY = wheelEvent ? normalizeWaveformWheelDelta(wheelEvent) : 0;
		if (
			typeof deltaY !== "number" ||
			!Number.isFinite(deltaY) ||
			deltaY === 0
		) {
			return;
		}

		const wrapper = closestInRoot(this.root, event.target, ".waveform-wrap");
		if (!wrapper) {
			return;
		}

		const seekWrap = wrapper.querySelector(
			'.seekwrap[data-seek-surface="waveform"]',
		);
		if (!(seekWrap instanceof HTMLElement)) {
			return;
		}

		const zoomDuration = this.getSeekTimelineContext(seekWrap).duration;
		if (!this.renderer.isWaveformZoomEnabled(seekWrap, zoomDuration)) {
			return;
		}

		const currentZoom = this.renderer.getWaveformZoom(seekWrap);
		if (currentZoom === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const zoomFactor = Math.exp(-1 * deltaY * WAVEFORM_WHEEL_ZOOM_SPEED);
		const nextZoom = currentZoom * zoomFactor;
		const changed = this.renderer.setWaveformZoom(
			seekWrap,
			nextZoom,
			zoomDuration,
			Number.isFinite(event.pageX) ? event.pageX : undefined,
		);

		if (changed) {
			this.requestWaveformRender();
			this.updateMainControls();
		}
	}).call(ctx, event);
}

export function onPianoRollZoomWheel(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const wheelEvent = event.originalEvent as WheelEvent | undefined;
		const deltaY = wheelEvent ? normalizeWaveformWheelDelta(wheelEvent) : 0;
		if (
			typeof deltaY !== "number" ||
			!Number.isFinite(deltaY) ||
			deltaY === 0
		) {
			return;
		}

		const wrapper = closestInRoot(this.root, event.target, ".piano-roll-wrap");
		if (!wrapper) {
			return;
		}

		const seekWrap = wrapper.querySelector(
			'.seekwrap[data-seek-surface="piano-roll"]',
		);
		if (!(seekWrap instanceof HTMLElement)) {
			return;
		}

		const zoomDuration = this.getSeekTimelineContext(seekWrap).duration;
		if (!this.renderer.isPianoRollZoomEnabled(seekWrap, zoomDuration)) {
			return;
		}

		const currentZoom = this.renderer.getPianoRollZoom(seekWrap);
		if (currentZoom === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const zoomFactor = Math.exp(-1 * deltaY * WAVEFORM_WHEEL_ZOOM_SPEED);
		const nextZoom = currentZoom * zoomFactor;
		const changed = this.renderer.setPianoRollZoom(
			seekWrap,
			nextZoom,
			zoomDuration,
			Number.isFinite(event.pageX) ? event.pageX : undefined,
		);

		if (changed) {
			this.updateMainControls();
		}
	}).call(ctx, event);
}

function updateTimelineMinimapDrag(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
	) {
		if (!this.waveformMinimapDragState) {
			return false;
		}

		if (event.type === "touchmove" && this.getActiveTouchCount(event) >= 2) {
			this.endWaveformMinimapDrag();
			return false;
		}

		if (!Number.isFinite(event.pageX)) {
			return true;
		}

		const rect =
			this.waveformMinimapDragState.minimapNode.getBoundingClientRect();
		const minimapWidth = Math.max(
			1,
			rect.width || this.waveformMinimapDragState.minimapNode.clientWidth,
		);
		const ownerWindow = getOwnerWindow(
			this.waveformMinimapDragState.minimapNode,
		);
		const pointerRatio = clamp(
			((event.pageX as number) - (rect.left + ownerWindow.scrollX)) /
				minimapWidth,
			0,
			1,
		);
		const seekWrap = this.waveformMinimapDragState.seekWrap;
		const startRatio =
			pointerRatio - this.waveformMinimapDragState.pointerOffsetRatio;
		if (this.isPianoRollSeekSurface(seekWrap)) {
			this.renderer.setPianoRollMinimapViewportStart(seekWrap, startRatio);
		} else {
			this.renderer.setWaveformMinimapViewportStart(seekWrap, startRatio);
		}
		return true;
	}.call(ctx, event);
}

export function updateWaveformMinimapDrag(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	return updateTimelineMinimapDrag(ctx, event);
}

export function endWaveformMinimapDrag(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		this.waveformMinimapDragState = null;
	}).call(ctx);
}

export function requestWaveformRender(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.waveformRenderFrameId !== null) {
			return;
		}

		this.waveformRenderFrameId = requestAnimationFrame(() => {
			this.waveformRenderFrameId = null;
			this.renderer.renderWaveforms(
				this.waveformEngine,
				this.runtimes,
				this.longestDuration,
				this.getWaveformTimelineProjector(),
				this.getWaveformTimelineContext(),
			);
		});
	}).call(ctx);
}

export function isWaveformSeekSurface(
	ctx: TrackSwitchControllerImpl,
	seekWrap: HTMLElement | null,
): boolean {
	return function (
		this: TrackSwitchControllerImpl,
		seekWrap: HTMLElement | null,
	) {
		return (
			!!seekWrap && seekWrap.getAttribute("data-seek-surface") === "waveform"
		);
	}.call(ctx, seekWrap);
}

export function isPianoRollSeekSurface(
	ctx: TrackSwitchControllerImpl,
	seekWrap: HTMLElement | null,
): boolean {
	return function (
		this: TrackSwitchControllerImpl,
		seekWrap: HTMLElement | null,
	) {
		return (
			!!seekWrap && seekWrap.getAttribute("data-seek-surface") === "piano-roll"
		);
	}.call(ctx, seekWrap);
}

export function startInteractiveSeek(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	seekWrap: HTMLElement,
): void {
	(function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
		seekWrap: HTMLElement,
	) {
		this.seekingElement = seekWrap;
		this.seekFromEvent(event, true);
		this.dispatch({ type: "set-seeking", seeking: true });
		this.disableLoopWhenSeekOutsideRegion();
	}).call(ctx, event, seekWrap);
}

export function disableLoopWhenSeekOutsideRegion(
	ctx: TrackSwitchControllerImpl,
): void {
	(function (this: TrackSwitchControllerImpl) {
		if (
			this.state.loop.enabled &&
			this.state.loop.pointA !== null &&
			this.state.loop.pointB !== null &&
			(this.state.position < this.state.loop.pointA ||
				this.state.position > this.state.loop.pointB)
		) {
			this.state = {
				...this.state,
				loop: {
					...this.state.loop,
					enabled: false,
				},
			};
		}
	}).call(ctx);
}

export function tryStartPendingWaveformTouchSeek(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	seekWrap: HTMLElement | null,
): boolean {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
		seekWrap: HTMLElement | null,
	) {
		if (
			event.type !== "touchstart" ||
			(!this.isWaveformSeekSurface(seekWrap) &&
				!this.isPianoRollSeekSurface(seekWrap)) ||
			this.getActiveTouchCount(event) !== 1 ||
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

		this.pendingWaveformTouchSeek = {
			seekWrap: seekWrap,
			startPageX: event.pageX as number,
			startPageY: event.pageY as number,
		};
		this.seekingElement = seekWrap;
		return true;
	}.call(ctx, event, seekWrap);
}

export function tryActivatePendingWaveformTouchSeek(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
	) {
		if (!this.pendingWaveformTouchSeek) {
			return false;
		}

		if (this.getActiveTouchCount(event) >= 2) {
			return false;
		}

		if (!Number.isFinite(event.pageX)) {
			return false;
		}

		if (!Number.isFinite(event.pageY)) {
			return false;
		}

		const deltaX = Math.abs(
			(event.pageX as number) - this.pendingWaveformTouchSeek.startPageX,
		);
		const deltaY = Math.abs(
			(event.pageY as number) - this.pendingWaveformTouchSeek.startPageY,
		);

		if (deltaY >= this.touchSeekMoveThresholdPx && deltaY > deltaX) {
			this.pendingWaveformTouchSeek = null;
			this.seekingElement = null;
			return false;
		}

		if (deltaX < this.touchSeekMoveThresholdPx || deltaX < deltaY) {
			return false;
		}

		const seekWrap = this.pendingWaveformTouchSeek.seekWrap;
		this.pendingWaveformTouchSeek = null;
		this.startInteractiveSeek(event, seekWrap);
		return true;
	}.call(ctx, event);
}

export function applyPendingWaveformTouchSeekTap(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!this.pendingWaveformTouchSeek) {
			return;
		}

		if (Number.isFinite(event.pageX) && Number.isFinite(event.pageY)) {
			const deltaX = Math.abs(
				(event.pageX as number) - this.pendingWaveformTouchSeek.startPageX,
			);
			const deltaY = Math.abs(
				(event.pageY as number) - this.pendingWaveformTouchSeek.startPageY,
			);
			if (
				deltaX >= this.touchSeekMoveThresholdPx ||
				deltaY >= this.touchSeekMoveThresholdPx
			) {
				this.pendingWaveformTouchSeek = null;
				this.seekingElement = null;
				return;
			}
		}

		this.seekingElement = this.pendingWaveformTouchSeek.seekWrap;
		this.pendingWaveformTouchSeek = null;
		this.seekFromEvent(event, false);
	}).call(ctx, event);
}

export function getTouchPair(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): [Touch, Touch] | null {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
	) {
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
	}.call(ctx, event);
}

export function getTouchDistance(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): number | null {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
	) {
		const touchPair = this.getTouchPair(event);
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
	}.call(ctx, event);
}

export function getTouchCenterPageX(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): number | null {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
	) {
		const touchPair = this.getTouchPair(event);
		if (!touchPair) {
			return null;
		}

		const [first, second] = touchPair;
		return (first.pageX + second.pageX) / 2;
	}.call(ctx, event);
}

export function getActiveTouchCount(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): number {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
	) {
		const touchEvent = event.originalEvent as TouchEvent | undefined;
		if (!touchEvent?.touches) {
			return 0;
		}

		return touchEvent.touches.length;
	}.call(ctx, event);
}

export function tryStartPinchZoom(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	seekWrap: HTMLElement | null,
): boolean {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
		seekWrap: HTMLElement | null,
	) {
		if (event.type !== "touchstart") {
			return false;
		}

		if (this.pinchZoomState) {
			return true;
		}

		if (
			!seekWrap ||
			(seekWrap.getAttribute("data-seek-surface") !== "waveform" &&
				seekWrap.getAttribute("data-seek-surface") !== "piano-roll")
		) {
			return false;
		}

		const zoomDuration = this.getSeekTimelineContext(seekWrap).duration;
		const zoomEnabled = this.isPianoRollSeekSurface(seekWrap)
			? this.renderer.isPianoRollZoomEnabled(seekWrap, zoomDuration)
			: this.renderer.isWaveformZoomEnabled(seekWrap, zoomDuration);
		if (!zoomEnabled) {
			return false;
		}

		const initialDistance = this.getTouchDistance(event);
		if (initialDistance === null) {
			return false;
		}

		const initialZoom = this.isPianoRollSeekSurface(seekWrap)
			? this.renderer.getPianoRollZoom(seekWrap)
			: this.renderer.getWaveformZoom(seekWrap);
		if (initialZoom === null) {
			return false;
		}

		this.pinchZoomState = {
			seekWrap: seekWrap,
			initialDistance: initialDistance,
			initialZoom: initialZoom,
		};
		this.pendingWaveformTouchSeek = null;
		this.waveformMinimapDragState = null;

		if (this.state.currentlySeeking) {
			this.dispatch({ type: "set-seeking", seeking: false });
		}
		this.seekingElement = seekWrap;
		this.rightClickDragging = false;
		this.loopDragStart = null;
		this.draggingMarker = null;
		return true;
	}.call(ctx, event, seekWrap);
}

export function updatePinchZoom(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): boolean {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
	) {
		if (!this.pinchZoomState) {
			return false;
		}

		const distance = this.getTouchDistance(event);
		if (distance === null) {
			this.endPinchZoom();
			return false;
		}

		const anchorPageX = this.getTouchCenterPageX(event);
		const scale = distance / this.pinchZoomState.initialDistance;
		const zoomDuration = this.getSeekTimelineContext(
			this.pinchZoomState.seekWrap,
		).duration;
		const changed = this.isPianoRollSeekSurface(this.pinchZoomState.seekWrap)
			? this.renderer.setPianoRollZoom(
					this.pinchZoomState.seekWrap,
					this.pinchZoomState.initialZoom * scale,
					zoomDuration,
					anchorPageX === null ? undefined : anchorPageX,
				)
			: this.renderer.setWaveformZoom(
					this.pinchZoomState.seekWrap,
					this.pinchZoomState.initialZoom * scale,
					zoomDuration,
					anchorPageX === null ? undefined : anchorPageX,
				);

		if (changed) {
			if (this.isWaveformSeekSurface(this.pinchZoomState.seekWrap)) {
				this.requestWaveformRender();
			}
			this.updateMainControls();
		}

		return true;
	}.call(ctx, event);
}

export function endPinchZoom(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		this.pinchZoomState = null;
		if (this.state.currentlySeeking) {
			this.dispatch({ type: "set-seeking", seeking: false });
		}
		this.pendingWaveformTouchSeek = null;
		this.seekingElement = null;
	}).call(ctx);
}

export function trackIndexFromTarget(
	ctx: TrackSwitchControllerImpl,
	target: EventTarget | null,
): number {
	return function (
		this: TrackSwitchControllerImpl,
		target: EventTarget | null,
	) {
		const track = closestInRoot(this.root, target, ".track[data-track-index]");
		if (!track) {
			return -1;
		}

		const rawIndex = track.getAttribute("data-track-index");
		const parsed = Number(rawIndex);
		if (!Number.isFinite(parsed) || parsed < 0) {
			return -1;
		}

		return Math.floor(parsed);
	}.call(ctx, target);
}

/**
 * Which `trackList` the clicked row lives in — a track may be listed by several,
 * and only the one that was clicked decides how the toggle behaves.
 */
export function trackGroupIndexFromTarget(
	ctx: TrackSwitchControllerImpl,
	target: EventTarget | null,
): number {
	return function (
		this: TrackSwitchControllerImpl,
		target: EventTarget | null,
	) {
		const list = closestInRoot(
			this.root,
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
	}.call(ctx, target);
}

export function isFixedWaveformLocalAxisEnabled(
	ctx: TrackSwitchControllerImpl,
): boolean {
	return function (this: TrackSwitchControllerImpl) {
		return (
			this.isAlignmentMode() && !!this.alignment && !this.globalSyncEnabled
		);
	}.call(ctx);
}

export function getSeekTimelineContext(
	ctx: TrackSwitchControllerImpl,
	seekingElement: HTMLElement | null,
): SeekTimelineContext {
	return function (
		this: TrackSwitchControllerImpl,
		seekingElement: HTMLElement | null,
	) {
		const referenceContext: SeekTimelineContext = {
			duration: this.longestDuration,
			toReferenceTime: (timelineTime: number): number =>
				clamp(timelineTime, 0, this.longestDuration),
			fromReferenceTime: (referenceTime: number): number =>
				clamp(referenceTime, 0, this.longestDuration),
		};

		if (!seekingElement) {
			return referenceContext;
		}

		if (this.isPianoRollSeekSurface(seekingElement) && this.isAlignmentMode()) {
			const pianoRollSurface =
				this.renderer.findPianoRollSurface(seekingElement);
			return (
				this.getPianoRollTimelineContext(pianoRollSurface) || referenceContext
			);
		}

		if (this.isAlignmentMode()) {
			const imageSurface = this.renderer.findImageSurface(seekingElement);
			if (imageSurface) {
				return this.getImageTimelineContext(imageSurface) || referenceContext;
			}
		}

		if (!this.isFixedWaveformLocalAxisEnabled()) {
			return referenceContext;
		}

		const waveformSurface = this.renderer.findWaveformSurface(seekingElement);
		if (!waveformSurface) {
			return referenceContext;
		}

		const trackIndex = resolveAudibleWaveformTrackIndex(
			this.runtimes,
			waveformSurface.waveformSource,
			this.isAlignmentMode(),
			(trackIndex: number) => this.isTrackExclusive(trackIndex),
		);
		if (trackIndex === null) {
			return referenceContext;
		}
		const runtime = this.runtimes[trackIndex];
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
		for (let i = 0; i < this.runtimes.length; i++) {
			const rt = this.runtimes[i];
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
				this.trackPlaybackAnchor(
					trackIndex,
					clamp(sharedTime, 0, trackDuration),
				),
			playbackPosition: () => this.trackPlaybackPosition(trackIndex),
			toReferenceTime: (sharedTime: number): number => {
				const clampedTrackTime = clamp(sharedTime, 0, trackDuration);
				return clamp(
					this.trackToReferenceTime(
						trackIndex,
						clampedTrackTime,
						this.state.position,
					),
					0,
					this.longestDuration,
				);
			},
			fromReferenceTime: (referenceTime: number): number => {
				const clampedReferenceTime = clamp(
					referenceTime,
					0,
					this.longestDuration,
				);
				return clamp(
					this.referenceToTrackTime(trackIndex, clampedReferenceTime),
					0,
					trackDuration,
				);
			},
		};
	}.call(ctx, seekingElement);
}

export function getPianoRollTimelineContext(
	ctx: TrackSwitchControllerImpl,
	pianoRollSurface: PianoRollSeekSurfaceMetadata | null,
): SeekTimelineContext | null {
	return function (
		this: TrackSwitchControllerImpl,
		pianoRollSurface: PianoRollSeekSurfaceMetadata | null,
	) {
		if (!pianoRollSurface || !this.isAlignmentMode()) {
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
				this,
				pianoRollTimeline,
				pianoRollDuration,
			) ?? {
				// No timeline declared for this MIDI: it shares the reference
				// timeline, so local and reference coordinates coincide.
				duration: pianoRollDuration,
				toReferenceTime: (pianoRollTime: number): number =>
					clamp(pianoRollTime, 0, this.longestDuration),
				fromReferenceTime: (referenceTime: number): number =>
					clamp(referenceTime, 0, pianoRollDuration),
			}
		);
	}.call(ctx, pianoRollSurface);
}

export function getImageTimelineContext(
	ctx: TrackSwitchControllerImpl,
	imageSurface: ImageSeekSurfaceMetadata | null,
): SeekTimelineContext | null {
	return function (
		this: TrackSwitchControllerImpl,
		imageSurface: ImageSeekSurfaceMetadata | null,
	) {
		if (!imageSurface || !this.isAlignmentMode()) {
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
		return buildProjectedTimelineContext(
			this,
			timelineId(alignmentColumn),
			100,
		);
	}.call(ctx, imageSurface);
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
	return function (this: TrackSwitchControllerImpl) {
		return {
			enabled: this.isFixedWaveformLocalAxisEnabled(),
			referenceToTrackTime: (
				trackIndex: number,
				referenceTime: number,
			): number => {
				const runtime = this.runtimes[trackIndex];
				if (!runtime) {
					return 0;
				}

				const trackDuration = (
					ctx.constructor as typeof TrackSwitchControllerImpl
				).getRuntimeDuration(runtime);
				if (!Number.isFinite(trackDuration) || trackDuration <= 0) {
					return 0;
				}

				const clampedReferenceTime = clamp(
					referenceTime,
					0,
					this.longestDuration,
				);
				return clamp(
					this.referenceToTrackTime(trackIndex, clampedReferenceTime),
					0,
					trackDuration,
				);
			},
			getPlaybackPosition: (trackIndex: number): number | null => {
				const position = this.trackPlaybackPosition(trackIndex);
				if (position === null) {
					return null;
				}

				const runtime = this.runtimes[trackIndex];
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
				const runtime = this.runtimes[trackIndex];
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
			getTrackCount: (): number => this.runtimes.length,
			getTrackAlignmentPoints: (
				trackIndex: number,
			): Array<{ referenceTime: number; trackTime: number }> => {
				return this.getTrackAlignmentPoints(trackIndex);
			},
		};
	}.call(ctx);
}

export function getWaveformTimelineProjector(
	ctx: TrackSwitchControllerImpl,
): TrackTimelineProjector | undefined {
	return function (this: TrackSwitchControllerImpl) {
		if (!this.isAlignmentMode() || !this.alignment) {
			return undefined;
		}

		const trackIndexByRuntime = new Map<TrackRuntime, number>();
		const trackIndexByDefinition = new Map<object, number>();

		this.runtimes.forEach((runtime: TrackRuntime, index: number) => {
			trackIndexByRuntime.set(runtime, index);
			trackIndexByDefinition.set(runtime.definition, index);
		});

		return (runtime: TrackRuntime, trackTimelineTime: number): number => {
			const directIndex = trackIndexByRuntime.get(runtime);
			if (directIndex !== undefined) {
				return this.trackToReferenceTime(directIndex, trackTimelineTime);
			}

			const definitionIndex = trackIndexByDefinition.get(runtime.definition);
			if (definitionIndex !== undefined) {
				return this.trackToReferenceTime(definitionIndex, trackTimelineTime);
			}

			return trackTimelineTime;
		};
	}.call(ctx);
}
