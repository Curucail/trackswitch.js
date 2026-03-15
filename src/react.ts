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
import { createTrackSwitch } from './player/factory';
import type { TrackSwitchController, TrackSwitchInit } from './domain/types';

export interface UseTrackSwitchResult {
    rootRef: MutableRefObject<HTMLDivElement | null>;
    controllerRef: MutableRefObject<TrackSwitchController | null>;
}

export interface TrackSwitchPlayerProps {
    init: TrackSwitchInit;
    id?: string;
    className?: string;
    style?: CSSProperties;
}

export function useTrackSwitch(init: TrackSwitchInit): UseTrackSwitchResult {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const controllerRef = useRef<TrackSwitchController | null>(null);

    useEffect(() => {
        const rootElement = rootRef.current;
        if (!rootElement) {
            return;
        }

        const controller = createTrackSwitch(rootElement, init);
        controllerRef.current = controller;

        return () => {
            controller.destroy();
            controllerRef.current = null;
        };
    }, [init]);

    return {
        rootRef,
        controllerRef,
    };
}

export const TrackSwitchPlayer = forwardRef(function TrackSwitchPlayer(
    { init, id, className, style }: TrackSwitchPlayerProps,
    ref: Ref<TrackSwitchController | null>
) {
    const { rootRef, controllerRef } = useTrackSwitch(init);

    useImperativeHandle(ref, () => controllerRef.current, [controllerRef]);

    return createElement('div', {
        ref: rootRef,
        id,
        className,
        style,
    });
});
