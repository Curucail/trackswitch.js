import {
    LoopMarker,
    PlayerState,
    TrackRuntime,
    TrackSwitchConfig,
    TrackSwitchController,
    TrackSwitchEventHandler,
    TrackSwitchEventMap,
    TrackSwitchEventName,
    TrackSwitchFeatures,
    TrackSwitchImageConfig,
    TrackSwitchInit,
    TrackSwitchSnapshot,
    TrackSwitchUiConfig,
    TrackSwitchUiState,
} from '../domain/types';
import { normalizeFeatures } from '../domain/options';
import { createInitialPlayerState, playerStateReducer, PlayerAction } from '../domain/state';
import { createTrackRuntime } from '../domain/runtime';
import { AudioEngine } from '../engine/audio-engine';
import { WaveformEngine } from '../engine/waveform-engine';
import { ViewRenderer } from '../ui/view-renderer';
import { InputBinder, InputController } from '../input/input-binder';
import {
    clamp,
    clampPercent,
    ControllerPointerEvent,
    derivePresetNames,
    eventTargetAsElement,
    getSeekMetrics,
    isPrimaryInput,
    parseStrictNonNegativeInt,
} from '../utils/helpers';

let instanceCounter = 0;
let activeKeyboardInstanceId: number | null = null;
const controllerRegistry = new Set<TrackSwitchControllerImpl>();
const TRACKS_REQUIRED_ERROR = 'TrackSwitch JS-only mode requires init.tracks with at least one track.';
const LEGACY_MARKUP_ERROR = 'Declarative markup has been removed. Remove `preset-names`, `<ts-track>`, and `<ts-source>` markup and pass all track data via TrackSwitch.createTrackSwitch(rootElement, init).';

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

function hasLegacyDeclarativeMarkup(root: HTMLElement): boolean {
    if (root.hasAttribute('preset-names')) {
        return true;
    }

    return root.querySelector('ts-track, ts-source') !== null;
}

function toMarginString(value: number | undefined): string {
    return String(clampPercent(value));
}

function toCanvasSize(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value) || !value) {
        return fallback;
    }

    return Math.max(1, Math.round(value));
}

function injectImage(root: HTMLElement, image: TrackSwitchImageConfig): void {
    const imageElement = document.createElement('img');
    imageElement.src = image.src;

    if (image.seekable) {
        imageElement.classList.add('seekable');
    }

    if (typeof image.style === 'string') {
        imageElement.setAttribute('data-style', image.style);
    }

    if (typeof image.seekMarginLeft === 'number') {
        imageElement.setAttribute('data-seek-margin-left', toMarginString(image.seekMarginLeft));
    }

    if (typeof image.seekMarginRight === 'number') {
        imageElement.setAttribute('data-seek-margin-right', toMarginString(image.seekMarginRight));
    }

    root.appendChild(imageElement);
}

function injectWaveform(root: HTMLElement, waveform: NonNullable<TrackSwitchUiConfig['waveform']>): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'waveform';
    canvas.width = toCanvasSize(waveform.width, 1200);
    canvas.height = toCanvasSize(waveform.height, 150);

    if (typeof waveform.style === 'string') {
        canvas.setAttribute('data-waveform-style', waveform.style);
    }

    if (typeof waveform.seekMarginLeft === 'number') {
        canvas.setAttribute('data-seek-margin-left', toMarginString(waveform.seekMarginLeft));
    }

    if (typeof waveform.seekMarginRight === 'number') {
        canvas.setAttribute('data-seek-margin-right', toMarginString(waveform.seekMarginRight));
    }

    root.appendChild(canvas);
}

function injectConfiguredUiElements(root: HTMLElement, ui: TrackSwitchUiConfig | undefined, waveformEnabled: boolean): void {
    if (!ui) {
        return;
    }

    const images = ui.images ?? [];
    const seekableCount = images.filter(function(entry) {
        return Boolean(entry.seekable);
    }).length;

    if (seekableCount > 1) {
        throw new Error('TrackSwitch UI config supports at most one seekable image.');
    }

    images.forEach(function(image) {
        injectImage(root, image);
    });

    if (ui.waveform && waveformEnabled) {
        injectWaveform(root, ui.waveform);
    }
}

export class TrackSwitchControllerImpl implements TrackSwitchController, InputController {
    private readonly root: HTMLElement;
    private readonly features: TrackSwitchFeatures;
    private readonly audioEngine: AudioEngine;
    private readonly waveformEngine: WaveformEngine;
    private readonly renderer: ViewRenderer;
    private readonly inputBinder: InputBinder;

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

        this.features = normalizeFeatures(config.features);
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

        this.instanceId = instanceCounter;
        instanceCounter += 1;

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

        controllerRegistry.add(this);
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

        this.runtimes.forEach(function(runtime) {
            runtime.successful = false;
            runtime.errored = false;
            runtime.buffer = null;
            runtime.gainNode = null;
            runtime.timing = null;
            runtime.activeSource = null;
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
        this.isLoaded = true;
        this.renderer.hideOverlayOnLoaded();

        this.updateMainControls();
        this.applyTrackProperties();

        this.emit('loaded', {
            longestDuration: this.longestDuration,
        });

        this.renderer.renderWaveforms(this.waveformEngine, this.runtimes);
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

        if (activeKeyboardInstanceId === this.instanceId) {
            activeKeyboardInstanceId = null;
        }

        this.listeners.loaded.clear();
        this.listeners.error.clear();
        this.listeners.position.clear();
        this.listeners.trackState.clear();

        controllerRegistry.delete(this);
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

        this.stopAudio();

        const position = this.audioEngine.currentTime - this.state.startTime;
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

        runtime.state.mute = !runtime.state.mute;
        this.applyTrackProperties();
    }

    toggleSolo(trackIndex: number, exclusive = false): void {
        const runtime = this.runtimes[trackIndex];
        if (!runtime) {
            return;
        }

        const currentState = runtime.state.solo;

        if (exclusive || this.features.radiosolo) {
            this.runtimes.forEach(function(entry) {
                entry.state.solo = false;
            });
        }

        if ((exclusive || this.features.radiosolo) && currentState) {
            runtime.state.solo = true;
        } else {
            runtime.state.solo = !currentState;
        }

        this.applyTrackProperties();
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
        activeKeyboardInstanceId = this.instanceId;
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
        if (!this.features.keyboard || activeKeyboardInstanceId !== this.instanceId) {
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
            this.renderer.renderWaveforms(this.waveformEngine, this.runtimes);
        }, 300);
    }

    private trackIndexFromTarget(target: EventTarget | null): number {
        const track = closestInRoot(this.root, target, '.track');
        if (!track || !track.parentElement) {
            return -1;
        }

        return Array.from(track.parentElement.children).indexOf(track);
    }

    private applyTrackProperties(): void {
        this.renderer.updateTrackControls(this.runtimes);
        this.audioEngine.applyTrackStateGains(this.runtimes);
        this.renderer.switchPosterImage(this.runtimes);
        this.renderer.renderWaveforms(this.waveformEngine, this.runtimes);

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

        controllerRegistry.forEach((controller) => {
            if (controller === this) {
                return;
            }
            controller.pause();
        });
    }

    private startAudio(newPosition?: number, snippetDuration?: number): void {
        const position = typeof newPosition === 'number' ? newPosition : this.state.position;

        const startResult = this.audioEngine.start(this.runtimes, position, snippetDuration);
        if (!startResult) {
            return;
        }

        this.dispatch({ type: 'set-position', position: position });
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
            const currentPosition = this.audioEngine.currentTime - this.state.startTime;
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
            const duration = runtime.timing
                ? runtime.timing.effectiveDuration
                : (runtime.buffer ? runtime.buffer.duration : 0);

            if (duration > longest) {
                longest = duration;
            }
        });

        return longest;
    }

    private emit<K extends TrackSwitchEventName>(eventName: K, payload: TrackSwitchEventMap[K]): void {
        this.listeners[eventName].forEach(function(handler) {
            handler(payload);
        });
    }

    private handleError(message: string): void {
        this.isLoaded = false;
        this.isLoading = false;

        this.stopAudio();

        if (this.resizeDebounceTimer) {
            clearTimeout(this.resizeDebounceTimer);
            this.resizeDebounceTimer = null;
        }

        this.renderer.showError(message, this.runtimes);
        this.emit('error', { message: message });
    }
}

function normalizeInit(root: HTMLElement, init: TrackSwitchInit | undefined): TrackSwitchConfig {
    const resolvedInit = init as TrackSwitchInit | undefined;
    const normalizedFeatures = normalizeFeatures(resolvedInit?.features);

    if (hasLegacyDeclarativeMarkup(root)) {
        throw new Error(LEGACY_MARKUP_ERROR);
    }

    if (!resolvedInit?.tracks || resolvedInit.tracks.length === 0) {
        throw new Error(TRACKS_REQUIRED_ERROR);
    }

    injectConfiguredUiElements(root, resolvedInit.ui, normalizedFeatures.waveform);

    return {
        tracks: resolvedInit.tracks,
        presetNames: resolvedInit.presetNames,
        features: resolvedInit.features,
        ui: resolvedInit.ui,
    };
}

export function createTrackSwitch(rootElement: HTMLElement, init: TrackSwitchInit): TrackSwitchController {
    return new TrackSwitchControllerImpl(rootElement, normalizeInit(rootElement, init));
}
