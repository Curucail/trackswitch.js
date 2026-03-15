import { TrackSwitchController, TrackSwitchInit } from '../domain/types';
import { normalizeInit } from '../config/normalize-init';
import { TrackSwitchControllerImpl } from './player-controller';

export function createTrackSwitch(rootElement: HTMLElement, init: TrackSwitchInit): TrackSwitchController {
    return new TrackSwitchControllerImpl(rootElement, normalizeInit(rootElement, init));
}
