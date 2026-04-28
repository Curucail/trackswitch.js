import { defineTrackswitchElement, TRACKSWITCH_DOM_EVENTS } from './element';
import type { TrackSwitchController, TrackSwitchEventMap, TrackSwitchInit } from './domain/types';
import type { TrackswitchDomEventName, TrackswitchPlayer } from './element';

export interface TrackswitchSvelteOptions {
    init: TrackSwitchInit;
    onLoaded?: (payload: TrackSwitchEventMap['loaded']) => void;
    onError?: (payload: TrackSwitchEventMap['error']) => void;
    onPosition?: (payload: TrackSwitchEventMap['position']) => void;
    onTrackState?: (payload: TrackSwitchEventMap['trackState']) => void;
}

export interface TrackswitchSvelteAction {
    update(options: TrackswitchSvelteOptions): void;
    destroy(): void;
}

function bindEvent(
    element: TrackswitchPlayer,
    eventName: TrackswitchDomEventName,
    getHandler: () => ((payload: any) => void) | undefined
): () => void {
    const listener = function(event: Event) {
        getHandler()?.((event as CustomEvent).detail);
    };

    element.addEventListener(eventName, listener);
    return function unsubscribe() {
        element.removeEventListener(eventName, listener);
    };
}

export function useTrackswitch(
    node: TrackswitchPlayer,
    options: TrackswitchSvelteOptions
): TrackswitchSvelteAction {
    defineTrackswitchElement();

    let currentOptions = options;
    node.init = currentOptions.init;

    const unsubscribers = [
        bindEvent(node, TRACKSWITCH_DOM_EVENTS.loaded, () => currentOptions.onLoaded),
        bindEvent(node, TRACKSWITCH_DOM_EVENTS.error, () => currentOptions.onError),
        bindEvent(node, TRACKSWITCH_DOM_EVENTS.position, () => currentOptions.onPosition),
        bindEvent(node, TRACKSWITCH_DOM_EVENTS.trackState, () => currentOptions.onTrackState),
    ];

    return {
        update(nextOptions: TrackswitchSvelteOptions) {
            currentOptions = nextOptions;
            node.init = nextOptions.init;
        },
        destroy() {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        },
    };
}

export function getTrackswitchController(node: TrackswitchPlayer): TrackSwitchController | null {
    return node.controller;
}
