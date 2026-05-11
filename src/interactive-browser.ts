import {
	defineTrackswitchInteractiveElement,
	TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	TrackswitchAlignmentInteractive,
} from "./interactive/interactive-element";
import {
	createAlignmentInteractiveTrackSwitch,
	createInteractiveTrackSwitch,
} from "./interactive/interactive-factory";

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

if (typeof window !== "undefined") {
	window.TrackSwitchInteractive = TrackSwitchInteractive;
}

export {
	createAlignmentInteractiveTrackSwitch,
	createInteractiveTrackSwitch,
	defineTrackswitchInteractiveElement,
	TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	TrackswitchAlignmentInteractive,
};
