import {
    createElement,
    forwardRef,
    useEffect,
    useRef,
    type CSSProperties,
    type MutableRefObject,
    type Ref,
} from 'react';
import { createTrackSwitch } from './player/factory';
import type {
    TrackSwitchController,
    TrackSwitchEventMap,
    TrackSwitchInit,
    TrackSwitchMountOptions,
} from './domain/types';

export interface TrackSwitchEventProps {
    onLoaded?: (payload: TrackSwitchEventMap['loaded']) => void;
    onError?: (payload: TrackSwitchEventMap['error']) => void;
    onPosition?: (payload: TrackSwitchEventMap['position']) => void;
    onTrackState?: (payload: TrackSwitchEventMap['trackState']) => void;
}

export interface UseTrackSwitchOptions extends TrackSwitchEventProps {
    initKey?: string | number;
    autoLoad?: boolean;
    mount?: TrackSwitchMountOptions;
}

export interface UseTrackSwitchResult {
    rootRef: MutableRefObject<HTMLDivElement | null>;
    controllerRef: MutableRefObject<TrackSwitchController | null>;
}

export interface TrackSwitchPlayerProps extends TrackSwitchEventProps {
    init: TrackSwitchInit;
    initKey?: string | number;
    autoLoad?: boolean;
    mount?: TrackSwitchMountOptions;
    id?: string;
    className?: string;
    style?: CSSProperties;
}

function setRefValue<T>(ref: Ref<T> | undefined, value: T): void {
    if (!ref) {
        return;
    }

    if (typeof ref === 'function') {
        ref(value);
        return;
    }

    ref.current = value;
}

export function useTrackSwitch(
    init: TrackSwitchInit,
    {
        initKey,
        autoLoad = true,
        mount,
        onLoaded,
        onError,
        onPosition,
        onTrackState,
    }: UseTrackSwitchOptions = {}
): UseTrackSwitchResult {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const controllerRef = useRef<TrackSwitchController | null>(null);
    const eventHandlersRef = useRef<TrackSwitchEventProps>({});
    const initRef = useRef<TrackSwitchInit | null>(null);

    // Keep callbacks live without recreating the controller on every parent render.
    eventHandlersRef.current = {
        onLoaded,
        onError,
        onPosition,
        onTrackState,
    };

    useEffect(() => {
        const rootElement = rootRef.current;
        if (!rootElement) {
            return;
        }

        const controller = createTrackSwitch(rootElement, init, mount);
        controllerRef.current = controller;
        initRef.current = init;

        const unsubscribeLoaded = controller.on('loaded', (payload) => {
            eventHandlersRef.current.onLoaded?.(payload);
        });
        const unsubscribeError = controller.on('error', (payload) => {
            eventHandlersRef.current.onError?.(payload);
        });
        const unsubscribePosition = controller.on('position', (payload) => {
            eventHandlersRef.current.onPosition?.(payload);
        });
        const unsubscribeTrackState = controller.on('trackState', (payload) => {
            eventHandlersRef.current.onTrackState?.(payload);
        });

        if (autoLoad) {
            void controller.load().catch(() => {
                // `load()` is expected to report failures through controller error events.
            });
        }

        return () => {
            unsubscribeLoaded();
            unsubscribeError();
            unsubscribePosition();
            unsubscribeTrackState();
            controllerRef.current = null;
            initRef.current = null;
            controller.destroy();
        };
    }, [initKey]);

    useEffect(() => {
        const controller = controllerRef.current;
        if (!controller || initRef.current === init) {
            return;
        }

        initRef.current = init;
        void controller.updateInit(init).catch(() => {
            // `updateInit()` reports failures through controller error events.
        });
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
        autoLoad = true,
        mount,
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
    const { rootRef, controllerRef } = useTrackSwitch(init, {
        initKey,
        autoLoad,
        mount,
        onLoaded,
        onError,
        onPosition,
        onTrackState,
    });

    useEffect(() => {
        setRefValue(ref, controllerRef.current);

        return () => {
            setRefValue(ref, null);
        };
    }, [ref, controllerRef, initKey]);

    return createElement('div', {
        ref: rootRef,
        id,
        className,
        style,
    });
});
