import {
    createAlignmentInteractiveTrackSwitch,
    createInteractiveTrackSwitch,
} from './interactive/interactive-factory';
import {
    TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
    TrackswitchAlignmentInteractive,
    defineTrackswitchInteractiveElement,
} from './interactive/interactive-element';

defineTrackswitchInteractiveElement();

const TrackSwitchInteractive = {
    TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
    TrackswitchAlignmentInteractive,
    createAlignmentInteractiveTrackSwitch,
    createInteractiveTrackSwitch,
    defineTrackswitchInteractiveElement,
};

declare global {
    interface Window {
        TrackSwitchInteractive: typeof TrackSwitchInteractive;
    }
}

if (typeof window !== 'undefined') {
    window.TrackSwitchInteractive = TrackSwitchInteractive;
}

export {
    TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
    TrackswitchAlignmentInteractive,
    createAlignmentInteractiveTrackSwitch,
    createInteractiveTrackSwitch,
    defineTrackswitchInteractiveElement,
};
