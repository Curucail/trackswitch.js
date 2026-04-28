import { createTrackSwitch } from './player/factory';
import { TrackswitchPlayer, defineTrackswitchElement } from './element';

defineTrackswitchElement();

const TrackSwitch = {
    TrackswitchPlayer,
    createTrackSwitch,
    defineTrackswitchElement,
};

declare global {
    interface Window {
        TrackSwitch: typeof TrackSwitch;
    }
}

if (typeof window !== 'undefined') {
    window.TrackSwitch = TrackSwitch;
}

export { TrackswitchPlayer, createTrackSwitch, defineTrackswitchElement };
