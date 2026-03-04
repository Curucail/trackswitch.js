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


export function getState(ctx: any): any {
    return (function(this: any) {
        return {
            isLoaded: this.isLoaded,
            isLoading: this.isLoading,
            isDestroyed: this.isDestroyed,
            longestDuration: this.longestDuration,
            features: { ...this.features },
            state: {
                ...this.state,
                loop: { ...this.state.loop },
            },
            tracks: this.runtimes.map(function(runtime) {
                return {
                    solo: runtime.state.solo,
                    volume: runtime.state.volume,
                    pan: runtime.state.pan,
                };
            }),
        };
    }).call(ctx);
}

export function on(ctx: any, eventName: any, handler: any): any {
    return (function(this: any, eventName: any, handler: any) {
        this.listeners[eventName].add(handler as unknown as (payload: unknown) => void);
        return () => this.off(eventName, handler);
    }).call(ctx, eventName, handler);
}

export function off(ctx: any, eventName: any, handler: any): any {
    return (function(this: any, eventName: any, handler: any) {
        this.listeners[eventName].delete(handler as unknown as (payload: unknown) => void);
    }).call(ctx, eventName, handler);
}

export function emit(ctx: any, eventName: any, payload: any): any {
    return (function(this: any, eventName: any, payload: any) {
        this.listeners[eventName].forEach(function(handler) {
            handler(payload);
        });
    }).call(ctx, eventName, payload);
}
