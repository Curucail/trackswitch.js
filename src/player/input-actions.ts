import { closestInRoot, eventTargetAsElement } from "../shared/dom";
import {
	type ControllerPointerEvent,
	getSeekMetrics,
	isPrimaryInput,
} from "../shared/seek";
import {
	finalizeRightClickLoopSelection,
	finishSeekEndInteraction,
	resolvePianoRollMinimapStart,
	resolveWaveformMinimapStart,
} from "./input-seek-helpers";
import {
	getKeyboardTrackIndex as getKeyboardTrackIndexFromEvent,
	handleGlobalKeyboardShortcut,
	handleShortcutHelpKeyboard,
	handleTrackKeyboardSelection,
	isShortcutHelpToggleKey,
} from "./input-shortcuts";
import {
	getTrackInputTarget,
	parsePanSliderValue,
	parseSliderValue,
	toggleSoloFromPointerEvent,
} from "./input-track-controls";
import {
	activateTimelineMarker,
	closeMarkerNavigationDialog,
	moveTimelineMarkerFocus,
	openMarkerNavigationDialog,
	snapLoopStartToMarker,
	submitMarkerNavigationDialog,
} from "./marker-actions";
import type { TrackSwitchControllerImpl } from "./player-controller";
import {
	isKeyboardControllerActive,
	setActiveKeyboardController,
} from "./player-registry";

export function setKeyboardActive(ctx: TrackSwitchControllerImpl): void {
	setActiveKeyboardController(ctx.instanceId);
}

export function openShortcutHelp(ctx: TrackSwitchControllerImpl): void {
	if (ctx.shortcutHelpOpen) {
		return;
	}
	if (ctx.markerNavigationDialogOpen) {
		closeMarkerNavigationDialog(ctx);
	}

	ctx.shortcutHelpOpen = true;
	ctx.renderer.setShortcutHelpVisible(true);
}

export function toggleShortcutHelp(ctx: TrackSwitchControllerImpl): void {
	if (ctx.shortcutHelpOpen) {
		ctx.closeShortcutHelp();
		return;
	}

	ctx.openShortcutHelp();
}

export function closeShortcutHelp(ctx: TrackSwitchControllerImpl): void {
	if (!ctx.shortcutHelpOpen) {
		return;
	}

	ctx.shortcutHelpOpen = false;
	ctx.renderer.setShortcutHelpVisible(false);
}

export function toggleFullscreen(ctx: TrackSwitchControllerImpl): void {
	ctx.fullscreen = !ctx.fullscreen;
	ctx.renderer.setFullscreen(ctx.fullscreen);
	ctx.updateMainControls();
}

export function onFullscreenToggle(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}

	event.preventDefault();
	ctx.toggleFullscreen();
	event.stopPropagation();
}

export function onOverlayActivate(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (ctx.root.classList.contains("error")) {
		event.preventDefault();
		event.stopPropagation();
		return;
	}

	if (!isPrimaryInput(event) && event.type !== "click") {
		return;
	}

	event.preventDefault();
	ctx.setKeyboardActive();
	ctx.audioEngine.primeFromUserGesture();
	void ctx.load();
	event.stopPropagation();
}

export function onShortcutHelpOverlay(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const target = eventTargetAsElement(event.target ?? null);
	if (target?.closest(".shortcut-help-panel")) {
		return;
	}

	event.preventDefault();
	ctx.setKeyboardActive();
	ctx.closeShortcutHelp();
	event.stopPropagation();
}

export function onPlayPause(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}

	event.preventDefault();
	ctx.audioEngine.primeFromUserGesture();
	ctx.togglePlay();
	event.stopPropagation();
}

export function onStop(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}

	event.preventDefault();
	ctx.stop();
	event.stopPropagation();
}

export function onRepeat(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}

	event.preventDefault();
	ctx.dispatch({ type: "toggle-repeat" });
	ctx.updateMainControls();
	event.stopPropagation();
}

export function onSeekStart(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!ctx.isLoaded) {
		return;
	}

	if (
		isPrimaryInput(event) &&
		closestInRoot(ctx.root, event.target, ".loop-marker, .timeline-marker")
	) {
		return;
	}

	const targetSeekWrap = closestInRoot(ctx.root, event.target, ".seekwrap");

	if (ctx.tryStartPinchZoom(event, targetSeekWrap)) {
		event.preventDefault();
		event.stopPropagation();
		return;
	}

	if (ctx.tryStartPendingWaveformTouchSeek(event, targetSeekWrap)) {
		return;
	}

	if (
		ctx.navigationBar?.controls.includes("looping") &&
		event.type === "mousedown" &&
		event.which === 3
	) {
		event.preventDefault();

		ctx.rightClickDragging = true;
		ctx.seekingElement = targetSeekWrap;
		const seekTimelineContext = ctx.getSeekTimelineContext(ctx.seekingElement);

		const seekMetrics = getSeekMetrics(
			ctx.seekingElement,
			event,
			seekTimelineContext.duration,
		);
		if (!seekMetrics) {
			ctx.rightClickDragging = false;
			return;
		}

		ctx.loopDragStart = snapLoopStartToMarker(
			ctx,
			ctx.seekingElement,
			event,
			seekMetrics.time,
		);
		const loopStartReference = seekTimelineContext.toReferenceTime(
			ctx.loopDragStart,
		);
		ctx.state = {
			...ctx.state,
			loop: {
				...ctx.state.loop,
				pointA: loopStartReference,
				pointB: loopStartReference,
				enabled: false,
			},
		};

		ctx.updateMainControls();
		event.stopPropagation();
		return;
	}

	if (!isPrimaryInput(event)) {
		return;
	}

	event.preventDefault();
	if (!targetSeekWrap) {
		return;
	}

	ctx.startInteractiveSeek(event, targetSeekWrap);

	event.stopPropagation();
}

export function onTimelineMarkerActivate(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (event.which !== undefined && event.which !== 1) {
		return;
	}

	const target = eventTargetAsElement(event.target ?? null);
	const marker = target?.closest(".timeline-marker");
	if (!(marker instanceof HTMLElement) || !ctx.root.contains(marker)) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	ctx.setKeyboardActive();
	marker
		.closest(".timeline-marker-layer")
		?.querySelectorAll<HTMLElement>(".timeline-marker")
		.forEach((candidate: HTMLElement) => {
			candidate.tabIndex = candidate === marker ? 0 : -1;
		});
	activateTimelineMarker(ctx, marker);
}

export function onTimelineMarkerKeydown(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const target = eventTargetAsElement(event.target ?? null);
	const marker = target?.closest(".timeline-marker");
	if (!(marker instanceof HTMLElement) || !ctx.root.contains(marker)) {
		return;
	}

	if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
		event.preventDefault();
		event.stopPropagation();
		moveTimelineMarkerFocus(
			marker,
			event.key === "ArrowLeft" ? "previous" : "next",
		);
		return;
	}

	// Space remains the global play/pause shortcut while a marker has focus.
	if (event.key === "Enter") {
		event.preventDefault();
		event.stopPropagation();
		activateTimelineMarker(ctx, marker);
	}
}

export function onAdjacentMarker(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	direction: "previous" | "next",
): void {
	event.preventDefault();
	event.stopPropagation();
	ctx.setKeyboardActive();
	ctx.seekToAdjacentMarker(direction);
}

export function onMarkerNavigationOpen(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	event.preventDefault();
	event.stopPropagation();
	ctx.setKeyboardActive();
	openMarkerNavigationDialog(ctx);
}

export function onMarkerNavigationOverlay(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const target = eventTargetAsElement(event.target ?? null);
	if (target?.closest(".marker-navigation-dialog")) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	closeMarkerNavigationDialog(ctx);
}

export function onMarkerNavigationInput(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const target = eventTargetAsElement(event.target ?? null);
	ctx.renderer.handleMarkerNavigationInteraction(event.type, target);
}

export function onMarkerNavigationSubmit(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	event.preventDefault();
	event.stopPropagation();
	if (!ctx.renderer.validateMarkerNavigationDialogSelections()) {
		return;
	}
	submitMarkerNavigationDialog(
		ctx,
		ctx.renderer.readMarkerNavigationDialogValues(),
	);
}

export function onMarkerNavigationKeydown(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const target = eventTargetAsElement(event.target ?? null);
	if (
		ctx.renderer.handleMarkerNavigationComboboxKeydown(event.key ?? "", target)
	) {
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		closeMarkerNavigationDialog(ctx);
		return;
	}
	if (event.key === "Tab") {
		event.preventDefault();
		event.stopPropagation();
		ctx.renderer.trapMarkerNavigationDialogFocus(!!event.shiftKey);
	}
}

export function onWaveformMinimapStart(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!ctx.isLoaded || !isPrimaryInput(event) || ctx.pinchZoomState) {
		return;
	}

	if (event.type === "touchstart" && ctx.getActiveTouchCount(event) !== 1) {
		return;
	}

	const minimapStart = resolveWaveformMinimapStart(ctx, event);
	if (!minimapStart) {
		return;
	}

	ctx.waveformMinimapDragState = {
		seekWrap: minimapStart.seekWrap,
		minimapNode: minimapStart.minimapNode,
		pointerOffsetRatio: minimapStart.pointerOffsetRatio,
	};
	ctx.pendingWaveformTouchSeek = null;
	ctx.seekingElement = null;
	ctx.rightClickDragging = false;
	ctx.loopDragStart = null;
	ctx.draggingMarker = null;
	if (ctx.state.currentlySeeking) {
		ctx.dispatch({ type: "set-seeking", seeking: false });
	}

	ctx.renderer.setWaveformMinimapViewportStart(
		minimapStart.seekWrap,
		minimapStart.pointerRatio - minimapStart.pointerOffsetRatio,
	);
	event.preventDefault();
	event.stopPropagation();
}

export function onPianoRollMinimapStart(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!ctx.isLoaded || !isPrimaryInput(event) || ctx.pinchZoomState) {
		return;
	}

	if (event.type === "touchstart" && ctx.getActiveTouchCount(event) !== 1) {
		return;
	}

	const minimapStart = resolvePianoRollMinimapStart(ctx, event);
	if (!minimapStart) {
		return;
	}

	ctx.waveformMinimapDragState = {
		seekWrap: minimapStart.seekWrap,
		minimapNode: minimapStart.minimapNode,
		pointerOffsetRatio: minimapStart.pointerOffsetRatio,
	};
	ctx.pendingWaveformTouchSeek = null;
	ctx.seekingElement = null;
	ctx.rightClickDragging = false;
	ctx.loopDragStart = null;
	ctx.draggingMarker = null;
	if (ctx.state.currentlySeeking) {
		ctx.dispatch({ type: "set-seeking", seeking: false });
	}

	ctx.renderer.setPianoRollMinimapViewportStart(
		minimapStart.seekWrap,
		minimapStart.pointerRatio - minimapStart.pointerOffsetRatio,
	);
	event.preventDefault();
	event.stopPropagation();
}

export function onSeekEnd(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!ctx.isLoaded) {
		return;
	}

	if (finishSeekEndInteraction(ctx, event)) {
		return;
	}

	const hasActiveSeekInteraction =
		ctx.draggingMarker !== null ||
		ctx.rightClickDragging ||
		ctx.state.currentlySeeking ||
		ctx.seekingElement !== null;

	if (!hasActiveSeekInteraction) {
		return;
	}

	event.preventDefault();

	if (ctx.draggingMarker !== null) {
		ctx.draggingMarker = null;
		ctx.updateMainControls();
		event.stopPropagation();
		return;
	}

	if (ctx.rightClickDragging) {
		finalizeRightClickLoopSelection(ctx);
		ctx.updateMainControls();
		event.stopPropagation();
		return;
	}

	if (ctx.state.currentlySeeking && ctx.state.playing) {
		ctx.stopAudio();
		ctx.startAudio();
	}

	ctx.dispatch({ type: "set-seeking", seeking: false });
	event.stopPropagation();
}

export function onSolo(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}

	event.preventDefault();
	toggleSoloFromPointerEvent(ctx, event);
}

export function onTrackRowToggle(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}

	const target = eventTargetAsElement(event.target ?? null);
	if (
		target &&
		(target.closest(".track-mix-controls") || target.closest(".control .solo"))
	) {
		return;
	}

	event.preventDefault();
	toggleSoloFromPointerEvent(ctx, event);
}

export function onAlignmentSync(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}

	event.preventDefault();
	ctx.toggleGlobalSync();
	event.stopPropagation();
}

export function onVolume(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const target = eventTargetAsElement(event.target ?? null);
	if (!(target instanceof HTMLInputElement)) {
		return;
	}

	const volume = parseFloat(target.value || "0") / 100;
	ctx.setVolume(volume);
}

export function onVolumeReset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	event.preventDefault();
	ctx.setVolume(1);
	event.stopPropagation();
}

export function onGlobalPan(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const target = eventTargetAsElement(event.target ?? null);
	if (!(target instanceof HTMLInputElement)) {
		return;
	}

	ctx.setPan(parsePanSliderValue(target));
}

export function onGlobalPanReset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	event.preventDefault();
	ctx.setPan(0);
	event.stopPropagation();
}

export function onTrackVolume(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const trackInput = getTrackInputTarget(ctx, event);
	if (!trackInput) {
		return;
	}

	ctx.setTrackVolume(
		trackInput.trackIndex,
		parseSliderValue(trackInput.target),
	);
}

export function onTrackVolumeReset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const trackInput = getTrackInputTarget(ctx, event);
	if (!trackInput) {
		return;
	}

	event.preventDefault();
	ctx.setTrackVolume(trackInput.trackIndex, 1);
	event.stopPropagation();
}

export function onTrackPan(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const trackInput = getTrackInputTarget(ctx, event);
	if (!trackInput) {
		return;
	}

	ctx.setTrackPan(
		trackInput.trackIndex,
		parsePanSliderValue(trackInput.target),
	);
}

export function onTrackPanReset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const trackInput = getTrackInputTarget(ctx, event);
	if (!trackInput) {
		return;
	}

	event.preventDefault();
	ctx.setTrackPan(trackInput.trackIndex, 0);
	event.stopPropagation();
}

export function onPreset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const target = eventTargetAsElement(event.target ?? null);
	const selector = target?.closest(".preset-selector");
	if (!(selector instanceof HTMLSelectElement)) {
		return;
	}

	ctx.applyPreset(selector.value);
}

export function onPresetScroll(event: ControllerPointerEvent): void {
	event.preventDefault();

	const target = eventTargetAsElement(event.target ?? null);
	const selector = target?.closest(".preset-selector");
	if (!(selector instanceof HTMLSelectElement)) {
		return;
	}

	const maxIndex = selector.options.length - 1;
	let currentIndex = selector.selectedIndex;
	const deltaY =
		(event as unknown as { deltaY?: number }).deltaY ??
		event.originalEvent?.deltaY ??
		0;

	if (deltaY > 0) {
		currentIndex = Math.min(currentIndex + 1, maxIndex);
	} else if (deltaY < 0) {
		currentIndex = Math.max(currentIndex - 1, 0);
	}

	selector.selectedIndex = currentIndex;
	selector.dispatchEvent(new Event("change", { bubbles: true }));
}

export function onSetLoopA(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}
	event.preventDefault();
	if (ctx.state.currentlySeeking) {
		ctx.dispatch({ type: "set-seeking", seeking: false });
	}
	ctx.setLoopPoint("A");
	event.stopPropagation();
}

export function onSetLoopB(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}
	event.preventDefault();
	if (ctx.state.currentlySeeking) {
		ctx.dispatch({ type: "set-seeking", seeking: false });
	}
	ctx.setLoopPoint("B");
	event.stopPropagation();
}

export function onToggleLoop(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}
	event.preventDefault();
	ctx.toggleLoop();
	event.stopPropagation();
}

export function onClearLoop(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (!isPrimaryInput(event)) {
		return;
	}
	event.preventDefault();
	ctx.clearLoop();
	event.stopPropagation();
}

export function onMarkerDragStart(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (
		!ctx.navigationBar?.controls.includes("looping") ||
		!isPrimaryInput(event) ||
		ctx.pinchZoomState
	) {
		return;
	}

	const target = eventTargetAsElement(event.target ?? null);
	if (!target) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();

	if (target.classList.contains("marker-a")) {
		ctx.draggingMarker = "A";
	} else if (target.classList.contains("marker-b")) {
		ctx.draggingMarker = "B";
	}

	ctx.seekingElement = closestInRoot(ctx.root, event.target, ".seekwrap");
}

export function onKeyboard(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	if (
		!ctx.features.keyboard ||
		!isKeyboardControllerActive(ctx.instanceId) ||
		ctx.markerNavigationDialogOpen
	) {
		return;
	}

	const target = eventTargetAsElement(event.target ?? null);
	if (
		target?.closest(
			'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
		)
	) {
		return;
	}

	const key = event.key || event.code || "";
	const code = event.code || "";
	const trackIndex = ctx.getKeyboardTrackIndex(event);

	if (isShortcutHelpToggleKey(event)) {
		event.preventDefault();
		ctx.toggleShortcutHelp();
		event.stopPropagation();
		return;
	}

	if (handleShortcutHelpKeyboard(ctx, event, key, code, trackIndex)) {
		return;
	}

	if (handleTrackKeyboardSelection(ctx, event, trackIndex)) {
		return;
	}

	if (handleGlobalKeyboardShortcut(ctx, event, key)) {
		event.stopPropagation();
	}
}

export function getKeyboardTrackIndex(
	event: ControllerPointerEvent,
): number | null {
	return getKeyboardTrackIndexFromEvent(event);
}

export function onResize(ctx: TrackSwitchControllerImpl): void {
	if (ctx.resizeDebounceTimer) {
		clearTimeout(ctx.resizeDebounceTimer);
	}

	ctx.resizeDebounceTimer = setTimeout(() => {
		ctx.renderer.reflowWaveforms();
		ctx.renderer.renderWaveforms(
			ctx.waveformEngine,
			ctx.runtimes,
			ctx.longestDuration,
			ctx.getWaveformTimelineProjector(),
			ctx.getWaveformTimelineContext(),
		);
		ctx.renderer.renderPianoRollDisplays(
			ctx.longestDuration,
			ctx.isAlignmentMode(),
		);
		ctx.sheetMusicEngine.resize();
		if (ctx.fullscreen) {
			ctx.renderer.refreshFullscreenPanelHeights();
		}
		ctx.updateMainControls();
	}, 300);
}
