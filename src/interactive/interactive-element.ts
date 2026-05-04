import stylesheetText from '../../css/trackswitch.css?inline';
import { createAlignmentInteractiveTrackSwitch } from './interactive-factory';
import type { InteractiveTrackSwitchController, InteractiveTrackSwitchInit } from './types';

export const TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME = 'trackswitch-alignment-interactive';

export interface TrackswitchAlignmentInteractiveElement extends HTMLElement {
    init: InteractiveTrackSwitchInit | undefined;
    config: InteractiveTrackSwitchInit | undefined;
    readonly controller: InteractiveTrackSwitchController | null;
}

export class TrackswitchAlignmentInteractive
    extends HTMLElement
    implements TrackswitchAlignmentInteractiveElement {
    private currentInit: InteractiveTrackSwitchInit | undefined;
    private currentController: InteractiveTrackSwitchController | null = null;
    private mountRoot: HTMLDivElement | null = null;

    get init(): InteractiveTrackSwitchInit | undefined {
        return this.currentInit;
    }

    set init(nextInit: InteractiveTrackSwitchInit | undefined) {
        this.currentInit = nextInit;
        this.applyCurrentInit();
    }

    get config(): InteractiveTrackSwitchInit | undefined {
        return this.init;
    }

    set config(nextConfig: InteractiveTrackSwitchInit | undefined) {
        this.init = nextConfig;
    }

    get controller(): InteractiveTrackSwitchController | null {
        return this.currentController;
    }

    connectedCallback(): void {
        this.ensureShadowRoot();
        this.applyCurrentInit();
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

    private applyCurrentInit(): void {
        if (!this.isConnected) {
            return;
        }

        this.ensureShadowRoot();

        if (!this.mountRoot) {
            return;
        }

        this.destroyController();
        this.mountRoot.replaceChildren();

        const controller = createAlignmentInteractiveTrackSwitch(this.mountRoot, this.currentInit || {});
        this.currentController = controller;
        controller.initialize();
    }

    private destroyController(): void {
        const controller = this.currentController;
        this.currentController = null;

        if (controller) {
            controller.destroy();
        }
    }
}

export function defineTrackswitchInteractiveElement(
    registry: CustomElementRegistry = customElements
): typeof TrackswitchAlignmentInteractive {
    const existingConstructor = registry.get(TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME);
    if (existingConstructor) {
        return existingConstructor as typeof TrackswitchAlignmentInteractive;
    }

    registry.define(TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME, TrackswitchAlignmentInteractive);
    return TrackswitchAlignmentInteractive;
}

declare global {
    interface HTMLElementTagNameMap {
        'trackswitch-alignment-interactive': TrackswitchAlignmentInteractive;
    }
}
