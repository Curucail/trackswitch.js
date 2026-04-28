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
import { defineTrackswitchElement } from './element';
import type { TrackSwitchController, TrackSwitchEventMap, TrackSwitchInit } from './domain/types';
import type { TrackswitchPlayer } from './element';

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

export interface UseTrackSwitchElementOptions extends TrackSwitchEventProps {
    initKey?: string | number;
}

export interface UseTrackSwitchElementResult {
    rootRef: MutableRefObject<TrackswitchPlayer | null>;
    controllerRef: MutableRefObject<TrackSwitchController | null>;
}

function addTrackswitchListener<K extends keyof TrackSwitchEventProps>(
    element: TrackswitchPlayer,
    eventName: string,
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

export function useTrackSwitchElement(
    init: TrackSwitchInit,
    {
        initKey,
        onLoaded,
        onError,
        onPosition,
        onTrackState,
    }: UseTrackSwitchElementOptions = {}
): UseTrackSwitchElementResult {
    const rootRef = useRef<TrackswitchPlayer | null>(null);
    const controllerRef = useRef<TrackSwitchController | null>(null);

    useEffect(() => {
        defineTrackswitchElement();
    }, []);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) {
            return;
        }

        element.init = init;
        controllerRef.current = element.controller;

        const unsubscribeLoaded = addTrackswitchListener(element, 'trackswitch-loaded', onLoaded);
        const unsubscribeError = addTrackswitchListener(element, 'trackswitch-error', onError);
        const unsubscribePosition = addTrackswitchListener(element, 'trackswitch-position', onPosition);
        const unsubscribeTrackState = addTrackswitchListener(element, 'trackswitch-track-state', onTrackState);

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
    }, [init]);

    return {
        rootRef,
        controllerRef,
    };
}

export const TrackSwitchPlayer = forwardRef(function TrackSwitchPlayer(
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
    });

    useImperativeHandle(ref, () => controllerRef.current, [controllerRef.current, initKey]);

    return createElement('trackswitch-player', {
        ref: rootRef,
        id,
        className,
        style,
    });
});

export const TrackSwitchElement = TrackSwitchPlayer;
