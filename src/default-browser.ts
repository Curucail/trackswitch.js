import {
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchPlayer,
} from "./default-element";
import {
	createDefaultTrackSwitch,
	createTrackSwitch,
} from "./player/default-factory";

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

if (typeof window !== "undefined") {
	const targetWindow = window as Window & {
		TrackSwitch?: Record<string, unknown>;
	};
	targetWindow.TrackSwitch = {
		...(targetWindow.TrackSwitch ?? {}),
		...TrackSwitchDefault,
	};
}

export {
	createDefaultTrackSwitch,
	createTrackSwitch,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchPlayer,
};
