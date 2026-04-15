import type {
    LoopMarker,
    TrackSwitchController,
    TrackSwitchEventHandler,
    TrackSwitchEventName,
    TrackSwitchInit,
    TrackSwitchMountOptions,
    TrackSwitchSnapshot,
} from '../domain/types';
import { normalizeInit } from '../config/normalize-init';
import { TrackSwitchControllerImpl } from './player-controller';
import { prepareTrackSwitchMount } from '../shared/mount';

class ShadowMountedTrackSwitchController implements TrackSwitchController {
    private innerController: TrackSwitchController | null;
    private readonly cleanupMount: () => void;

    constructor(innerController: TrackSwitchController, cleanupMount: () => void) {
        this.innerController = innerController;
        this.cleanupMount = cleanupMount;
    }

    load(): Promise<void> {
        return this.requireInnerController().load();
    }

    destroy(): void {
        const innerController = this.innerController;
        if (!innerController) {
            return;
        }

        this.innerController = null;
        innerController.destroy();
        this.cleanupMount();
    }

    togglePlay(): void {
        this.requireInnerController().togglePlay();
    }

    play(): void {
        this.requireInnerController().play();
    }

    pause(): void {
        this.requireInnerController().pause();
    }

    stop(): void {
        this.requireInnerController().stop();
    }

    seekTo(seconds: number): void {
        this.requireInnerController().seekTo(seconds);
    }

    seekRelative(seconds: number): void {
        this.requireInnerController().seekRelative(seconds);
    }

    setRepeat(enabled: boolean): void {
        this.requireInnerController().setRepeat(enabled);
    }

    setVolume(volumeZeroToOne: number): void {
        this.requireInnerController().setVolume(volumeZeroToOne);
    }

    setTrackVolume(trackIndex: number, volumeZeroToOne: number): void {
        this.requireInnerController().setTrackVolume(trackIndex, volumeZeroToOne);
    }

    setTrackPan(trackIndex: number, panMinusOneToOne: number): void {
        this.requireInnerController().setTrackPan(trackIndex, panMinusOneToOne);
    }

    setLoopPoint(marker: LoopMarker): boolean {
        return this.requireInnerController().setLoopPoint(marker);
    }

    toggleLoop(): boolean {
        return this.requireInnerController().toggleLoop();
    }

    clearLoop(): void {
        this.requireInnerController().clearLoop();
    }

    toggleSolo(trackIndex: number, exclusive?: boolean): void {
        this.requireInnerController().toggleSolo(trackIndex, exclusive);
    }

    applyPreset(presetIndex: number): void {
        this.requireInnerController().applyPreset(presetIndex);
    }

    getState(): TrackSwitchSnapshot {
        return this.requireInnerController().getState();
    }

    on<K extends TrackSwitchEventName>(eventName: K, handler: TrackSwitchEventHandler<K>): () => void {
        return this.requireInnerController().on(eventName, handler);
    }

    off<K extends TrackSwitchEventName>(eventName: K, handler: TrackSwitchEventHandler<K>): void {
        this.requireInnerController().off(eventName, handler);
    }

    updateInit(nextInit: TrackSwitchInit): Promise<void> {
        return this.requireInnerController().updateInit(nextInit);
    }

    private requireInnerController(): TrackSwitchController {
        if (!this.innerController) {
            throw new Error('TrackSwitch controller has already been destroyed.');
        }

        return this.innerController;
    }
}

/**
 * Creates a TrackSwitch multitrack audio player and mounts it into the given DOM element.
 *
 * Tracks and visual elements are declared together in the `ui` array. Each entry has a `type`
 * that determines what gets rendered: `'trackGroup'` defines audio tracks, while `'waveform'`,
 * `'image'`, `'sheetMusic'`, and `'warpingMatrix'` add visual elements around them.
 * At least one `trackGroup` with at least one track (each with a valid `sources` array) is required.
 *
 * The player supports two modes (via `features.mode`):
 * - `'default'` — standard multitrack player; each preset switches all tracks to the source at that index
 * - `'alignment'` — synchronizes tracks to a shared timeline via a CSV warping matrix
 *
 * Call {@link TrackSwitchController.load} after creation to fetch audio and initialize the UI.
 * The returned controller exposes playback controls, per-track mixing, loop markers, presets,
 * and a typed event system (`on('loaded' | 'position' | 'trackState' | 'error', handler)`).
 *
 * @param rootElement - The HTML element to mount the player into.
 * @param init - Configuration object. See {@link TrackSwitchInit} for all options.
 * @returns A {@link TrackSwitchController} to control playback and subscribe to events.
 *
 * @example
 * ```ts
 * import { createTrackSwitch } from 'trackswitch';
 * import 'trackswitch/style.css';
 *
 * const player = createTrackSwitch(document.getElementById('player')!, {
 *   presetNames: ['Mix A', 'Mix B'],
 *   ui: [
 *     { type: 'waveform' },
 *     {
 *       type: 'trackGroup',
 *       trackGroup: [
 *         { title: 'Drums', sources: [{ src: 'drums-a.mp3' }, { src: 'drums-b.mp3' }] },
 *         { title: 'Bass',  sources: [{ src: 'bass-a.mp3'  }, { src: 'bass-b.mp3'  }] },
 *       ],
 *     },
 *   ],
 * });
 *
 * player.on('loaded', ({ longestDuration }) => console.log('Ready, duration:', longestDuration));
 * await player.load();
 * ```
 */
export function createTrackSwitch(
    rootElement: HTMLElement,
    init: TrackSwitchInit,
    mountOptions?: TrackSwitchMountOptions
): TrackSwitchController {
    const preparedMount = prepareTrackSwitchMount(rootElement, mountOptions);

    try {
        const innerController = new TrackSwitchControllerImpl(
            preparedMount.mountRoot,
            normalizeInit(preparedMount.mountRoot, init)
        );

        if (!mountOptions?.shadowDom) {
            return innerController;
        }

        return new ShadowMountedTrackSwitchController(innerController, preparedMount.cleanup);
    } catch (error) {
        preparedMount.cleanup();
        throw error;
    }
}
