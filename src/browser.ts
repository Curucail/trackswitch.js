import {
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchPlayer,
} from "./element";
import {
	defineTrackSwitchSyncInteractiveElement,
	TRACKSWITCH_SYNC_INTERACTIVE_ELEMENT_NAME,
	TrackswitchSyncInteractive,
} from "./interactive/interactive-element";
import {
	createInteractiveTrackSwitch,
	createTrackSwitchSyncInteractive,
} from "./interactive/interactive-factory";
import { createTrackSwitch } from "./player/factory";

defineTrackswitchElements();
defineTrackSwitchSyncInteractiveElement();

const TrackSwitch = {
	TrackswitchSyncInteractive,
	TrackswitchPlayer,
	TRACKSWITCH_SYNC_INTERACTIVE_ELEMENT_NAME,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	createTrackSwitchSyncInteractive,
	createInteractiveTrackSwitch,
	createTrackSwitch,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	defineTrackSwitchSyncInteractiveElement,
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
	createInteractiveTrackSwitch,
	createTrackSwitch,
	createTrackSwitchSyncInteractive,
	defineTrackSwitchSyncInteractiveElement,
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	defineTrackswitchElements,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_ELEMENT_NAME,
	TRACKSWITCH_SYNC_INTERACTIVE_ELEMENT_NAME,
	TrackswitchPlayer,
	TrackswitchSyncInteractive,
};
