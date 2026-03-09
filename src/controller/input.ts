import { closestInRoot, eventTargetAsElement } from '../shared/dom';
import { parseStrictNonNegativeInt } from '../shared/preset';
import { getSeekMetrics, isPrimaryInput } from '../shared/seek';
import {
    isKeyboardControllerActive,
    setActiveKeyboardController,
} from './registry';
import { activateLoopRange } from './playback';

const SHORTCUT_HELP_BLOCKED_KEYS = new Set([
    ' ',
    'Spacebar',
    'Space',
    'Escape',
    'Esc',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'r',
    'R',
    'a',
    'A',
    'b',
    'B',
    'l',
    'L',
    'c',
    'C',
]);

const SHORTCUT_HELP_BLOCKED_CODES = new Set([
    'KeyR',
    'KeyA',
    'KeyB',
    'KeyL',
    'KeyC',
]);

const KEYBOARD_SHORTCUT_HANDLERS: Record<string, (controller: any, event: any) => boolean> = {
    ' ': function(controller: any) {
        controller.togglePlay();
        return true;
    },
    Spacebar: function(controller: any) {
        controller.togglePlay();
        return true;
    },
    Space: function(controller: any) {
        controller.togglePlay();
        return true;
    },
    Escape: function(controller: any) {
        controller.stop();
        return true;
    },
    Esc: function(controller: any) {
        controller.stop();
        return true;
    },
    ArrowLeft: function(controller: any, event: any) {
        controller.seekRelative(event.shiftKey ? -5 : -2);
        return true;
    },
    ArrowRight: function(controller: any, event: any) {
        controller.seekRelative(event.shiftKey ? 5 : 2);
        return true;
    },
    ArrowUp: function(controller: any) {
        if (!controller.features.globalVolume) {
            return false;
        }
        controller.setVolume(controller.state.volume + 0.1);
        return true;
    },
    ArrowDown: function(controller: any) {
        if (!controller.features.globalVolume) {
            return false;
        }
        controller.setVolume(controller.state.volume - 0.1);
        return true;
    },
    Home: function(controller: any) {
        controller.seekTo(0);
        return true;
    },
    r: function(controller: any) {
        controller.dispatch({ type: 'toggle-repeat' });
        controller.updateMainControls();
        return true;
    },
    R: function(controller: any) {
        controller.dispatch({ type: 'toggle-repeat' });
        controller.updateMainControls();
        return true;
    },
    KeyR: function(controller: any) {
        controller.dispatch({ type: 'toggle-repeat' });
        controller.updateMainControls();
        return true;
    },
    a: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('A');
        return true;
    },
    A: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('A');
        return true;
    },
    KeyA: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('A');
        return true;
    },
    b: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('B');
        return true;
    },
    B: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('B');
        return true;
    },
    KeyB: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('B');
        return true;
    },
    l: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.toggleLoop();
        return true;
    },
    L: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.toggleLoop();
        return true;
    },
    KeyL: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.toggleLoop();
        return true;
    },
    c: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.clearLoop();
        return true;
    },
    C: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.clearLoop();
        return true;
    },
    KeyC: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.clearLoop();
        return true;
    },
};

function isShortcutHelpToggleKey(event: { key?: string; code?: string }): boolean {
    return event.key === 'F1' || event.code === 'F1';
}

function isShortcutSuppressedWhileHelpOpen(key: string, code: string, trackIndex: number | null): boolean {
    if (trackIndex !== null) {
        return true;
    }

    return SHORTCUT_HELP_BLOCKED_KEYS.has(key) || SHORTCUT_HELP_BLOCKED_CODES.has(code);
}

function toggleSoloFromPointerEvent(controller: any, event: any): void {
    const index = controller.trackIndexFromTarget(event.target ?? null);
    if (index < 0) {
        return;
    }

    if (
        event.shiftKey
        && !controller.features.exclusiveSolo
        && controller.runtimes[index]
        && controller.runtimes[index].state.solo
    ) {
        const selectedCount = controller.runtimes.reduce(function(count: number, runtime: any) {
            return count + (runtime.state.solo ? 1 : 0);
        }, 0);

        if (selectedCount === 1) {
            controller.runtimes.forEach(function(runtime: any) {
                runtime.state.solo = true;
            });
            controller.applyTrackProperties();
            controller.updateMainControls();
            return;
        }
    }

    controller.toggleSolo(index, !!event.shiftKey);
}

function parseSliderValue(target: HTMLInputElement): number {
    return parseFloat(target.value || '0') / 100;
}

function getTrackInputTarget(controller: any, event: any): { target: HTMLInputElement; trackIndex: number } | null {
    const target = eventTargetAsElement(event.target ?? null);
    if (!(target instanceof HTMLInputElement)) {
        return null;
    }

    const trackIndex = controller.trackIndexFromTarget(target);
    if (trackIndex < 0) {
        return null;
    }

    return {
        target: target,
        trackIndex: trackIndex,
    };
}

function resolveWaveformMinimapStart(controller: any, event: any): {
    minimapNode: HTMLElement;
    seekWrap: HTMLElement;
    pointerRatio: number;
    pointerOffsetRatio: number;
} | null {
    const minimapNode = closestInRoot(controller.root, event.target, '.waveform-zoom-minimap');
    if (!minimapNode || !Number.isFinite(event.pageX)) {
        return null;
    }

    const wrapper = closestInRoot(controller.root, event.target, '.waveform-wrap');
    if (!wrapper) {
        return null;
    }

    const seekWrap = wrapper.querySelector('.seekwrap[data-seek-surface="waveform"]');
    if (!(seekWrap instanceof HTMLElement)) {
        return null;
    }

    const viewport = controller.renderer.getWaveformMinimapViewport(seekWrap);
    if (!viewport || viewport.widthRatio >= 1) {
        return null;
    }

    const rect = minimapNode.getBoundingClientRect();
    const minimapWidth = Math.max(1, rect.width || minimapNode.clientWidth);
    const pointerRatio = Math.max(
        0,
        Math.min(1, (((event.pageX as number) - (rect.left + window.scrollX)) / minimapWidth))
    );
    const isInsideViewport = pointerRatio >= viewport.startRatio
        && pointerRatio <= (viewport.startRatio + viewport.widthRatio);

    return {
        minimapNode: minimapNode,
        seekWrap: seekWrap,
        pointerRatio: pointerRatio,
        pointerOffsetRatio: isInsideViewport
            ? (pointerRatio - viewport.startRatio)
            : (viewport.widthRatio / 2),
    };
}

function finishSeekEndInteraction(controller: any, event: any): boolean {
    if (controller.waveformMinimapDragState) {
        controller.endWaveformMinimapDrag();
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (controller.pendingWaveformTouchSeek) {
        if (event.type === 'touchend' && controller.getActiveTouchCount(event) === 0) {
            controller.applyPendingWaveformTouchSeekTap(event);
        } else {
            controller.pendingWaveformTouchSeek = null;
        }

        controller.seekingElement = null;
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (controller.pinchZoomState) {
        if (controller.getActiveTouchCount(event) >= 2) {
            event.preventDefault();
            return true;
        }

        controller.endPinchZoom();
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    return false;
}

function finalizeRightClickLoopSelection(controller: any): void {
    controller.rightClickDragging = false;
    controller.loopDragStart = null;
    const seekTimelineContext = controller.getSeekTimelineContext(controller.seekingElement);

    if (controller.state.loop.pointA !== null && controller.state.loop.pointB !== null) {
        let loopA = controller.state.loop.pointA;
        let loopB = controller.state.loop.pointB;

        if (loopA > loopB) {
            const swappedA = loopB;
            const swappedB = loopA;
            controller.state = {
                ...controller.state,
                loop: {
                    ...controller.state.loop,
                    pointA: swappedA,
                    pointB: swappedB,
                },
            };
            loopA = swappedA;
            loopB = swappedB;
        }

        const localLoopA = seekTimelineContext.fromReferenceTime(loopA);
        const localLoopB = seekTimelineContext.fromReferenceTime(loopB);
        if (Math.abs(localLoopB - localLoopA) >= controller.loopMinDistance) {
            activateLoopRange(controller, loopA, loopB);
        } else {
            controller.state = {
                ...controller.state,
                loop: {
                    ...controller.state.loop,
                    pointA: null,
                    pointB: null,
                    enabled: false,
                },
            };
        }
    }
}

function handleShortcutHelpKeyboard(controller: any, event: any, key: string, code: string, trackIndex: number | null): boolean {
    if (!controller.shortcutHelpOpen) {
        return false;
    }

    if (key === 'Escape' || key === 'Esc') {
        event.preventDefault();
        controller.closeShortcutHelp();
        event.stopPropagation();
        return true;
    }

    if (isShortcutSuppressedWhileHelpOpen(key, code, trackIndex)) {
        event.preventDefault();
        event.stopPropagation();
    }

    return true;
}

function handleTrackKeyboardSelection(controller: any, event: any, trackIndex: number | null): boolean {
    if (trackIndex === null || trackIndex >= controller.runtimes.length) {
        return false;
    }

    event.preventDefault();
    controller.toggleSolo(trackIndex, controller.effectiveSingleSoloMode);
    event.stopPropagation();
    return true;
}

function handleGlobalKeyboardShortcut(controller: any, event: any, key: string): boolean {
    const handler = KEYBOARD_SHORTCUT_HANDLERS[key];
    if (!handler) {
        return false;
    }

    const handled = handler(controller, event);
    if (!handled) {
        return false;
    }

    event.preventDefault();
    return true;
}

export function setKeyboardActive(ctx: any): any {
    return (function(this: any) {
        setActiveKeyboardController(this.instanceId);
    }).call(ctx);
}

export function openShortcutHelp(ctx: any): any {
    return (function(this: any) {
        if (this.shortcutHelpOpen) {
            return;
        }

        this.shortcutHelpOpen = true;
        this.renderer.setShortcutHelpVisible(true);
    }).call(ctx);
}

export function toggleShortcutHelp(ctx: any): any {
    return (function(this: any) {
        if (this.shortcutHelpOpen) {
            this.closeShortcutHelp();
            return;
        }

        this.openShortcutHelp();
    }).call(ctx);
}

export function closeShortcutHelp(ctx: any): any {
    return (function(this: any) {
        if (!this.shortcutHelpOpen) {
            return;
        }

        this.shortcutHelpOpen = false;
        this.renderer.setShortcutHelpVisible(false);
    }).call(ctx);
}

export function onOverlayActivate(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event) && event.type !== 'click') {
            return;
        }

        event.preventDefault();
        this.setKeyboardActive();
        this.audioEngine.primeFromUserGesture();
        void this.load();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onOverlayInfo(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        event.preventDefault();
        this.renderer.showOverlayInfoText();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onShortcutHelpOverlay(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const target = eventTargetAsElement(event.target ?? null);
        if (target && target.closest('.shortcut-help-panel')) {
            return;
        }

        event.preventDefault();
        this.setKeyboardActive();
        this.closeShortcutHelp();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onPlayPause(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        this.audioEngine.primeFromUserGesture();
        this.togglePlay();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onStop(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        this.stop();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onRepeat(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        this.dispatch({ type: 'toggle-repeat' });
        this.updateMainControls();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onSeekStart(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.isLoaded) {
            return;
        }

        if (isPrimaryInput(event) && closestInRoot(this.root, event.target, '.loop-marker')) {
            return;
        }

        const targetSeekWrap = closestInRoot(this.root, event.target, '.seekwrap');

        if (this.tryStartPinchZoom(event, targetSeekWrap)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (this.tryStartPendingWaveformTouchSeek(event, targetSeekWrap)) {
            return;
        }

        if (this.features.looping && event.type === 'mousedown' && event.which === 3) {
            event.preventDefault();

            this.rightClickDragging = true;
            this.seekingElement = targetSeekWrap;
            const seekTimelineContext = this.getSeekTimelineContext(this.seekingElement);

            const seekMetrics = getSeekMetrics(this.seekingElement, event, seekTimelineContext.duration);
            if (!seekMetrics) {
                this.rightClickDragging = false;
                return;
            }

            this.loopDragStart = seekMetrics.time;
            const loopStartReference = seekTimelineContext.toReferenceTime(seekMetrics.time);
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

export function onWaveformMinimapStart(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.isLoaded || !isPrimaryInput(event) || this.pinchZoomState) {
            return;
        }

        if (event.type === 'touchstart' && this.getActiveTouchCount(event) !== 1) {
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
            this.dispatch({ type: 'set-seeking', seeking: false });
        }

        this.renderer.setWaveformMinimapViewportStart(
            minimapStart.seekWrap,
            minimapStart.pointerRatio - minimapStart.pointerOffsetRatio
        );
        event.preventDefault();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onSeekEnd(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.isLoaded) {
            return;
        }

        if (finishSeekEndInteraction(this, event)) {
            return;
        }

        const hasActiveSeekInteraction = this.draggingMarker !== null
            || this.rightClickDragging
            || this.state.currentlySeeking
            || this.seekingElement !== null;

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

        this.dispatch({ type: 'set-seeking', seeking: false });
        event.stopPropagation();
    }).call(ctx, event);
}

export function onSolo(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        toggleSoloFromPointerEvent(this, event);
    }).call(ctx, event);
}

export function onTrackRowToggle(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }

        const target = eventTargetAsElement(event.target ?? null);
        if (target && (target.closest('.track-mix-controls') || target.closest('.control .solo'))) {
            return;
        }

        event.preventDefault();
        toggleSoloFromPointerEvent(this, event);
    }).call(ctx, event);
}

export function onAlignmentSync(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        this.toggleGlobalSync();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onVolume(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const target = eventTargetAsElement(event.target ?? null);
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        const volume = parseFloat(target.value || '0') / 100;
        this.setVolume(volume);
    }).call(ctx, event);
}

export function onVolumeReset(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        event.preventDefault();
        this.setVolume(1);
        event.stopPropagation();
    }).call(ctx, event);
}

export function onTrackVolume(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const trackInput = getTrackInputTarget(this, event);
        if (!trackInput) {
            return;
        }

        this.setTrackVolume(trackInput.trackIndex, parseSliderValue(trackInput.target));
    }).call(ctx, event);
}

export function onTrackVolumeReset(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const trackInput = getTrackInputTarget(this, event);
        if (!trackInput) {
            return;
        }

        event.preventDefault();
        this.setTrackVolume(trackInput.trackIndex, 1);
        event.stopPropagation();
    }).call(ctx, event);
}

export function onTrackPan(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const trackInput = getTrackInputTarget(this, event);
        if (!trackInput) {
            return;
        }

        this.setTrackPan(trackInput.trackIndex, parseSliderValue(trackInput.target));
    }).call(ctx, event);
}

export function onTrackPanReset(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const trackInput = getTrackInputTarget(this, event);
        if (!trackInput) {
            return;
        }

        event.preventDefault();
        this.setTrackPan(trackInput.trackIndex, 0);
        event.stopPropagation();
    }).call(ctx, event);
}

export function onPreset(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const target = eventTargetAsElement(event.target ?? null);
        const selector = target?.closest('.preset-selector');
        if (!(selector instanceof HTMLSelectElement)) {
            return;
        }

        let presetIndex = parseStrictNonNegativeInt(selector.value || '0');
        if (!Number.isFinite(presetIndex)) {
            presetIndex = 0;
        }

        this.applyPreset(presetIndex);
    }).call(ctx, event);
}

export function onPresetScroll(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        event.preventDefault();

        const target = eventTargetAsElement(event.target ?? null);
        const selector = target?.closest('.preset-selector');
        if (!(selector instanceof HTMLSelectElement)) {
            return;
        }

        let currentIndex = parseStrictNonNegativeInt(selector.value || '0');
        if (!Number.isFinite(currentIndex)) {
            currentIndex = 0;
        }

        const maxIndex = selector.options.length - 1;
        const deltaY = (event as unknown as { deltaY?: number }).deltaY ?? event.originalEvent?.deltaY ?? 0;

        if (deltaY > 0) {
            currentIndex = Math.min(currentIndex + 1, maxIndex);
        } else if (deltaY < 0) {
            currentIndex = Math.max(currentIndex - 1, 0);
        }

        selector.value = String(currentIndex);
        selector.dispatchEvent(new Event('change', { bubbles: true }));
    }).call(ctx, event);
}

export function onSetLoopA(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }
        event.preventDefault();
        this.setLoopPoint('A');
        event.stopPropagation();
    }).call(ctx, event);
}

export function onSetLoopB(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }
        event.preventDefault();
        this.setLoopPoint('B');
        event.stopPropagation();
    }).call(ctx, event);
}

export function onToggleLoop(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }
        event.preventDefault();
        this.toggleLoop();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onClearLoop(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!isPrimaryInput(event)) {
            return;
        }
        event.preventDefault();
        this.clearLoop();
        event.stopPropagation();
    }).call(ctx, event);
}

export function onMarkerDragStart(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.features.looping || !isPrimaryInput(event) || this.pinchZoomState) {
            return;
        }

        const target = eventTargetAsElement(event.target ?? null);
        if (!target) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (target.classList.contains('marker-a')) {
            this.draggingMarker = 'A';
        } else if (target.classList.contains('marker-b')) {
            this.draggingMarker = 'B';
        }

        this.seekingElement = closestInRoot(this.root, event.target, '.seekwrap');
    }).call(ctx, event);
}

export function onKeyboard(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.features.keyboard || !isKeyboardControllerActive(this.instanceId)) {
            return;
        }

        const target = eventTargetAsElement(event.target ?? null);
        if (target && target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]')) {
            return;
        }

        const key = event.key || event.code;
        const code = event.code || '';
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

export function getKeyboardTrackIndex(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const key = event.key;
        const code = event.code;

        if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
            return 9;
        }

        if (key && key >= '1' && key <= '9') {
            return Number(key) - 1;
        }

        if (code && code >= 'Digit1' && code <= 'Digit9') {
            return Number(code.slice(-1)) - 1;
        }

        if (code && code >= 'Numpad1' && code <= 'Numpad9') {
            return Number(code.slice(-1)) - 1;
        }

        return null;
    }).call(ctx, event);
}

export function onResize(ctx: any): any {
    return (function(this: any) {
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
                this.getWaveformTimelineContext()
            );
            this.sheetMusicEngine.resize();
        }, 300);
    }).call(ctx);
}
