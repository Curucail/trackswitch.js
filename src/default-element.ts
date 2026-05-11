import stylesheetText from "../css/trackswitch.css?inline";
import { loadElementConfig } from "./config/element-config";
import type {
	TrackSwitchController,
	TrackSwitchEventMap,
	TrackSwitchEventName,
	TrackSwitchInit,
} from "./domain/types";
import { createDefaultTrackSwitch } from "./player/default-factory";

export type TrackswitchDomEventName =
	| "trackswitch-loaded"
	| "trackswitch-error"
	| "trackswitch-position"
	| "trackswitch-track-state";

export interface TrackswitchPlayerElement extends HTMLElement {
	config: TrackSwitchInit | undefined;
	readonly controller: TrackSwitchController | null;
}

export const TRACKSWITCH_DEFAULT_ELEMENT_NAME = "trackswitch-player";
export const TRACKSWITCH_ELEMENT_NAME = TRACKSWITCH_DEFAULT_ELEMENT_NAME;

export const TRACKSWITCH_DOM_EVENTS: Record<
	TrackSwitchEventName,
	TrackswitchDomEventName
> = {
	loaded: "trackswitch-loaded",
	error: "trackswitch-error",
	position: "trackswitch-position",
	trackState: "trackswitch-track-state",
};

export function dispatchTrackSwitchEvent<K extends TrackSwitchEventName>(
	element: HTMLElement,
	eventName: K,
	detail: TrackSwitchEventMap[K],
): void {
	element.dispatchEvent(
		new CustomEvent(TRACKSWITCH_DOM_EVENTS[eventName], {
			detail,
			bubbles: true,
			composed: true,
		}),
	);
}

export abstract class TrackswitchPlayerBase
	extends HTMLElement
	implements TrackswitchPlayerElement
{
	private currentConfig: TrackSwitchInit | undefined;
	private currentController: TrackSwitchController | null = null;
	private mountRoot: HTMLDivElement | null = null;
	private unsubscribeHandlers: Array<() => void> = [];
	private loadGeneration = 0;
	private configLoadGeneration = 0;
	private controllerLoadPromise: Promise<void> | null = null;

	get config(): TrackSwitchInit | undefined {
		return this.currentConfig;
	}

	set config(nextConfig: TrackSwitchInit | undefined) {
		this.configLoadGeneration += 1;
		this.currentConfig = nextConfig;
		void this.applyCurrentConfig();
	}

	get controller(): TrackSwitchController | null {
		return this.currentController;
	}

	protected abstract createController(
		rootElement: HTMLElement,
		init: TrackSwitchInit,
	): TrackSwitchController;

	connectedCallback(): void {
		this.ensureShadowRoot();
		if (this.currentConfig) {
			void this.applyCurrentConfig();
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
				(rawConfig) => rawConfig as TrackSwitchInit,
			);
			if (
				!this.isConnected ||
				this.configLoadGeneration !== generation ||
				!nextConfig
			) {
				return;
			}

			this.currentConfig = nextConfig;
			await this.applyCurrentConfig();
		} catch (error) {
			if (!this.isConnected || this.configLoadGeneration !== generation) {
				return;
			}

			dispatchTrackSwitchEvent(this, "error", {
				message:
					error instanceof Error
						? error.message
						: "Unexpected error while loading TrackSwitch config.",
			});
		}
	}

	private async applyCurrentConfig(): Promise<void> {
		if (!this.isConnected || !this.currentConfig) {
			return;
		}

		this.ensureShadowRoot();

		if (!this.mountRoot) {
			return;
		}

		const controller = this.currentController;

		if (controller) {
			try {
				if (this.controllerLoadPromise) {
					await this.controllerLoadPromise;
				}
				if (
					!this.isConnected ||
					this.currentController !== controller ||
					!this.currentConfig
				) {
					return;
				}
				await controller.updateInit(this.currentConfig);
				return;
			} catch (_error) {
				if (!this.isConnected || !this.currentConfig) {
					return;
				}
				this.destroyController();
			}
		}

		try {
			this.mountController(this.currentConfig);
		} catch (error) {
			dispatchTrackSwitchEvent(this, "error", {
				message:
					error instanceof Error
						? error.message
						: "Unexpected error while mounting TrackSwitch.",
			});
		}
	}

	private mountController(init: TrackSwitchInit): void {
		if (!this.mountRoot) {
			return;
		}

		this.mountRoot.replaceChildren();
		const controller = this.createController(this.mountRoot, init);
		this.currentController = controller;
		this.unsubscribeHandlers = [
			controller.on("loaded", (detail) =>
				dispatchTrackSwitchEvent(this, "loaded", detail),
			),
			controller.on("error", (detail) =>
				dispatchTrackSwitchEvent(this, "error", detail),
			),
			controller.on("position", (detail) =>
				dispatchTrackSwitchEvent(this, "position", detail),
			),
			controller.on("trackState", (detail) =>
				dispatchTrackSwitchEvent(this, "trackState", detail),
			),
		];

		const generation = ++this.loadGeneration;
		const loadPromise = controller
			.load()
			.catch((error) => {
				if (
					this.currentController !== controller ||
					this.loadGeneration !== generation
				) {
					return;
				}

				dispatchTrackSwitchEvent(this, "error", {
					message:
						error instanceof Error
							? error.message
							: "Unexpected error while loading TrackSwitch.",
				});
			})
			.finally(() => {
				if (
					this.currentController === controller &&
					this.loadGeneration === generation
				) {
					this.controllerLoadPromise = null;
				}
			});
		this.controllerLoadPromise = loadPromise;
	}

	private destroyController(): void {
		const controller = this.currentController;
		this.currentController = null;
		this.controllerLoadPromise = null;
		this.loadGeneration += 1;

		this.unsubscribeHandlers.forEach((unsubscribe) => {
			unsubscribe();
		});
		this.unsubscribeHandlers = [];

		if (controller) {
			controller.destroy();
		}
	}
}

export class TrackswitchPlayer extends TrackswitchPlayerBase {
	protected createController(
		rootElement: HTMLElement,
		init: TrackSwitchInit,
	): TrackSwitchController {
		return createDefaultTrackSwitch(rootElement, init);
	}
}

function defineTrackswitchElementWithConstructor<
	T extends CustomElementConstructor,
>(
	registry: CustomElementRegistry,
	elementName: string,
	elementConstructor: T,
): T {
	const existingConstructor = registry.get(elementName);
	if (existingConstructor) {
		return existingConstructor as T;
	}

	registry.define(elementName, elementConstructor);
	return elementConstructor;
}

export function defineTrackswitchDefaultElement(
	registry: CustomElementRegistry = customElements,
): typeof TrackswitchPlayer {
	return defineTrackswitchElementWithConstructor(
		registry,
		TRACKSWITCH_DEFAULT_ELEMENT_NAME,
		TrackswitchPlayer,
	);
}

export const defineTrackswitchElement = defineTrackswitchDefaultElement;

declare global {
	interface HTMLElementTagNameMap {
		[TRACKSWITCH_DEFAULT_ELEMENT_NAME]: TrackswitchPlayer;
	}
}
