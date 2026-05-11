import {
	createAlignmentTrackSwitch,
	createDefaultTrackSwitch,
	createTrackSwitch,
} from "./player/factory";
import {
	TrackswitchAlignmentPlayer,
	TrackswitchPlayer,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	defineTrackswitchAlignmentElement,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
} from "./element";
import {
	TRACKSWITCH_ALIGNMENT_INTERACTIVE_ELEMENT_NAME,
	TrackswitchAlignmentInteractive,
	defineTrackswitchInteractiveElement,
} from "./interactive/interactive-element";
import {
	createAlignmentInteractiveTrackSwitch,
	createInteractiveTrackSwitch,
} from "./interactive/interactive-factory";

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
