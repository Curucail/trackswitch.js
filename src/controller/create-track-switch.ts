import { TrackSwitchController, TrackSwitchInit } from '../domain/types';
import { normalizeInit } from './normalize-init';
import { TrackSwitchControllerImpl } from './track-switch-controller';

export function createTrackSwitch(rootElement: HTMLElement, init: TrackSwitchInit): TrackSwitchController {
    return new TrackSwitchControllerImpl(rootElement, normalizeInit(rootElement, init));
}
