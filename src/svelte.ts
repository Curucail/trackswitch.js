import type {
	TrackSwitchController,
	TrackSwitchEventMap,
	TrackSwitchInit,
} from "./domain/types";
import type { TrackswitchDomEventName, TrackswitchPlayer } from "./element";
import {
	defineTrackswitchAlignmentElement,
	defineTrackswitchDefaultElement,
	TRACKSWITCH_DOM_EVENTS,
} from "./element";
import { defineTrackswitchInteractiveElement } from "./interactive/interactive-element";
import type {
	InteractiveTrackSwitchController,
	InteractiveTrackSwitchInit,
} from "./interactive/types";

export type TrackswitchSvelteVariant =
	| "default"
	| "alignment"
	| "alignment-interactive";

export interface TrackswitchSvelteOptions {
	config: TrackSwitchInit | InteractiveTrackSwitchInit;
	variant?: TrackswitchSvelteVariant;
	onLoaded?: (payload: TrackSwitchEventMap["loaded"]) => void;
	onError?: (payload: TrackSwitchEventMap["error"]) => void;
	onPosition?: (payload: TrackSwitchEventMap["position"]) => void;
	onTrackState?: (payload: TrackSwitchEventMap["trackState"]) => void;
}

export interface TrackswitchSvelteAction {
	update(options: TrackswitchSvelteOptions): void;
	destroy(): void;
}

type TrackswitchSvelteElement = HTMLElement & {
	config?: TrackSwitchInit | InteractiveTrackSwitchInit;
	controller?: TrackSwitchController | InteractiveTrackSwitchController | null;
};

function bindEvent(
	element: HTMLElement,
	eventName: TrackswitchDomEventName,
	getHandler: () => ((payload: any) => void) | undefined,
): () => void {
	const listener = (event: Event) => {
		getHandler()?.((event as CustomEvent).detail);
	};

	element.addEventListener(eventName, listener);
	return function unsubscribe() {
		element.removeEventListener(eventName, listener);
	};
}

function defineElementForVariant(
	variant: TrackswitchSvelteVariant | undefined,
): void {
	if (variant === "alignment") {
		defineTrackswitchAlignmentElement();
		return;
	}

	if (variant === "alignment-interactive") {
		defineTrackswitchInteractiveElement();
		return;
	}

	defineTrackswitchDefaultElement();
}

export function useTrackswitch(
	node: TrackswitchSvelteElement,
	options: TrackswitchSvelteOptions,
): TrackswitchSvelteAction {
	defineElementForVariant(options.variant);

	let currentOptions = options;
	node.config = currentOptions.config;

	const unsubscribers = [
		bindEvent(
			node,
			TRACKSWITCH_DOM_EVENTS.loaded,
			() => currentOptions.onLoaded,
		),
		bindEvent(node, TRACKSWITCH_DOM_EVENTS.error, () => currentOptions.onError),
		bindEvent(
			node,
			TRACKSWITCH_DOM_EVENTS.position,
			() => currentOptions.onPosition,
		),
		bindEvent(
			node,
			TRACKSWITCH_DOM_EVENTS.trackState,
			() => currentOptions.onTrackState,
		),
	];

	return {
		update(nextOptions: TrackswitchSvelteOptions) {
			defineElementForVariant(nextOptions.variant);
			currentOptions = nextOptions;
			node.config = nextOptions.config;
		},
		destroy() {
			unsubscribers.forEach((unsubscribe) => {
				unsubscribe();
			});
		},
	};
}

export function getTrackswitchController(
	node: TrackswitchPlayer,
): TrackSwitchController | null {
	return node.controller;
}

export function getTrackswitchInteractiveController(
	node: TrackswitchSvelteElement,
): InteractiveTrackSwitchController | null {
	return (node.controller as InteractiveTrackSwitchController | null) || null;
}
