import {
	defineTrackswitchAlignmentElement,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchAlignmentPlayer,
	TrackswitchPlayer,
} from "./element";
import {
	defineTrackswitchInteractiveElement,
	TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	TrackswitchAlignmentInteractive,
} from "./interactive/interactive-element";
import {
	createAlignmentInteractiveTrackSwitch,
	createInteractiveTrackSwitch,
} from "./interactive/interactive-factory";
import {
	createAlignmentTrackSwitch,
	createDefaultTrackSwitch,
	createTrackSwitch,
} from "./player/factory";

defineTrackswitchElements();

const TrackSwitch = {
	TrackswitchAlignmentPlayer,
	TrackswitchAlignmentInteractive,
	TrackswitchPlayer,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	createAlignmentInteractiveTrackSwitch,
	createAlignmentTrackSwitch,
	createDefaultTrackSwitch,
	createInteractiveTrackSwitch,
	createTrackSwitch,
	defineTrackswitchAlignmentElement,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	defineTrackswitchInteractiveElement,
};

declare global {
	interface Window {
		TrackSwitch: typeof TrackSwitch;
	}
}

if (typeof window !== "undefined") {
	window.TrackSwitch = TrackSwitch;
}

export {
	createAlignmentInteractiveTrackSwitch,
	createAlignmentTrackSwitch,
	createDefaultTrackSwitch,
	createInteractiveTrackSwitch,
	createTrackSwitch,
	defineTrackswitchAlignmentElement,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	defineTrackswitchInteractiveElement,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchAlignmentInteractive,
	TrackswitchAlignmentPlayer,
	TrackswitchPlayer,
};
