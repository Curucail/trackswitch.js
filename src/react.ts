import {
    createElement,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    type CSSProperties,
    type MutableRefObject,
    type Ref,
} from 'react';
import {
    defineTrackswitchAlignmentElement,
    defineTrackswitchDefaultElement,
    TRACKSWITCH_DOM_EVENTS,
} from './element';
import { defineTrackswitchInteractiveElement } from './interactive/interactive-element';
import type { TrackSwitchController, TrackSwitchEventMap, TrackSwitchInit } from './domain/types';
import type { TrackswitchDomEventName, TrackswitchPlayer } from './element';
import type { InteractiveTrackSwitchController, InteractiveTrackSwitchInit } from './interactive/types';

export interface TrackSwitchEventProps {
    onLoaded?: (payload: TrackSwitchEventMap['loaded']) => void;
    onError?: (payload: TrackSwitchEventMap['error']) => void;
    onPosition?: (payload: TrackSwitchEventMap['position']) => void;
    onTrackState?: (payload: TrackSwitchEventMap['trackState']) => void;
}

export interface TrackSwitchPlayerProps extends TrackSwitchEventProps {
    init: TrackSwitchInit;
    initKey?: string | number;
    id?: string;
    className?: string;
    style?: CSSProperties;
}

export interface TrackSwitchInteractiveProps {
    init?: InteractiveTrackSwitchInit;
    initKey?: string | number;
    id?: string;
    className?: string;
    style?: CSSProperties;
}

export interface UseTrackSwitchElementOptions extends TrackSwitchEventProps {
    initKey?: string | number;
}

export interface UseTrackSwitchElementResult {
    rootRef: MutableRefObject<TrackswitchPlayer | null>;
    controllerRef: MutableRefObject<TrackSwitchController | null>;
}

function addTrackswitchListener<K extends keyof TrackSwitchEventProps>(
    element: TrackswitchPlayer,
    eventName: TrackswitchDomEventName,
    handler: TrackSwitchEventProps[K]
): () => void {
    if (!handler) {
        return function noop() {
            return;
        };
    }

    const listener = function(event: Event) {
        handler((event as CustomEvent).detail);
    };

    element.addEventListener(eventName, listener);
    return function unsubscribe() {
        element.removeEventListener(eventName, listener);
    };
}

function defineTrackSwitchElementForTag(tagName: string): void {
    if (tagName === 'trackswitch-alignment-player') {
        defineTrackswitchAlignmentElement();
        return;
    }

    defineTrackswitchDefaultElement();
}

export function useTrackSwitchElement(
    init: TrackSwitchInit,
    {
        initKey,
        onLoaded,
        onError,
        onPosition,
        onTrackState,
    }: UseTrackSwitchElementOptions = {},
    tagName = 'trackswitch-player'
): UseTrackSwitchElementResult {
    const rootRef = useRef<TrackswitchPlayer | null>(null);
    const controllerRef = useRef<TrackSwitchController | null>(null);

    useEffect(() => {
        defineTrackSwitchElementForTag(tagName);
    }, [tagName]);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) {
            return;
        }

        const unsubscribeLoaded = addTrackswitchListener(element, TRACKSWITCH_DOM_EVENTS.loaded, onLoaded);
        const unsubscribeError = addTrackswitchListener(element, TRACKSWITCH_DOM_EVENTS.error, onError);
        const unsubscribePosition = addTrackswitchListener(element, TRACKSWITCH_DOM_EVENTS.position, onPosition);
        const unsubscribeTrackState = addTrackswitchListener(
            element,
            TRACKSWITCH_DOM_EVENTS.trackState,
            onTrackState
        );

        return () => {
            unsubscribeLoaded();
            unsubscribeError();
            unsubscribePosition();
            unsubscribeTrackState();
            controllerRef.current = null;
        };
    }, [initKey, onLoaded, onError, onPosition, onTrackState]);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) {
            return;
        }

        element.init = init;
        controllerRef.current = element.controller;
    }, [init, initKey]);

    return {
        rootRef,
        controllerRef,
    };
}

function createTrackSwitchReactComponent(tagName: 'trackswitch-player' | 'trackswitch-alignment-player') {
    return forwardRef(function TrackSwitchReactComponent(
        {
            init,
            initKey,
            id,
            className,
            style,
            onLoaded,
            onError,
            onPosition,
            onTrackState,
        }: TrackSwitchPlayerProps,
        ref: Ref<TrackSwitchController | null>
    ) {
        const { rootRef, controllerRef } = useTrackSwitchElement(init, {
            initKey,
            onLoaded,
            onError,
            onPosition,
            onTrackState,
        }, tagName);

        useImperativeHandle(ref, () => controllerRef.current, [controllerRef.current, initKey]);

        return createElement(tagName, {
            ref: rootRef,
            id,
            className,
            style,
        });
    });
}

export const TrackSwitchPlayer = createTrackSwitchReactComponent('trackswitch-player');
export const TrackSwitchAlignmentPlayer = createTrackSwitchReactComponent('trackswitch-alignment-player');

export const TrackSwitchAlignmentInteractive = forwardRef(function TrackSwitchAlignmentInteractive(
    {
        init,
        initKey,
        id,
        className,
        style,
    }: TrackSwitchInteractiveProps,
    ref: Ref<InteractiveTrackSwitchController | null>
) {
    const rootRef = useRef<HTMLElement & {
        init?: InteractiveTrackSwitchInit;
        controller?: InteractiveTrackSwitchController | null;
    } | null>(null);
    const controllerRef = useRef<InteractiveTrackSwitchController | null>(null);

    useEffect(() => {
        defineTrackswitchInteractiveElement();
    }, []);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) {
            return;
        }

        element.init = init || {};
        controllerRef.current = element.controller || null;

        return () => {
            controllerRef.current = null;
        };
    }, [initKey]);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) {
            return;
        }

        element.init = init || {};
        controllerRef.current = element.controller || null;
    }, [init]);

    useImperativeHandle(ref, () => controllerRef.current, [controllerRef.current, initKey]);

    return createElement('trackswitch-alignment-interactive', {
        ref: rootRef,
        id,
        className,
        style,
    });
});

export const TrackSwitchElement = TrackSwitchPlayer;
