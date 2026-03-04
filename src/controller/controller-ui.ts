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


export function applyTrackProperties(ctx: any): any {
    return (function(this: any) {
        const panSupported = this.audioEngine.supportsStereoPanning();
        if (!panSupported) {
            this.runtimes.forEach((runtime: TrackRuntime) => {
                runtime.state.pan = 0;
            });
        }

        this.renderer.updateTrackControls(
            this.runtimes,
            this.syncLockedTrackIndexes,
            this.effectiveSingleSoloMode,
            panSupported
        );
        this.audioEngine.applyTrackStateGains(this.runtimes);
        this.renderer.switchPosterImage(this.runtimes);
        this.renderer.renderWaveforms(
            this.waveformEngine,
            this.runtimes,
            this.longestDuration,
            this.getWaveformTimelineProjector(),
            this.getWaveformTimelineContext()
        );

        this.runtimes.forEach((runtime: TrackRuntime, index: number) => {
            this.emit('trackState', {
                index: index,
                state: {
                    solo: runtime.state.solo,
                    volume: runtime.state.volume,
                    pan: runtime.state.pan,
                },
            });
        });
    }).call(ctx);
}

export function updateMainControls(ctx: any): any {
    return (function(this: any) {
        const uiState: TrackSwitchUiState = {
            playing: this.state.playing,
            repeat: this.state.repeat,
            position: this.state.position,
            longestDuration: this.longestDuration,
            syncEnabled: this.globalSyncEnabled,
            syncAvailable: this.isAlignmentMode()
                && this.runtimes.some((runtime: TrackRuntime) => this.hasSyncedVariant(runtime)),
            loop: {
                pointA: this.state.loop.pointA,
                pointB: this.state.loop.pointB,
                enabled: this.state.loop.enabled,
            },
        };

        this.renderer.updateMainControls(
            uiState,
            this.runtimes,
            this.getWaveformTimelineContext(),
            this.getWarpingMatrixContext()
        );
        this.sheetMusicEngine.updatePosition(this.state.position);

        this.emit('position', {
            position: this.state.position,
            duration: this.longestDuration,
        });
    }).call(ctx);
}
