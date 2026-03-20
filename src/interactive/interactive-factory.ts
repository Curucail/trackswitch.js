import type { InteractiveTrackSwitchController, InteractiveTrackSwitchInit } from './types';
import { InteractiveTrackSwitchControllerImpl } from './interactive-controller';

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
    init?: InteractiveTrackSwitchInit
): InteractiveTrackSwitchController {
    return new InteractiveTrackSwitchControllerImpl(rootElement, init || {});
}
