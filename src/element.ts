import stylesheetText from '../css/trackswitch.css?inline';
import { createTrackSwitch } from './player/factory';
import type {
    TrackSwitchController,
    TrackSwitchEventMap,
    TrackSwitchEventName,
    TrackSwitchInit,
} from './domain/types';

export type TrackswitchDomEventName =
    | 'trackswitch-loaded'
    | 'trackswitch-error'
    | 'trackswitch-position'
    | 'trackswitch-track-state';

export interface TrackswitchPlayerElement extends HTMLElement {
    init: TrackSwitchInit | undefined;
    config: TrackSwitchInit | undefined;
    readonly controller: TrackSwitchController | null;
}

const TRACKSWITCH_ELEMENT_NAME = 'trackswitch';

const domEventNames: Record<TrackSwitchEventName, TrackswitchDomEventName> = {
    loaded: 'trackswitch-loaded',
    error: 'trackswitch-error',
    position: 'trackswitch-position',
    trackState: 'trackswitch-track-state',
};

function dispatchTrackSwitchEvent<K extends TrackSwitchEventName>(
    element: HTMLElement,
    eventName: K,
    detail: TrackSwitchEventMap[K]
): void {
    element.dispatchEvent(new CustomEvent(domEventNames[eventName], {
        detail,
        bubbles: true,
        composed: true,
    }));
}

export class TrackswitchPlayer extends HTMLElement implements TrackswitchPlayerElement {
    private currentInit: TrackSwitchInit | undefined;
    private currentController: TrackSwitchController | null = null;
    private mountRoot: HTMLDivElement | null = null;
    private unsubscribeHandlers: Array<() => void> = [];
    private loadGeneration = 0;

    get init(): TrackSwitchInit | undefined {
        return this.currentInit;
    }

    set init(nextInit: TrackSwitchInit | undefined) {
        this.currentInit = nextInit;
        void this.applyCurrentInit();
    }

    get config(): TrackSwitchInit | undefined {
        return this.init;
    }

    set config(nextConfig: TrackSwitchInit | undefined) {
        this.init = nextConfig;
    }

    get controller(): TrackSwitchController | null {
        return this.currentController;
    }

    connectedCallback(): void {
        this.ensureShadowRoot();
        void this.applyCurrentInit();
    }

    disconnectedCallback(): void {
        this.destroyController();
        this.mountRoot?.replaceChildren();
    }

    private ensureShadowRoot(): void {
        const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
        if (this.mountRoot && this.mountRoot.isConnected) {
            return;
        }

        const styleElement = document.createElement('style');
        styleElement.textContent = stylesheetText;

        const mountRoot = document.createElement('div');
        mountRoot.className = 'trackswitch-element-mount';

        root.replaceChildren(styleElement, mountRoot);
        this.mountRoot = mountRoot;
    }

    private async applyCurrentInit(): Promise<void> {
        if (!this.isConnected || !this.currentInit) {
            return;
        }

        this.ensureShadowRoot();

        if (!this.mountRoot) {
            return;
        }

        const nextInit = this.currentInit;
        const controller = this.currentController;

        if (controller) {
            try {
                await controller.updateInit(nextInit);
                return;
            } catch (_error) {
                this.destroyController();
            }
        }

        try {
            this.mountController(nextInit);
        } catch (error) {
            dispatchTrackSwitchEvent(this, 'error', {
                message: error instanceof Error ? error.message : 'Unexpected error while mounting TrackSwitch.',
            });
        }
    }

    private mountController(init: TrackSwitchInit): void {
        if (!this.mountRoot) {
            return;
        }

        this.mountRoot.replaceChildren();
        const controller = createTrackSwitch(this.mountRoot, init);
        this.currentController = controller;
        this.unsubscribeHandlers = [
            controller.on('loaded', (detail) => dispatchTrackSwitchEvent(this, 'loaded', detail)),
            controller.on('error', (detail) => dispatchTrackSwitchEvent(this, 'error', detail)),
            controller.on('position', (detail) => dispatchTrackSwitchEvent(this, 'position', detail)),
            controller.on('trackState', (detail) => dispatchTrackSwitchEvent(this, 'trackState', detail)),
        ];

        const generation = ++this.loadGeneration;
        void controller.load().catch((error) => {
            if (this.currentController !== controller || this.loadGeneration !== generation) {
                return;
            }

            dispatchTrackSwitchEvent(this, 'error', {
                message: error instanceof Error ? error.message : 'Unexpected error while loading TrackSwitch.',
            });
        });
    }

    private destroyController(): void {
        const controller = this.currentController;
        this.currentController = null;
        this.loadGeneration += 1;

        this.unsubscribeHandlers.forEach((unsubscribe) => unsubscribe());
        this.unsubscribeHandlers = [];

        if (controller) {
            controller.destroy();
        }
    }
}

export function defineTrackswitchElement(
    registry: CustomElementRegistry = customElements
): typeof TrackswitchPlayer {
    const existingConstructor = registry.get(TRACKSWITCH_ELEMENT_NAME);
    if (existingConstructor) {
        return existingConstructor as typeof TrackswitchPlayer;
    }

    registry.define(TRACKSWITCH_ELEMENT_NAME, TrackswitchPlayer);
    return TrackswitchPlayer;
}

declare global {
    interface HTMLElementTagNameMap {
        trackswitch: TrackswitchPlayer;
    }

    interface HTMLElementEventMap {
        'trackswitch-loaded': CustomEvent<TrackSwitchEventMap['loaded']>;
        'trackswitch-error': CustomEvent<TrackSwitchEventMap['error']>;
        'trackswitch-position': CustomEvent<TrackSwitchEventMap['position']>;
        'trackswitch-track-state': CustomEvent<TrackSwitchEventMap['trackState']>;
    }
}
