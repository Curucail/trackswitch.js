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
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import { ViewRenderer } from '../ui/view-renderer';
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
    referenceTrackIndex: number;
    outOfRange: AlignmentOutOfRangeMode;
    converters: Map<number, TrackAlignmentConverter>;
}

export class TrackSwitchControllerImpl implements TrackSwitchController, InputController {
    private readonly root: HTMLElement;
    private readonly features: TrackSwitchFeatures;
    private readonly audioEngine: AudioEngine;
    private readonly waveformEngine: WaveformEngine;
    private readonly renderer: ViewRenderer;
    private readonly inputBinder: InputBinder;
    private readonly alignmentConfig: TrackAlignmentConfig | undefined;

    private state: PlayerState;
    private longestDuration = 0;
    private runtimes: TrackRuntime[];

    private isLoaded = false;
    private isLoading = false;
    private isDestroyed = false;

    private timerMonitorPosition: ReturnType<typeof setInterval> | null = null;
    private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    private seekingElement: HTMLElement | null = null;
    private rightClickDragging = false;
    private loopDragStart: number | null = null;
    private draggingMarker: LoopMarker | null = null;
    private readonly loopMinDistance = 0.1;

    private iOSPlaybackUnlocked = false;
    private alignmentContext: AlignmentContext | null = null;
    private alignmentPlaybackTrackIndex: number | null = null;
    private globalSyncEnabled = false;
    private effectiveOnlyRadioSolo = false;
    private readonly syncLockedTrackIndexes = new Set<number>();
    private preSyncSoloTrackIndex: number | null = null;

    private readonly listeners: Record<TrackSwitchEventName, Set<(payload: unknown) => void>> = {
        loaded: new Set(),
        error: new Set(),
        position: new Set(),
        trackState: new Set(),
    };

    public readonly eventNamespace: string;
    public readonly instanceId: number;
    public readonly presetCount: number;

    constructor(rootElement: HTMLElement, config: TrackSwitchConfig) {
        this.root = rootElement;
        this.alignmentConfig = config.alignment;

        this.features = normalizeFeatures(config.features);
        if (this.features.mode === 'alignment_solo') {
            this.features.onlyradiosolo = true;
            this.features.radiosolo = true;
            this.features.mute = false;
            this.features.presets = false;
        }
        this.effectiveOnlyRadioSolo = this.features.mode === 'alignment_solo'
            ? true
            : this.features.onlyradiosolo;
        this.state = createInitialPlayerState(this.features.repeat);

        this.runtimes = config.tracks.map(function(track, index) {
            return createTrackRuntime(track, index);
        });

        if (
            this.features.radiosolo
            && this.runtimes.length > 0
            && !this.runtimes.some(function(runtime) { return runtime.state.solo; })
        ) {
            this.runtimes[0].state.solo = true;
        }

        const presetNames = !this.features.presets
            ? []
            : derivePresetNames(config);
        this.presetCount = presetNames.length;

        this.audioEngine = new AudioEngine(this.features, this.state.volume);
        this.waveformEngine = new WaveformEngine();
        this.renderer = new ViewRenderer(this.root, this.features, presetNames);

        this.instanceId = allocateInstanceId();

        this.eventNamespace = '.trackswitch.' + this.instanceId;

        this.renderer.initialize(this.runtimes);
        this.renderer.drawDummyWaveforms(this.waveformEngine);

        this.inputBinder = new InputBinder(this.root, this.features, this);
        this.inputBinder.bind();

        if (this.presetCount > 0) {
            this.applyPreset(0);
        } else {
            this.applyTrackProperties();
        }
        this.updateMainControls();

        if (this.runtimes.length === 0) {
            this.handleError('No tracks available.');
        }

        registerController(this);
    }

    async load(): Promise<void> {
        if (this.isDestroyed || this.isLoaded || this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.renderer.setOverlayLoading(true);

        const prepared = await this.audioEngine.prepareForPlaybackStart();
        if (!prepared) {
            this.isLoading = false;
            this.renderer.setOverlayLoading(false);
            this.handleError('Web Audio API is not supported in your browser. Please consider upgrading.');
            return;
        }

        if (!this.iOSPlaybackUnlocked) {
            this.iOSPlaybackUnlocked = true;
            await this.audioEngine.unlockIOSPlayback();
        }

        this.globalSyncEnabled = false;
        this.syncLockedTrackIndexes.clear();
        this.preSyncSoloTrackIndex = null;
        this.effectiveOnlyRadioSolo = this.isAlignmentSoloMode()
            ? true
            : this.features.onlyradiosolo;

        this.runtimes.forEach(function(runtime) {
            runtime.successful = false;
            runtime.errored = false;
            runtime.buffer = null;
            runtime.gainNode = null;
            runtime.timing = null;
            runtime.activeSource = null;
            runtime.sourceIndex = -1;
            runtime.activeVariant = 'base';
            runtime.baseSource = {
                buffer: null,
                timing: null,
                sourceIndex: -1,
            };
            runtime.syncedSource = null;
            runtime.waveformCache.clear();
        });

        await this.audioEngine.loadTracks(this.runtimes);

        if (this.isDestroyed) {
            return;
        }

        this.isLoading = false;
        this.renderer.setOverlayLoading(false);

        const erroredTracks = this.runtimes.filter(function(runtime) {
            return runtime.errored;
        });

        if (erroredTracks.length > 0) {
            this.handleError('One or more audio files failed to load.');
            return;
        }

        this.longestDuration = this.findLongestDuration();
        this.alignmentContext = null;
        this.alignmentPlaybackTrackIndex = null;

        if (this.features.mode === 'alignment_solo') {
            const alignmentError = await this.initializeAlignmentSolo();
            if (alignmentError) {
                this.handleError(alignmentError);
                return;
            }
        }

        if (this.isDestroyed) {
            return;
        }

        this.isLoaded = true;
        this.renderer.hideOverlayOnLoaded();

        this.updateMainControls();
        this.applyTrackProperties();

        this.emit('loaded', {
            longestDuration: this.longestDuration,
        });

        this.renderer.renderWaveforms(
            this.waveformEngine,
            this.runtimes,
            this.longestDuration,
            this.getWaveformTimelineProjector()
        );
    }

    destroy(): void {
        if (this.isDestroyed) {
            return;
        }
        this.isDestroyed = true;

        if (this.timerMonitorPosition) {
            clearInterval(this.timerMonitorPosition);
            this.timerMonitorPosition = null;
        }
        if (this.resizeDebounceTimer) {
            clearTimeout(this.resizeDebounceTimer);
            this.resizeDebounceTimer = null;
        }

        if (this.state.playing) {
            this.stopAudio();
        }

        this.inputBinder.unbind();
        this.renderer.destroy();
        this.audioEngine.disconnect();

        this.listeners.loaded.clear();
        this.listeners.error.clear();
        this.listeners.position.clear();
        this.listeners.trackState.clear();

        unregisterController(this);
    }

    togglePlay(): void {
        if (this.state.playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    play(): void {
        if (this.isDestroyed || !this.isLoaded) {
            return;
        }
        if (this.state.playing) {
            return;
        }

        let startPosition = this.state.position;

        if (
            this.features.looping
            && this.state.loop.enabled
            && this.state.loop.pointA !== null
            && this.state.loop.pointB !== null
            && (this.state.position < this.state.loop.pointA || this.state.position > this.state.loop.pointB)
        ) {
            startPosition = this.state.loop.pointA;
        }

        this.startAudio(startPosition);
        this.pauseOthers();
        this.dispatch({ type: 'set-playing', playing: true });
        this.updateMainControls();
    }

    pause(): void {
        if (!this.state.playing) {
            return;
        }

        const position = this.currentPlaybackReferencePosition();
        this.stopAudio();

        this.dispatch({ type: 'set-position', position: position });
        this.dispatch({ type: 'set-playing', playing: false });

        this.updateMainControls();
    }

    stop(): void {
        if (this.state.playing) {
            this.stopAudio();
        }

        this.dispatch({ type: 'set-position', position: 0 });
        this.dispatch({ type: 'set-playing', playing: false });
        this.updateMainControls();
    }

    seekTo(seconds: number): void {
        const nextPosition = clamp(seconds, 0, this.longestDuration);

        if (this.state.playing) {
            this.stopAudio();
            this.startAudio(nextPosition);
        } else {
            this.dispatch({ type: 'set-position', position: nextPosition });
        }

        this.updateMainControls();
    }

    seekRelative(seconds: number): void {
        let nextPosition = this.state.position + seconds;
        nextPosition = clamp(nextPosition, 0, this.longestDuration);

        if (
            this.features.looping
            && this.state.loop.enabled
            && this.state.loop.pointA !== null
            && this.state.loop.pointB !== null
        ) {
            const loopStart = this.state.loop.pointA;
            const loopEnd = this.state.loop.pointB;
            const loopLength = loopEnd - loopStart;
            if (loopLength > 0) {
                let relative = nextPosition - loopStart;
                relative = ((relative % loopLength) + loopLength) % loopLength;
                nextPosition = loopStart + relative;
            }
        }

        if (this.state.playing) {
            this.stopAudio();
            this.startAudio(nextPosition);
        } else {
            this.dispatch({ type: 'set-position', position: nextPosition });
        }

        this.updateMainControls();
    }

    setRepeat(enabled: boolean): void {
        this.dispatch({ type: 'set-repeat', enabled: enabled });
        this.updateMainControls();
    }

    setVolume(volumeZeroToOne: number): void {
        if (!this.features.globalvolume) {
            this.dispatch({ type: 'set-volume', volume: 1 });
            this.audioEngine.setMasterVolume(1);
            this.renderer.setVolumeSlider(1);
            return;
        }

        this.dispatch({ type: 'set-volume', volume: volumeZeroToOne });
        this.audioEngine.setMasterVolume(this.state.volume);
        this.renderer.setVolumeSlider(this.state.volume);
    }

    setLoopPoint(marker: LoopMarker): boolean {
        if (!this.features.looping) {
            return false;
        }

        const currentPoint = marker === 'A' ? this.state.loop.pointA : this.state.loop.pointB;
        if (currentPoint !== null && Math.abs(currentPoint - this.state.position) < this.loopMinDistance) {
            this.state = {
                ...this.state,
                loop: {
                    ...this.state.loop,
                    enabled: false,
                    pointA: marker === 'A' ? null : this.state.loop.pointA,
                    pointB: marker === 'B' ? null : this.state.loop.pointB,
                },
            };
            this.updateMainControls();
            return false;
        }

        this.dispatch({
            type: 'set-loop-point',
            marker: marker,
            position: this.state.position,
            minDistance: this.loopMinDistance,
        });

        const nextPoint = marker === 'A' ? this.state.loop.pointA : this.state.loop.pointB;
        if (nextPoint === null) {
            this.updateMainControls();
            return false;
        }

        if (this.state.loop.pointA !== null && this.state.loop.pointB !== null) {
            const loopA = this.state.loop.pointA;
            const loopB = this.state.loop.pointB;
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
        }

        this.updateMainControls();
        return true;
    }

    toggleLoop(): boolean {
        if (!this.features.looping) {
            return false;
        }

        if (this.state.loop.pointA === null || this.state.loop.pointB === null) {
            return false;
        }

        this.dispatch({ type: 'toggle-loop' });

        if (
            this.state.loop.enabled
            && this.state.loop.pointA !== null
            && this.state.loop.pointB !== null
            && (this.state.position < this.state.loop.pointA || this.state.position > this.state.loop.pointB)
        ) {
            if (this.state.playing) {
                this.stopAudio();
                this.startAudio(this.state.loop.pointA);
            } else {
                this.dispatch({ type: 'set-position', position: this.state.loop.pointA });
            }
        }

        this.updateMainControls();
        return true;
    }

    clearLoop(): void {
        this.dispatch({ type: 'clear-loop' });
        this.rightClickDragging = false;
        this.loopDragStart = null;
        this.draggingMarker = null;
        this.updateMainControls();
    }

    toggleMute(trackIndex: number): void {
        const runtime = this.runtimes[trackIndex];
        if (!runtime) {
            return;
        }

        if (this.isTrackSyncLocked(trackIndex)) {
            return;
        }

        runtime.state.mute = !runtime.state.mute;
        this.applyTrackProperties();
    }

    toggleSolo(trackIndex: number, exclusive = false): void {
        const runtime = this.runtimes[trackIndex];
        if (!runtime) {
            return;
        }

        if (this.isTrackSyncLocked(trackIndex)) {
            return;
        }

        const previousActiveTrackIndex = this.getActiveSoloTrackIndex();

        const currentState = runtime.state.solo;

        if (exclusive || this.effectiveOnlyRadioSolo) {
            this.runtimes.forEach(function(entry) {
                entry.state.solo = false;
            });
        }

        if ((exclusive || this.effectiveOnlyRadioSolo) && currentState) {
            runtime.state.solo = true;
        } else {
            runtime.state.solo = !currentState;
        }

        this.applyTrackProperties();

        const nextActiveTrackIndex = this.getActiveSoloTrackIndex();
        if (
            this.isAlignmentSoloMode()
            && this.alignmentContext
            && this.effectiveOnlyRadioSolo
            && previousActiveTrackIndex !== nextActiveTrackIndex
            && nextActiveTrackIndex >= 0
        ) {
            this.handleAlignmentSoloTrackSwitch(nextActiveTrackIndex);
        }
    }

    applyPreset(presetIndex: number): void {
        if (!this.features.presets) {
            return;
        }

        this.runtimes.forEach(function(runtime) {
            const presets = runtime.definition.presets ?? [];
            runtime.state.solo = presets.indexOf(presetIndex) !== -1;
            runtime.state.mute = false;
        });

        this.applyTrackProperties();
    }

    getState(): TrackSwitchSnapshot {
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
                    mute: runtime.state.mute,
                    solo: runtime.state.solo,
                };
            }),
        };
    }

    on<K extends TrackSwitchEventName>(eventName: K, handler: TrackSwitchEventHandler<K>): () => void {
        this.listeners[eventName].add(handler as unknown as (payload: unknown) => void);
        return () => this.off(eventName, handler);
    }

    off<K extends TrackSwitchEventName>(eventName: K, handler: TrackSwitchEventHandler<K>): void {
        this.listeners[eventName].delete(handler as unknown as (payload: unknown) => void);
    }

    setKeyboardActive(): void {
        setActiveKeyboardController(this.instanceId);
    }

    onOverlayActivate(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event) && event.type !== 'click') {
            return;
        }

        event.preventDefault();
        this.setKeyboardActive();
        this.audioEngine.primeFromUserGesture();
        void this.load();
        event.stopPropagation();
    }

    onOverlayInfo(event: ControllerPointerEvent): void {
        event.preventDefault();
        this.renderer.showOverlayInfoText();
        event.stopPropagation();
    }

    onPlayPause(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        this.audioEngine.primeFromUserGesture();
        this.togglePlay();
        event.stopPropagation();
    }

    onStop(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        this.stop();
        event.stopPropagation();
    }

    onRepeat(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        this.dispatch({ type: 'toggle-repeat' });
        this.updateMainControls();
        event.stopPropagation();
    }

    onSeekStart(event: ControllerPointerEvent): void {
        if (!this.isLoaded) {
            return;
        }

        if (isPrimaryInput(event) && closestInRoot(this.root, event.target, '.loop-marker')) {
            return;
        }

        if (this.features.looping && event.type === 'mousedown' && event.which === 3) {
            event.preventDefault();

            this.rightClickDragging = true;
            this.seekingElement = closestInRoot(this.root, event.target, '.seekwrap');

            const seekMetrics = getSeekMetrics(this.seekingElement, event, this.longestDuration);
            if (!seekMetrics) {
                this.rightClickDragging = false;
                return;
            }

            this.loopDragStart = seekMetrics.time;
            this.state = {
                ...this.state,
                loop: {
                    ...this.state.loop,
                    pointA: seekMetrics.time,
                    pointB: seekMetrics.time,
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
        this.seekingElement = closestInRoot(this.root, event.target, '.seekwrap');
        if (!this.seekingElement) {
            return;
        }

        this.seekFromEvent(event);
        this.dispatch({ type: 'set-seeking', seeking: true });

        if (
            this.state.loop.enabled
            && this.state.loop.pointA !== null
            && this.state.loop.pointB !== null
            && (this.state.position < this.state.loop.pointA || this.state.position > this.state.loop.pointB)
        ) {
            this.state = {
                ...this.state,
                loop: {
                    ...this.state.loop,
                    enabled: false,
                },
            };
        }

        event.stopPropagation();
    }

    onSeekMove(event: ControllerPointerEvent): void {
        if (!this.isLoaded) {
            return;
        }

        if (this.draggingMarker !== null) {
            event.preventDefault();
            const metrics = getSeekMetrics(this.seekingElement, event, this.longestDuration);
            if (!metrics) {
                return;
            }

            let newTime = metrics.time;
            if (this.draggingMarker === 'A') {
                if (this.state.loop.pointB !== null) {
                    newTime = Math.min(newTime, this.state.loop.pointB - this.loopMinDistance);
                }
                newTime = Math.max(0, newTime);
                this.state = {
                    ...this.state,
                    loop: {
                        ...this.state.loop,
                        pointA: newTime,
                    },
                };
            } else {
                if (this.state.loop.pointA !== null) {
                    newTime = Math.max(newTime, this.state.loop.pointA + this.loopMinDistance);
                }
                newTime = Math.min(this.longestDuration, newTime);
                this.state = {
                    ...this.state,
                    loop: {
                        ...this.state.loop,
                        pointB: newTime,
                    },
                };
            }

            this.updateMainControls();
            return;
        }

        if (this.features.looping && this.rightClickDragging) {
            event.preventDefault();

            const metrics = getSeekMetrics(this.seekingElement, event, this.longestDuration);
            if (!metrics || this.loopDragStart === null) {
                return;
            }

            if (metrics.time >= this.loopDragStart) {
                this.state = {
                    ...this.state,
                    loop: {
                        ...this.state.loop,
                        pointA: this.loopDragStart,
                        pointB: Math.max(metrics.time, this.loopDragStart + this.loopMinDistance),
                        enabled: false,
                    },
                };
            } else {
                this.state = {
                    ...this.state,
                    loop: {
                        ...this.state.loop,
                        pointA: Math.min(metrics.time, this.loopDragStart - this.loopMinDistance),
                        pointB: this.loopDragStart,
                        enabled: false,
                    },
                };
            }

            this.updateMainControls();
            return;
        }

        if (this.state.currentlySeeking) {
            event.preventDefault();
            this.seekFromEvent(event);
        }
    }

    onSeekEnd(event: ControllerPointerEvent): void {
        if (!this.isLoaded) {
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

                if (Math.abs(loopB - loopA) >= this.loopMinDistance) {
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
    }

    onMute(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        const index = this.trackIndexFromTarget(event.target ?? null);
        if (index >= 0) {
            this.toggleMute(index);
        }
        event.stopPropagation();
    }

    onSolo(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }

        const index = this.trackIndexFromTarget(event.target ?? null);
        if (index >= 0) {
            this.toggleSolo(index, !!event.shiftKey);
        }
    }

    onAlignmentSync(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }

        event.preventDefault();
        this.toggleGlobalSync();
        event.stopPropagation();
    }

    onVolume(event: ControllerPointerEvent): void {
        const target = eventTargetAsElement(event.target ?? null);
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        const volume = parseFloat(target.value || '0') / 100;
        this.setVolume(volume);
    }

    onPreset(event: ControllerPointerEvent): void {
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
    }

    onPresetScroll(event: ControllerPointerEvent): void {
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
    }

    onSetLoopA(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }
        event.preventDefault();
        this.setLoopPoint('A');
        event.stopPropagation();
    }

    onSetLoopB(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }
        event.preventDefault();
        this.setLoopPoint('B');
        event.stopPropagation();
    }

    onToggleLoop(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }
        event.preventDefault();
        this.toggleLoop();
        event.stopPropagation();
    }

    onClearLoop(event: ControllerPointerEvent): void {
        if (!isPrimaryInput(event)) {
            return;
        }
        event.preventDefault();
        this.clearLoop();
        event.stopPropagation();
    }

    onMarkerDragStart(event: ControllerPointerEvent): void {
        if (!this.features.looping || !isPrimaryInput(event)) {
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
    }

    onKeyboard(event: ControllerPointerEvent): void {
        if (!this.features.keyboard || !isKeyboardControllerActive(this.instanceId)) {
            return;
        }

        const target = eventTargetAsElement(event.target ?? null);
        if (target && target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]')) {
            return;
        }

        const key = event.key || event.code;
        let handled = false;

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
                if (this.features.globalvolume) {
                    event.preventDefault();
                    this.setVolume(this.state.volume + 0.1);
                    handled = true;
                }
                break;

            case 'ArrowDown':
                if (this.features.globalvolume) {
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
    }

    onResize(): void {
        if (this.resizeDebounceTimer) {
            clearTimeout(this.resizeDebounceTimer);
        }

        this.resizeDebounceTimer = setTimeout(() => {
            this.renderer.renderWaveforms(
                this.waveformEngine,
                this.runtimes,
                this.longestDuration,
                this.getWaveformTimelineProjector()
            );
        }, 300);
    }

    private trackIndexFromTarget(target: EventTarget | null): number {
        const track = closestInRoot(this.root, target, '.track');
        if (!track || !track.parentElement) {
            return -1;
        }

        return Array.from(track.parentElement.children).indexOf(track);
    }

    private isAlignmentSoloMode(): boolean {
        return this.features.mode === 'alignment_solo';
    }

    private hasSyncedVariant(runtime: TrackRuntime): boolean {
        return !!runtime.syncedSource && !!runtime.syncedSource.buffer;
    }

    private isTrackSyncLocked(trackIndex: number): boolean {
        return this.globalSyncEnabled && this.syncLockedTrackIndexes.has(trackIndex);
    }

    private setEffectiveSoloMode(onlyRadio: boolean): void {
        this.effectiveOnlyRadioSolo = onlyRadio;

        if (!onlyRadio || this.runtimes.length === 0) {
            return;
        }

        this.runtimes.forEach(function(runtime) {
            runtime.state.mute = false;
        });

        const previousSoloIndex = this.getActiveSoloTrackIndex();
        const targetSoloIndex = previousSoloIndex >= 0 ? previousSoloIndex : 0;

        this.runtimes.forEach(function(runtime, index) {
            runtime.state.solo = index === targetSoloIndex;
        });
    }

    private toggleGlobalSync(): void {
        if (!this.isAlignmentSoloMode()) {
            return;
        }

        const hasAnySyncedTrack = this.runtimes.some((runtime) => this.hasSyncedVariant(runtime));
        if (!hasAnySyncedTrack) {
            return;
        }

        this.applyGlobalSyncState(!this.globalSyncEnabled);
    }

    private applyGlobalSyncState(syncOn: boolean): void {
        if (!this.isAlignmentSoloMode()) {
            return;
        }

        const restartPosition = this.state.playing
            ? clamp(this.currentPlaybackReferencePosition(), 0, this.longestDuration)
            : clamp(this.state.position, 0, this.longestDuration);

        if (syncOn) {
            this.preSyncSoloTrackIndex = this.getActiveSoloTrackIndex();
            this.globalSyncEnabled = true;
            this.syncLockedTrackIndexes.clear();
            this.setEffectiveSoloMode(false);

            this.runtimes.forEach((runtime, index) => {
                if (this.hasSyncedVariant(runtime)) {
                    this.setRuntimeActiveVariant(runtime, 'synced');
                    runtime.state.mute = false;
                    runtime.state.solo = true;
                    return;
                }

                this.setRuntimeActiveVariant(runtime, 'base');
                runtime.state.mute = true;
                runtime.state.solo = false;
                this.syncLockedTrackIndexes.add(index);
            });
        } else {
            this.globalSyncEnabled = false;
            this.syncLockedTrackIndexes.clear();

            this.runtimes.forEach((runtime) => {
                this.setRuntimeActiveVariant(runtime, 'base');
                runtime.state.mute = false;
                runtime.state.solo = false;
            });

            this.setEffectiveSoloMode(true);

            const fallbackIndex = this.runtimes.length > 0 ? 0 : -1;
            const restoreIndex = this.preSyncSoloTrackIndex !== null
                && this.preSyncSoloTrackIndex >= 0
                && this.preSyncSoloTrackIndex < this.runtimes.length
                ? this.preSyncSoloTrackIndex
                : fallbackIndex;

            if (restoreIndex >= 0) {
                this.runtimes.forEach(function(runtime, index) {
                    runtime.state.solo = index === restoreIndex;
                });
            }

            this.preSyncSoloTrackIndex = null;
        }

        this.applyTrackProperties();
        this.dispatch({ type: 'set-position', position: restartPosition });

        if (this.state.playing) {
            this.stopAudio();
            this.startAudio(restartPosition);
        }

        this.updateMainControls();
    }

    private setRuntimeActiveVariant(runtime: TrackRuntime, variant: TrackSourceVariant): boolean {
        const source = variant === 'synced' ? runtime.syncedSource : runtime.baseSource;
        if (!source || !source.buffer) {
            return false;
        }

        runtime.activeVariant = variant;
        runtime.buffer = source.buffer;
        runtime.timing = source.timing;
        runtime.sourceIndex = source.sourceIndex;
        runtime.waveformCache.clear();
        return true;
    }

    private shouldBypassAlignmentMapping(trackIndex: number): boolean {
        const runtime = this.runtimes[trackIndex];
        return !!runtime && runtime.activeVariant === 'synced' && !!runtime.syncedSource;
    }

    private applyTrackProperties(): void {
        this.renderer.updateTrackControls(
            this.runtimes,
            this.syncLockedTrackIndexes,
            this.effectiveOnlyRadioSolo
        );
        this.audioEngine.applyTrackStateGains(this.runtimes);
        this.renderer.switchPosterImage(this.runtimes);
        this.renderer.renderWaveforms(
            this.waveformEngine,
            this.runtimes,
            this.longestDuration,
            this.getWaveformTimelineProjector()
        );

        this.runtimes.forEach((runtime, index) => {
            this.emit('trackState', {
                index: index,
                state: {
                    mute: runtime.state.mute,
                    solo: runtime.state.solo,
                },
            });
        });
    }

    private updateMainControls(): void {
        const uiState: TrackSwitchUiState = {
            playing: this.state.playing,
            repeat: this.state.repeat,
            position: this.state.position,
            longestDuration: this.longestDuration,
            syncEnabled: this.globalSyncEnabled,
            syncAvailable: this.isAlignmentSoloMode()
                && this.runtimes.some((runtime) => this.hasSyncedVariant(runtime)),
            loop: {
                pointA: this.state.loop.pointA,
                pointB: this.state.loop.pointB,
                enabled: this.state.loop.enabled,
            },
        };

        this.renderer.updateMainControls(uiState);

        this.emit('position', {
            position: this.state.position,
            duration: this.longestDuration,
        });
    }

    private dispatch(action: PlayerAction): void {
        this.state = playerStateReducer(this.state, action);
    }

    private pauseOthers(): void {
        if (!this.features.globalsolo) {
            return;
        }

        pauseOtherControllers(this);
    }

    private startAudio(newPosition?: number, snippetDuration?: number): void {
        const requestedPosition = typeof newPosition === 'number' ? newPosition : this.state.position;
        let enginePosition = requestedPosition;
        let nextReferencePosition = requestedPosition;

        if (this.features.mode === 'alignment_solo' && this.alignmentContext) {
            const activeTrackIndex = this.getActiveSoloTrackIndex();
            if (activeTrackIndex < 0) {
                return;
            }

            enginePosition = this.referenceToTrackTime(activeTrackIndex, requestedPosition);
            nextReferencePosition = this.trackToReferenceTime(activeTrackIndex, enginePosition);
            this.alignmentPlaybackTrackIndex = activeTrackIndex;
        } else {
            this.alignmentPlaybackTrackIndex = null;
        }

        const startResult = this.audioEngine.start(this.runtimes, enginePosition, snippetDuration);
        if (!startResult) {
            this.alignmentPlaybackTrackIndex = null;
            return;
        }

        this.dispatch({
            type: 'set-position',
            position: clamp(nextReferencePosition, 0, this.longestDuration),
        });
        this.dispatch({ type: 'set-start-time', startTime: startResult.startTime });

        if (this.timerMonitorPosition) {
            clearInterval(this.timerMonitorPosition);
        }

        this.timerMonitorPosition = setInterval(() => {
            this.monitorPosition();
        }, 16);
    }

    private stopAudio(): void {
        this.audioEngine.stop(this.runtimes);
        this.alignmentPlaybackTrackIndex = null;
        if (this.timerMonitorPosition) {
            clearInterval(this.timerMonitorPosition);
            this.timerMonitorPosition = null;
        }
    }

    private monitorPosition(): void {
        if (this.isDestroyed) {
            return;
        }

        if (this.state.playing && !this.state.currentlySeeking) {
            const currentPosition = this.currentPlaybackReferencePosition();
            this.dispatch({ type: 'set-position', position: currentPosition });
        }

        if (
            this.features.looping
            && this.state.loop.enabled
            && this.state.loop.pointB !== null
            && this.state.position >= this.state.loop.pointB
            && !this.state.currentlySeeking
        ) {
            this.stopAudio();
            this.startAudio(this.state.loop.pointA ?? 0);
            return;
        }

        if (this.state.position >= this.longestDuration && !this.state.currentlySeeking) {
            this.dispatch({ type: 'set-position', position: 0 });
            this.stopAudio();

            if (this.state.repeat) {
                this.startAudio(0);
                this.dispatch({ type: 'set-playing', playing: true });
            } else {
                this.dispatch({ type: 'set-playing', playing: false });
            }
        }

        this.updateMainControls();
    }

    private seekFromEvent(event: ControllerPointerEvent): void {
        const metrics = getSeekMetrics(this.seekingElement, event, this.longestDuration);
        if (!metrics) {
            return;
        }

        const newPosition = metrics.time;

        if (metrics.posXRel >= 0 && metrics.posXRel <= metrics.seekWidth) {
            if (this.state.playing) {
                this.stopAudio();
                this.startAudio(newPosition, 0.03);
            } else {
                this.dispatch({ type: 'set-position', position: newPosition });
            }
        } else {
            this.dispatch({ type: 'set-position', position: newPosition });
        }

        this.updateMainControls();
    }

    private findLongestDuration(): number {
        let longest = 0;

        this.runtimes.forEach(function(runtime) {
            const duration = TrackSwitchControllerImpl.getRuntimeDuration(runtime);

            if (duration > longest) {
                longest = duration;
            }
        });

        return longest;
    }

    private findLongestTrackIndex(): number {
        let longest = -1;
        let longestTrackIndex = 0;

        this.runtimes.forEach(function(runtime, index) {
            const duration = TrackSwitchControllerImpl.getRuntimeDuration(runtime);
            if (duration > longest) {
                longest = duration;
                longestTrackIndex = index;
            }
        });

        return longestTrackIndex;
    }

    private static getRuntimeDuration(runtime: TrackRuntime): number {
        return runtime.timing
            ? runtime.timing.effectiveDuration
            : (runtime.buffer ? runtime.buffer.duration : 0);
    }

    private async initializeAlignmentSolo(): Promise<string | null> {
        const alignmentContextResult = await this.buildAlignmentContext();
        if (typeof alignmentContextResult === 'string') {
            return alignmentContextResult;
        }

        this.globalSyncEnabled = false;
        this.syncLockedTrackIndexes.clear();
        this.preSyncSoloTrackIndex = null;
        this.setEffectiveSoloMode(true);

        this.alignmentContext = alignmentContextResult;
        this.longestDuration = TrackSwitchControllerImpl.getRuntimeDuration(this.runtimes[this.alignmentContext.referenceTrackIndex]);

        const activeTrackIndex = this.getActiveSoloTrackIndex();
        if (activeTrackIndex >= 0) {
            const mappedTrackTime = this.referenceToTrackTime(activeTrackIndex, this.state.position);
            const mappedReferenceTime = this.trackToReferenceTime(activeTrackIndex, mappedTrackTime);
            this.dispatch({
                type: 'set-position',
                position: clamp(mappedReferenceTime, 0, this.longestDuration),
            });
        }

        return null;
    }

    private async buildAlignmentContext(): Promise<AlignmentContext | string> {
        if (!this.alignmentConfig) {
            return 'Alignment mode requires init.alignment configuration.';
        }

        if (!this.alignmentConfig.csv || typeof this.alignmentConfig.csv !== 'string') {
            return 'Alignment configuration requires a non-empty alignment.csv URL.';
        }

        const mappingByTrack = this.resolveAlignmentMappingsByTrack(this.alignmentConfig);
        if (typeof mappingByTrack === 'string') {
            return mappingByTrack;
        }

        const referenceTrackIndex = this.findLongestTrackIndex();
        const referenceColumn = mappingByTrack.get(referenceTrackIndex);
        if (!referenceColumn) {
            return 'Alignment mappings must include the reference track column.';
        }

        let parsedCsv;
        try {
            parsedCsv = await loadNumericCsv(this.alignmentConfig.csv);
        } catch (error) {
            return error instanceof Error
                ? error.message
                : 'Failed to load alignment CSV.';
        }

        const availableColumns = new Set(parsedCsv.headers);
        for (const [, column] of mappingByTrack) {
            if (!availableColumns.has(column)) {
                return 'Alignment CSV is missing configured column: ' + column;
            }
        }

        const converters = new Map<number, TrackAlignmentConverter>();
        for (const [trackIndex, column] of mappingByTrack) {
            try {
                converters.set(trackIndex, {
                    referenceToTrack: buildColumnTimeMapping(parsedCsv.rows, referenceColumn, column),
                    trackToReference: buildColumnTimeMapping(parsedCsv.rows, column, referenceColumn),
                });
            } catch (error) {
                return error instanceof Error
                    ? error.message
                    : 'Failed to build alignment mappings.';
            }
        }

        return {
            referenceTrackIndex: referenceTrackIndex,
            outOfRange: resolveAlignmentOutOfRangeMode(this.alignmentConfig.outOfRange),
            converters: converters,
        };
    }

    private resolveAlignmentMappingsByTrack(config: TrackAlignmentConfig): Map<number, string> | string {
        const hasAnyTrackColumn = this.runtimes.some(function(runtime) {
            return runtime.definition.alignment
                && Object.prototype.hasOwnProperty.call(runtime.definition.alignment, 'column');
        });

        if (!hasAnyTrackColumn) {
            return this.validateAndBuildLegacyAlignmentMappings(config);
        }

        const mappingByTrack = new Map<number, string>();

        for (let index = 0; index < this.runtimes.length; index += 1) {
            const rawColumn = this.runtimes[index].definition.alignment?.column;
            const column = typeof rawColumn === 'string' ? rawColumn.trim() : '';
            if (!column) {
                return 'Per-track alignment columns are enabled, so every track requires alignment.column. Missing trackIndex '
                    + index + '.';
            }

            mappingByTrack.set(index, column);
        }

        return mappingByTrack;
    }

    private validateAndBuildLegacyAlignmentMappings(config: TrackAlignmentConfig): Map<number, string> | string {
        if (!Array.isArray(config.mappings) || config.mappings.length === 0) {
            return 'Alignment configuration requires alignment.mappings with one entry per track.';
        }

        if (config.mappings.length !== this.runtimes.length) {
            return 'Alignment mappings must include exactly one mapping per track.';
        }

        const mappingByTrack = new Map<number, string>();

        for (const entry of config.mappings) {
            if (!entry || !Number.isInteger(entry.trackIndex)) {
                return 'Alignment mapping entries require an integer trackIndex.';
            }

            if (entry.trackIndex < 0 || entry.trackIndex >= this.runtimes.length) {
                return 'Alignment mapping trackIndex is out of range: ' + entry.trackIndex;
            }

            const column = typeof entry.column === 'string' ? entry.column.trim() : '';
            if (!column) {
                return 'Alignment mapping entries require a non-empty column name.';
            }

            if (mappingByTrack.has(entry.trackIndex)) {
                return 'Alignment mappings contain duplicate trackIndex: ' + entry.trackIndex;
            }

            mappingByTrack.set(entry.trackIndex, column);
        }

        for (let index = 0; index < this.runtimes.length; index += 1) {
            if (!mappingByTrack.has(index)) {
                return 'Alignment mappings must cover all tracks. Missing trackIndex ' + index + '.';
            }
        }

        return mappingByTrack;
    }

    private getActiveSoloTrackIndex(): number {
        for (let index = 0; index < this.runtimes.length; index += 1) {
            if (this.runtimes[index].state.solo) {
                return index;
            }
        }

        return this.runtimes.length > 0 ? 0 : -1;
    }

    private currentPlaybackReferencePosition(): number {
        const rawPlaybackPosition = this.audioEngine.currentTime - this.state.startTime;
        if (
            this.features.mode !== 'alignment_solo'
            || !this.alignmentContext
            || this.alignmentPlaybackTrackIndex === null
        ) {
            return rawPlaybackPosition;
        }

        return this.trackToReferenceTime(this.alignmentPlaybackTrackIndex, rawPlaybackPosition);
    }

    private getWaveformTimelineProjector(): TrackTimelineProjector | undefined {
        if (this.features.mode !== 'alignment_solo' || !this.alignmentContext) {
            return undefined;
        }

        const trackIndexByRuntime = new Map<TrackRuntime, number>();
        const trackIndexById = new Map<string, number>();
        const trackIndexByDefinition = new Map<object, number>();

        this.runtimes.forEach(function(runtime, index) {
            trackIndexByRuntime.set(runtime, index);
            trackIndexById.set(runtime.id, index);
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

            const idIndex = trackIndexById.get(runtime.id);
            if (idIndex !== undefined) {
                return this.trackToReferenceTime(idIndex, trackTimelineTime);
            }

            return trackTimelineTime;
        };
    }

    private referenceToTrackTime(trackIndex: number, referenceTime: number): number {
        if (!this.alignmentContext) {
            return referenceTime;
        }

        if (this.shouldBypassAlignmentMapping(trackIndex)) {
            return referenceTime;
        }

        const converter = this.alignmentContext.converters.get(trackIndex);
        if (!converter) {
            return referenceTime;
        }

        return mapTime(converter.referenceToTrack, referenceTime, this.alignmentContext.outOfRange);
    }

    private trackToReferenceTime(trackIndex: number, trackTime: number): number {
        if (!this.alignmentContext) {
            return trackTime;
        }

        if (this.shouldBypassAlignmentMapping(trackIndex)) {
            return trackTime;
        }

        const converter = this.alignmentContext.converters.get(trackIndex);
        if (!converter) {
            return trackTime;
        }

        return mapTime(converter.trackToReference, trackTime, 'linear');
    }

    private handleAlignmentSoloTrackSwitch(nextActiveTrackIndex: number): void {
        if (!this.alignmentContext || nextActiveTrackIndex < 0) {
            return;
        }

        const referenceAtSwitch = this.state.playing
            ? this.currentPlaybackReferencePosition()
            : this.state.position;
        const mappedTrackTime = this.referenceToTrackTime(nextActiveTrackIndex, referenceAtSwitch);
        const mappedReferenceTime = clamp(
            this.trackToReferenceTime(nextActiveTrackIndex, mappedTrackTime),
            0,
            this.longestDuration
        );

        if (this.state.playing) {
            this.stopAudio();
            this.dispatch({ type: 'set-position', position: mappedReferenceTime });
            this.startAudio(mappedReferenceTime);
        } else {
            this.dispatch({ type: 'set-position', position: mappedReferenceTime });
        }

        this.updateMainControls();
    }

    private emit<K extends TrackSwitchEventName>(eventName: K, payload: TrackSwitchEventMap[K]): void {
        this.listeners[eventName].forEach(function(handler) {
            handler(payload);
        });
    }

    private handleError(message: string): void {
        this.isLoaded = false;
        this.isLoading = false;
        this.alignmentContext = null;
        this.alignmentPlaybackTrackIndex = null;
        this.globalSyncEnabled = false;
        this.syncLockedTrackIndexes.clear();
        this.preSyncSoloTrackIndex = null;
        this.effectiveOnlyRadioSolo = this.isAlignmentSoloMode() ? true : this.features.onlyradiosolo;

        this.stopAudio();

        if (this.resizeDebounceTimer) {
            clearTimeout(this.resizeDebounceTimer);
            this.resizeDebounceTimer = null;
        }

        this.renderer.showError(message, this.runtimes);
        this.emit('error', { message: message });
    }
}
