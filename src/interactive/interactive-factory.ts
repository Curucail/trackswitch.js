import type { InteractiveTrackSwitchController, InteractiveTrackSwitchInit, TrackSwitchMountOptions } from './types';
import { InteractiveTrackSwitchControllerImpl } from './interactive-controller';
import { prepareTrackSwitchMount } from '../shared/mount';

class ShadowMountedInteractiveTrackSwitchController implements InteractiveTrackSwitchController {
    private innerController: InteractiveTrackSwitchController | null;
    private readonly cleanupMount: () => void;

    constructor(innerController: InteractiveTrackSwitchController, cleanupMount: () => void) {
        this.innerController = innerController;
        this.cleanupMount = cleanupMount;
    }

    initialize(): void {
        this.requireInnerController().initialize();
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

    getInnerController(): ReturnType<InteractiveTrackSwitchController['getInnerController']> {
        return this.requireInnerController().getInnerController();
    }

    private requireInnerController(): InteractiveTrackSwitchController {
        if (!this.innerController) {
            throw new Error('Interactive TrackSwitch controller has already been destroyed.');
        }

        return this.innerController;
    }
}

/**
 * Creates an interactive TrackSwitch alignment player.
 *
 * In this mode, users drag-and-drop audio and MusicXML files into a drop zone.
 * The player computes alignments client-side using synctoolbox via Pyodide in a Web Worker,
 * then initializes a standard alignment-mode player with the computed time mappings.
 *
 * @param rootElement - The HTML element to mount the interactive player into.
 * @param init - Optional configuration for worker URL, Pyodide CDN, and default warping-path feature/alignment algorithm settings.
 * @returns An {@link InteractiveTrackSwitchController} to manage the interactive player.
 *
 * @example
 * ```ts
 * import { createInteractiveTrackSwitch } from 'trackswitch/interactive';
 * import 'trackswitch/style.css';
 *
 * const player = createInteractiveTrackSwitch(
 *   document.getElementById('player')!,
 *   { workerUrl: './trackswitch-alignment-worker.js' }
 * );
 * player.initialize();
 * ```
 */
export function createInteractiveTrackSwitch(
    rootElement: HTMLElement,
    init?: InteractiveTrackSwitchInit,
    mountOptions?: TrackSwitchMountOptions
): InteractiveTrackSwitchController {
    const preparedMount = prepareTrackSwitchMount(rootElement, mountOptions);

    try {
        const innerController = new InteractiveTrackSwitchControllerImpl(preparedMount.mountRoot, init || {});
        if (!mountOptions?.shadowDom) {
            return innerController;
        }

        return new ShadowMountedInteractiveTrackSwitchController(innerController, preparedMount.cleanup);
    } catch (error) {
        preparedMount.cleanup();
        throw error;
    }
}
