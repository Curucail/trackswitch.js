// @ts-nocheck
import {
    AlignmentOutOfRangeMode,
    LoopMarker,
    PlayerState,
    TrackAlignmentConfig,
    TrackSourceVariant,
    TrackRuntime,
    TrackSwitchConfig,
    TrackSwitchController,
    TrackSwitchEventHandler,
    TrackSwitchEventMap,
    TrackSwitchEventName,
    TrackSwitchFeatures,
    TrackSwitchSnapshot,
    TrackSwitchUiState,
} from '../domain/types';
import { normalizeFeatures } from '../domain/options';
import { createInitialPlayerState, playerStateReducer, PlayerAction } from '../domain/state';
import { createTrackRuntime } from '../domain/runtime';
import { AudioEngine } from '../engine/audio-engine';
import { SheetMusicEngine } from '../engine/sheet-music-engine';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import { ViewRenderer, WarpingMatrixRenderContext, WaveformTimelineContext } from '../ui/view-renderer';
import { InputBinder, InputController } from '../input/input-binder';
import { eventTargetAsElement } from '../shared/dom';
import { clamp } from '../shared/math';
import { derivePresetNames, parseStrictNonNegativeInt } from '../shared/preset';
import { ControllerPointerEvent, getSeekMetrics, isPrimaryInput } from '../shared/seek';
import {
    buildColumnTimeMapping,
    loadNumericCsv,
    mapTime,
    resolveAlignmentOutOfRangeMode,
    TimeMappingSeries,
} from '../shared/alignment';
import {
    allocateInstanceId,
    isKeyboardControllerActive,
    pauseOtherControllers,
    registerController,
    setActiveKeyboardController,
    unregisterController,
} from './controller-registry';

function closestInRoot(root: HTMLElement, target: EventTarget | null | undefined, selector: string): HTMLElement | null {
    const element = eventTargetAsElement(target ?? null);
    if (!element) {
        return null;
    }

    const matched = element.closest(selector);
    if (!matched || !root.contains(matched)) {
        return null;
    }

    return matched as HTMLElement;
}

interface TrackAlignmentConverter {
    referenceToTrack: TimeMappingSeries;
    trackToReference: TimeMappingSeries;
}

interface AlignmentContext {
    referenceDuration: number;
    outOfRange: AlignmentOutOfRangeMode;
    converters: Map<number, TrackAlignmentConverter>;
    columnByTrack: Map<number, string>;
    uniqueColumnOrder: string[];
}

interface SeekTimelineContext {
    duration: number;
    toReferenceTime(timelineTime: number): number;
    fromReferenceTime(referenceTime: number): number;
}

interface PinchZoomState {
    seekWrap: HTMLElement;
    initialDistance: number;
    initialZoom: number;
}

interface PendingWaveformTouchSeek {
    seekWrap: HTMLElement;
    startPageX: number;
    startPageY: number;
}


export function setKeyboardActive(ctx: any): any {
    return (function(this: any) {
        setActiveKeyboardController(this.instanceId);
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

export function onSeekEnd(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.isLoaded) {
            return;
        }

        if (this.pendingWaveformTouchSeek) {
            if (event.type === 'touchend' && this.getActiveTouchCount(event) === 0) {
                this.applyPendingWaveformTouchSeekTap(event);
            } else {
                this.pendingWaveformTouchSeek = null;
            }

            this.seekingElement = null;
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (this.pinchZoomState) {
            if (this.getActiveTouchCount(event) >= 2) {
                event.preventDefault();
                return;
            }

            this.endPinchZoom();
            event.preventDefault();
            event.stopPropagation();
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
            this.rightClickDragging = false;
            this.loopDragStart = null;
            const seekTimelineContext = this.getSeekTimelineContext(this.seekingElement);

            if (this.state.loop.pointA !== null && this.state.loop.pointB !== null) {
                let loopA = this.state.loop.pointA;
                let loopB = this.state.loop.pointB;

                if (loopA > loopB) {
                    const swappedA = loopB;
                    const swappedB = loopA;
                    this.state = {
                        ...this.state,
                        loop: {
                            ...this.state.loop,
                            pointA: swappedA,
                            pointB: swappedB,
                        },
                    };
                    loopA = swappedA;
                    loopB = swappedB;
                }

                const localLoopA = seekTimelineContext.fromReferenceTime(loopA);
                const localLoopB = seekTimelineContext.fromReferenceTime(loopB);
                if (Math.abs(localLoopB - localLoopA) >= this.loopMinDistance) {
                    this.state = {
                        ...this.state,
                        loop: {
                            ...this.state.loop,
                            enabled: true,
                        },
                    };

                    if (this.state.playing && (this.state.position < loopA || this.state.position > loopB)) {
                        this.stopAudio();
                        this.startAudio(loopA);
                    }
                } else {
                    this.state = {
                        ...this.state,
                        loop: {
                            ...this.state.loop,
                            pointA: null,
                            pointB: null,
                            enabled: false,
                        },
                    };
                }
            }

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

        const index = this.trackIndexFromTarget(event.target ?? null);
        if (index >= 0) {
            this.toggleSolo(index, !!event.shiftKey);
        }
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

export function onTrackVolume(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const target = eventTargetAsElement(event.target ?? null);
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        const trackIndex = this.trackIndexFromTarget(target);
        if (trackIndex < 0) {
            return;
        }

        const volume = parseFloat(target.value || '0') / 100;
        this.setTrackVolume(trackIndex, volume);
    }).call(ctx, event);
}

export function onTrackPan(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const target = eventTargetAsElement(event.target ?? null);
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        const trackIndex = this.trackIndexFromTarget(target);
        if (trackIndex < 0) {
            return;
        }

        const pan = parseFloat(target.value || '0') / 100;
        this.setTrackPan(trackIndex, pan);
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
        let handled = false;

        const trackIndex = this.getKeyboardTrackIndex(event);
        if (trackIndex !== null && trackIndex < this.runtimes.length) {
            event.preventDefault();
            this.toggleSolo(trackIndex, this.effectiveSingleSoloMode);
            handled = true;
        }

        if (handled) {
            event.stopPropagation();
            return;
        }

        switch (key) {
            case ' ':
            case 'Spacebar':
            case 'Space':
                event.preventDefault();
                this.togglePlay();
                handled = true;
                break;

            case 'Escape':
            case 'Esc':
                event.preventDefault();
                this.stop();
                handled = true;
                break;

            case 'ArrowLeft':
                event.preventDefault();
                this.seekRelative(event.shiftKey ? -5 : -2);
                handled = true;
                break;

            case 'ArrowRight':
                event.preventDefault();
                this.seekRelative(event.shiftKey ? 5 : 2);
                handled = true;
                break;

            case 'ArrowUp':
                if (this.features.globalVolume) {
                    event.preventDefault();
                    this.setVolume(this.state.volume + 0.1);
                    handled = true;
                }
                break;

            case 'ArrowDown':
                if (this.features.globalVolume) {
                    event.preventDefault();
                    this.setVolume(this.state.volume - 0.1);
                    handled = true;
                }
                break;

            case 'Home':
                event.preventDefault();
                this.seekTo(0);
                handled = true;
                break;

            case 'r':
            case 'R':
            case 'KeyR':
                event.preventDefault();
                this.dispatch({ type: 'toggle-repeat' });
                this.updateMainControls();
                handled = true;
                break;

            case 'a':
            case 'A':
            case 'KeyA':
                if (this.features.looping) {
                    event.preventDefault();
                    this.setLoopPoint('A');
                    handled = true;
                }
                break;

            case 'b':
            case 'B':
            case 'KeyB':
                if (this.features.looping) {
                    event.preventDefault();
                    this.setLoopPoint('B');
                    handled = true;
                }
                break;

            case 'l':
            case 'L':
            case 'KeyL':
                if (this.features.looping) {
                    event.preventDefault();
                    this.toggleLoop();
                    handled = true;
                }
                break;

            case 'c':
            case 'C':
            case 'KeyC':
                if (this.features.looping) {
                    event.preventDefault();
                    this.clearLoop();
                    handled = true;
                }
                break;
        }

        if (handled) {
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
