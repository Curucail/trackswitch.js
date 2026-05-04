import type {
    TrackSwitchController,
    TrackSwitchInit,
} from '../domain/types';
import { normalizeInit } from '../config/normalize-init';
import { TrackSwitchControllerImpl } from './player-controller';

export function createDefaultTrackSwitch(
    rootElement: HTMLElement,
    init: TrackSwitchInit
): TrackSwitchController {
    return new TrackSwitchControllerImpl(
        rootElement,
        normalizeInit(rootElement, init, { variant: 'default' })
    );
}

export const createTrackSwitch = createDefaultTrackSwitch;
