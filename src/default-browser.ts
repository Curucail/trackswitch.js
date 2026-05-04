import {
    createDefaultTrackSwitch,
    createTrackSwitch,
} from './player/default-factory';
import {
    TRACKSWITCH_DEFAULT_ELEMENT_NAME,
    TRACKSWITCH_ELEMENT_NAME,
    TrackswitchPlayer,
    defineTrackswitchDefaultElement,
    defineTrackswitchElement,
} from './default-element';

defineTrackswitchDefaultElement();

const TrackSwitchDefault = {
    TRACKSWITCH_DEFAULT_ELEMENT_NAME,
    TRACKSWITCH_ELEMENT_NAME,
    TrackswitchPlayer,
    createDefaultTrackSwitch,
    createTrackSwitch,
    defineTrackswitchDefaultElement,
    defineTrackswitchElement,
};

if (typeof window !== 'undefined') {
    const targetWindow = window as Window & { TrackSwitch?: Record<string, unknown> };
    targetWindow.TrackSwitch = {
        ...(targetWindow.TrackSwitch ?? {}),
        ...TrackSwitchDefault,
    };
}

export {
    TRACKSWITCH_DEFAULT_ELEMENT_NAME,
    TRACKSWITCH_ELEMENT_NAME,
    TrackswitchPlayer,
    createDefaultTrackSwitch,
    createTrackSwitch,
    defineTrackswitchDefaultElement,
    defineTrackswitchElement,
};
