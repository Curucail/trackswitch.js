import stylesheetText from "../../css/trackswitch.css?inline";
import { loadElementConfig } from "../config/element-config";
import { createAlignmentInteractiveTrackSwitch } from "./interactive-factory";
import type {
	InteractiveTrackSwitchController,
	InteractiveTrackSwitchInit,
} from "./types";

export const TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME =
	"trackswitch-alignment-interactive";

export interface TrackswitchAlignmentInteractiveElement extends HTMLElement {
	config: InteractiveTrackSwitchInit | undefined;
	readonly controller: InteractiveTrackSwitchController | null;
}

export class TrackswitchAlignmentInteractive
	extends HTMLElement
	implements TrackswitchAlignmentInteractiveElement
{
	private currentConfig: InteractiveTrackSwitchInit | undefined;
	private currentController: InteractiveTrackSwitchController | null = null;
	private mountRoot: HTMLDivElement | null = null;
	private configLoadGeneration = 0;

	get config(): InteractiveTrackSwitchInit | undefined {
		return this.currentConfig;
	}

	set config(nextConfig: InteractiveTrackSwitchInit | undefined) {
		this.configLoadGeneration += 1;
		this.currentConfig = nextConfig;
		this.applyCurrentConfig();
	}

	get controller(): InteractiveTrackSwitchController | null {
		return this.currentController;
	}

	connectedCallback(): void {
		this.ensureShadowRoot();
		if (this.currentConfig) {
			this.applyCurrentConfig();
			return;
		}

		void this.loadDeclarativeConfig();
	}

	disconnectedCallback(): void {
		this.configLoadGeneration += 1;
		this.destroyController();
		this.mountRoot?.replaceChildren();
	}

	private ensureShadowRoot(): void {
		const root = this.shadowRoot || this.attachShadow({ mode: "open" });
		if (this.mountRoot?.isConnected) {
			return;
		}

		const styleElement = document.createElement("style");
		styleElement.textContent = stylesheetText;

		const mountRoot = document.createElement("div");
		mountRoot.className = "trackswitch-element-mount";

		root.replaceChildren(styleElement, mountRoot);
		this.mountRoot = mountRoot;
	}

	private async loadDeclarativeConfig(): Promise<void> {
		const generation = ++this.configLoadGeneration;

		try {
			const nextConfig = await loadElementConfig(
				this,
				(rawConfig) => rawConfig as InteractiveTrackSwitchInit,
			);
			if (
				!this.isConnected ||
				this.configLoadGeneration !== generation ||
				!nextConfig
			) {
				return;
			}

			this.currentConfig = nextConfig;
			this.applyCurrentConfig();
		} catch (error) {
			if (!this.isConnected || this.configLoadGeneration !== generation) {
				return;
			}

			this.dispatchConfigError(error);
		}
	}

	private applyCurrentConfig(): void {
		if (!this.isConnected || !this.currentConfig) {
			return;
		}

		this.ensureShadowRoot();

		if (!this.mountRoot) {
			return;
		}

		this.destroyController();
		this.mountRoot.replaceChildren();

		const controller = createAlignmentInteractiveTrackSwitch(
			this.mountRoot,
			this.currentConfig,
		);
		this.currentController = controller;
		controller.initialize();
	}

	private dispatchConfigError(error: unknown): void {
		this.dispatchEvent(
			new CustomEvent("trackswitch-error", {
				detail: {
					message:
						error instanceof Error
							? error.message
							: "Unexpected error while loading TrackSwitch config.",
				},
				bubbles: true,
				composed: true,
			}),
		);
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
	registry: CustomElementRegistry = customElements,
): typeof TrackswitchAlignmentInteractive {
	const existingConstructor = registry.get(
		TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	);
	if (existingConstructor) {
		return existingConstructor as typeof TrackswitchAlignmentInteractive;
	}

	registry.define(
		TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
		TrackswitchAlignmentInteractive,
	);
	return TrackswitchAlignmentInteractive;
}

declare global {
	interface HTMLElementTagNameMap {
		"trackswitch-alignment-interactive": TrackswitchAlignmentInteractive;
	}
}
