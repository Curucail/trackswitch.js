import {
	defineTrackswitchAlignmentElement,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TrackswitchAlignmentPlayer,
} from "./alignment-element";
import { createAlignmentTrackSwitch } from "./player/alignment-factory";

defineTrackswitchAlignmentElement();

const TrackSwitchAlignment = {
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TrackswitchAlignmentPlayer,
	createAlignmentTrackSwitch,
	defineTrackswitchAlignmentElement,
};

if (typeof window !== "undefined") {
	const targetWindow = window as Window & {
		TrackSwitch?: Record<string, unknown>;
	};
	targetWindow.TrackSwitch = {
		...(targetWindow.TrackSwitch ?? {}),
		...TrackSwitchAlignment,
	};
}

export {
	createAlignmentTrackSwitch,
	defineTrackswitchAlignmentElement,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TrackswitchAlignmentPlayer,
};
