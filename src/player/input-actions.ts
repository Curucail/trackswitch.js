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
	(function (this: TrackSwitchControllerImpl) {
		setActiveKeyboardController(this.instanceId);
	}).call(ctx);
}

export function openShortcutHelp(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.shortcutHelpOpen) {
			return;
		}
		if (this.markerNavigationDialogOpen) {
			closeMarkerNavigationDialog(this);
		}

		this.shortcutHelpOpen = true;
		this.renderer.setShortcutHelpVisible(true);
	}).call(ctx);
}

export function toggleShortcutHelp(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.shortcutHelpOpen) {
			this.closeShortcutHelp();
			return;
		}

		this.openShortcutHelp();
	}).call(ctx);
}

export function closeShortcutHelp(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (!this.shortcutHelpOpen) {
			return;
		}

		this.shortcutHelpOpen = false;
		this.renderer.setShortcutHelpVisible(false);
	}).call(ctx);
}

export function toggleFullscreen(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		this.fullscreen = !this.fullscreen;
		this.renderer.setFullscreen(this.fullscreen);
		this.updateMainControls();
	}).call(ctx);
}

export function onFullscreenToggle(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}

		event.preventDefault();
		this.toggleFullscreen();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onOverlayActivate(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (this.root.classList.contains("error")) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		if (!isPrimaryInput(event) && event.type !== "click") {
			return;
		}

		event.preventDefault();
		this.setKeyboardActive();
		this.audioEngine.primeFromUserGesture();
		void this.load();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onShortcutHelpOverlay(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const target = eventTargetAsElement(event.target ?? null);
		if (target?.closest(".shortcut-help-panel")) {
			return;
		}

		event.preventDefault();
		this.setKeyboardActive();
		this.closeShortcutHelp();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onPlayPause(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}

		event.preventDefault();
		this.audioEngine.primeFromUserGesture();
		this.togglePlay();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onStop(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}

		event.preventDefault();
		this.stop();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onRepeat(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}

		event.preventDefault();
		this.dispatch({ type: "toggle-repeat" });
		this.updateMainControls();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onSeekStart(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!this.isLoaded) {
			return;
		}

		if (
			isPrimaryInput(event) &&
			closestInRoot(this.root, event.target, ".loop-marker, .timeline-marker")
		) {
			return;
		}

		const targetSeekWrap = closestInRoot(this.root, event.target, ".seekwrap");

		if (this.tryStartPinchZoom(event, targetSeekWrap)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		if (this.tryStartPendingWaveformTouchSeek(event, targetSeekWrap)) {
			return;
		}

		if (
			this.navigationBar?.controls.includes("looping") &&
			event.type === "mousedown" &&
			event.which === 3
		) {
			event.preventDefault();

			this.rightClickDragging = true;
			this.seekingElement = targetSeekWrap;
			const seekTimelineContext = this.getSeekTimelineContext(
				this.seekingElement,
			);

			const seekMetrics = getSeekMetrics(
				this.seekingElement,
				event,
				seekTimelineContext.duration,
			);
			if (!seekMetrics) {
				this.rightClickDragging = false;
				return;
			}

			this.loopDragStart = snapLoopStartToMarker(
				this,
				this.seekingElement,
				event,
				seekMetrics.time,
			);
			const loopStartReference = seekTimelineContext.toReferenceTime(
				this.loopDragStart,
			);
			this.state = {
				...this.state,
				loop: {
					...this.state.loop,
					pointA: loopStartReference,
					pointB: loopStartReference,
					enabled: false,
				},
			};

			this.updateMainControls();
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

		this.startInteractiveSeek(event, targetSeekWrap);

		event.stopPropagation();
	}).call(ctx, event);
}

export function onTimelineMarkerActivate(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (event.which !== undefined && event.which !== 1) {
			return;
		}

		const target = eventTargetAsElement(event.target ?? null);
		const marker = target?.closest(".timeline-marker");
		if (!(marker instanceof HTMLElement) || !this.root.contains(marker)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.setKeyboardActive();
		marker
			.closest(".timeline-marker-layer")
			?.querySelectorAll<HTMLElement>(".timeline-marker")
			.forEach((candidate: HTMLElement) => {
				candidate.tabIndex = candidate === marker ? 0 : -1;
			});
		activateTimelineMarker(this, marker);
	}).call(ctx, event);
}

export function onTimelineMarkerKeydown(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const target = eventTargetAsElement(event.target ?? null);
		const marker = target?.closest(".timeline-marker");
		if (!(marker instanceof HTMLElement) || !this.root.contains(marker)) {
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
			activateTimelineMarker(this, marker);
		}
	}).call(ctx, event);
}

export function onAdjacentMarker(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
	direction: "previous" | "next",
): void {
	(function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
		direction: "previous" | "next",
	) {
		event.preventDefault();
		event.stopPropagation();
		this.setKeyboardActive();
		this.seekToAdjacentMarker(direction);
	}).call(ctx, event, direction);
}

export function onMarkerNavigationOpen(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		this.setKeyboardActive();
		openMarkerNavigationDialog(this);
	}).call(ctx, event);
}

export function onMarkerNavigationOverlay(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const target = eventTargetAsElement(event.target ?? null);
		if (target?.closest(".marker-navigation-dialog")) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		closeMarkerNavigationDialog(this);
	}).call(ctx, event);
}

export function onMarkerNavigationInput(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const target = eventTargetAsElement(event.target ?? null);
		this.renderer.handleMarkerNavigationInteraction(event.type, target);
	}).call(ctx, event);
}

export function onMarkerNavigationSubmit(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (!this.renderer.validateMarkerNavigationDialogSelections()) {
			return;
		}
		submitMarkerNavigationDialog(
			this,
			this.renderer.readMarkerNavigationDialogValues(),
		);
	}).call(ctx, event);
}

export function onMarkerNavigationKeydown(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const target = eventTargetAsElement(event.target ?? null);
		if (
			this.renderer.handleMarkerNavigationComboboxKeydown(
				event.key ?? "",
				target,
			)
		) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			closeMarkerNavigationDialog(this);
			return;
		}
		if (event.key === "Tab") {
			event.preventDefault();
			event.stopPropagation();
			this.renderer.trapMarkerNavigationDialogFocus(!!event.shiftKey);
		}
	}).call(ctx, event);
}

export function onWaveformMinimapStart(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!this.isLoaded || !isPrimaryInput(event) || this.pinchZoomState) {
			return;
		}

		if (event.type === "touchstart" && this.getActiveTouchCount(event) !== 1) {
			return;
		}

		const minimapStart = resolveWaveformMinimapStart(this, event);
		if (!minimapStart) {
			return;
		}

		this.waveformMinimapDragState = {
			seekWrap: minimapStart.seekWrap,
			minimapNode: minimapStart.minimapNode,
			pointerOffsetRatio: minimapStart.pointerOffsetRatio,
		};
		this.pendingWaveformTouchSeek = null;
		this.seekingElement = null;
		this.rightClickDragging = false;
		this.loopDragStart = null;
		this.draggingMarker = null;
		if (this.state.currentlySeeking) {
			this.dispatch({ type: "set-seeking", seeking: false });
		}

		this.renderer.setWaveformMinimapViewportStart(
			minimapStart.seekWrap,
			minimapStart.pointerRatio - minimapStart.pointerOffsetRatio,
		);
		event.preventDefault();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onPianoRollMinimapStart(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!this.isLoaded || !isPrimaryInput(event) || this.pinchZoomState) {
			return;
		}

		if (event.type === "touchstart" && this.getActiveTouchCount(event) !== 1) {
			return;
		}

		const minimapStart = resolvePianoRollMinimapStart(this, event);
		if (!minimapStart) {
			return;
		}

		this.waveformMinimapDragState = {
			seekWrap: minimapStart.seekWrap,
			minimapNode: minimapStart.minimapNode,
			pointerOffsetRatio: minimapStart.pointerOffsetRatio,
		};
		this.pendingWaveformTouchSeek = null;
		this.seekingElement = null;
		this.rightClickDragging = false;
		this.loopDragStart = null;
		this.draggingMarker = null;
		if (this.state.currentlySeeking) {
			this.dispatch({ type: "set-seeking", seeking: false });
		}

		this.renderer.setPianoRollMinimapViewportStart(
			minimapStart.seekWrap,
			minimapStart.pointerRatio - minimapStart.pointerOffsetRatio,
		);
		event.preventDefault();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onSeekEnd(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!this.isLoaded) {
			return;
		}

		if (finishSeekEndInteraction(this, event)) {
			return;
		}

		const hasActiveSeekInteraction =
			this.draggingMarker !== null ||
			this.rightClickDragging ||
			this.state.currentlySeeking ||
			this.seekingElement !== null;

		if (!hasActiveSeekInteraction) {
			return;
		}

		event.preventDefault();

		if (this.draggingMarker !== null) {
			this.draggingMarker = null;
			this.updateMainControls();
			event.stopPropagation();
			return;
		}

		if (this.rightClickDragging) {
			finalizeRightClickLoopSelection(this);
			this.updateMainControls();
			event.stopPropagation();
			return;
		}

		if (this.state.currentlySeeking && this.state.playing) {
			this.stopAudio();
			this.startAudio();
		}

		this.dispatch({ type: "set-seeking", seeking: false });
		event.stopPropagation();
	}).call(ctx, event);
}

export function onSolo(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}

		event.preventDefault();
		toggleSoloFromPointerEvent(this, event);
	}).call(ctx, event);
}

export function onTrackRowToggle(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}

		const target = eventTargetAsElement(event.target ?? null);
		if (
			target &&
			(target.closest(".track-mix-controls") ||
				target.closest(".control .solo"))
		) {
			return;
		}

		event.preventDefault();
		toggleSoloFromPointerEvent(this, event);
	}).call(ctx, event);
}

export function onAlignmentSync(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}

		event.preventDefault();
		this.toggleGlobalSync();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onVolume(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const target = eventTargetAsElement(event.target ?? null);
		if (!(target instanceof HTMLInputElement)) {
			return;
		}

		const volume = parseFloat(target.value || "0") / 100;
		this.setVolume(volume);
	}).call(ctx, event);
}

export function onVolumeReset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		event.preventDefault();
		this.setVolume(1);
		event.stopPropagation();
	}).call(ctx, event);
}

export function onGlobalPan(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const target = eventTargetAsElement(event.target ?? null);
		if (!(target instanceof HTMLInputElement)) {
			return;
		}

		this.setPan(parsePanSliderValue(target));
	}).call(ctx, event);
}

export function onGlobalPanReset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		event.preventDefault();
		this.setPan(0);
		event.stopPropagation();
	}).call(ctx, event);
}

export function onTrackVolume(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const trackInput = getTrackInputTarget(this, event);
		if (!trackInput) {
			return;
		}

		this.setTrackVolume(
			trackInput.trackIndex,
			parseSliderValue(trackInput.target),
		);
	}).call(ctx, event);
}

export function onTrackVolumeReset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const trackInput = getTrackInputTarget(this, event);
		if (!trackInput) {
			return;
		}

		event.preventDefault();
		this.setTrackVolume(trackInput.trackIndex, 1);
		event.stopPropagation();
	}).call(ctx, event);
}

export function onTrackPan(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const trackInput = getTrackInputTarget(this, event);
		if (!trackInput) {
			return;
		}

		this.setTrackPan(
			trackInput.trackIndex,
			parsePanSliderValue(trackInput.target),
		);
	}).call(ctx, event);
}

export function onTrackPanReset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const trackInput = getTrackInputTarget(this, event);
		if (!trackInput) {
			return;
		}

		event.preventDefault();
		this.setTrackPan(trackInput.trackIndex, 0);
		event.stopPropagation();
	}).call(ctx, event);
}

export function onPreset(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		const target = eventTargetAsElement(event.target ?? null);
		const selector = target?.closest(".preset-selector");
		if (!(selector instanceof HTMLSelectElement)) {
			return;
		}

		this.applyPreset(selector.value);
	}).call(ctx, event);
}

export function onPresetScroll(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
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
	}).call(ctx, event);
}

export function onSetLoopA(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}
		event.preventDefault();
		if (this.state.currentlySeeking) {
			this.dispatch({ type: "set-seeking", seeking: false });
		}
		this.setLoopPoint("A");
		event.stopPropagation();
	}).call(ctx, event);
}

export function onSetLoopB(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}
		event.preventDefault();
		if (this.state.currentlySeeking) {
			this.dispatch({ type: "set-seeking", seeking: false });
		}
		this.setLoopPoint("B");
		event.stopPropagation();
	}).call(ctx, event);
}

export function onToggleLoop(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}
		event.preventDefault();
		this.toggleLoop();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onClearLoop(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (!isPrimaryInput(event)) {
			return;
		}
		event.preventDefault();
		this.clearLoop();
		event.stopPropagation();
	}).call(ctx, event);
}

export function onMarkerDragStart(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (
			!this.navigationBar?.controls.includes("looping") ||
			!isPrimaryInput(event) ||
			this.pinchZoomState
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
			this.draggingMarker = "A";
		} else if (target.classList.contains("marker-b")) {
			this.draggingMarker = "B";
		}

		this.seekingElement = closestInRoot(this.root, event.target, ".seekwrap");
	}).call(ctx, event);
}

export function onKeyboard(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	(function (this: TrackSwitchControllerImpl, event: ControllerPointerEvent) {
		if (
			!this.features.keyboard ||
			!isKeyboardControllerActive(this.instanceId) ||
			this.markerNavigationDialogOpen
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
		const trackIndex = this.getKeyboardTrackIndex(event);

		if (isShortcutHelpToggleKey(event)) {
			event.preventDefault();
			this.toggleShortcutHelp();
			event.stopPropagation();
			return;
		}

		if (handleShortcutHelpKeyboard(this, event, key, code, trackIndex)) {
			return;
		}

		if (handleTrackKeyboardSelection(this, event, trackIndex)) {
			return;
		}

		if (handleGlobalKeyboardShortcut(this, event, key)) {
			event.stopPropagation();
		}
	}).call(ctx, event);
}

export function getKeyboardTrackIndex(
	ctx: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): number | null {
	return function (
		this: TrackSwitchControllerImpl,
		event: ControllerPointerEvent,
	) {
		return getKeyboardTrackIndexFromEvent(event);
	}.call(ctx, event);
}

export function onResize(ctx: TrackSwitchControllerImpl): void {
	(function (this: TrackSwitchControllerImpl) {
		if (this.resizeDebounceTimer) {
			clearTimeout(this.resizeDebounceTimer);
		}

		this.resizeDebounceTimer = setTimeout(() => {
			this.renderer.reflowWaveforms();
			this.renderer.renderWaveforms(
				this.waveformEngine,
				this.runtimes,
				this.longestDuration,
				this.getWaveformTimelineProjector(),
				this.getWaveformTimelineContext(),
			);
			this.renderer.renderPianoRollDisplays(
				this.longestDuration,
				this.isAlignmentMode(),
			);
			this.sheetMusicEngine.resize();
			if (this.fullscreen) {
				this.renderer.refreshFullscreenPanelHeights();
			}
			this.updateMainControls();
		}, 300);
	}).call(ctx);
}
