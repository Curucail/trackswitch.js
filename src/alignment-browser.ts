import { createAlignmentTrackSwitch } from './player/alignment-factory';
import {
    TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
    TrackswitchAlignmentPlayer,
    defineTrackswitchAlignmentElement,
} from './alignment-element';

defineTrackswitchAlignmentElement();

const TrackSwitchAlignment = {
    TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
    TrackswitchAlignmentPlayer,
    createAlignmentTrackSwitch,
    defineTrackswitchAlignmentElement,
};

if (typeof window !== 'undefined') {
    const targetWindow = window as Window & { TrackSwitch?: Record<string, unknown> };
    targetWindow.TrackSwitch = {
        ...(targetWindow.TrackSwitch ?? {}),
        ...TrackSwitchAlignment,
    };
}

export {
    TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
    TrackswitchAlignmentPlayer,
    createAlignmentTrackSwitch,
    defineTrackswitchAlignmentElement,
};
