export {
	defineTrackswitchAlignmentElement,
	TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
	TrackswitchAlignmentPlayer,
} from "./alignment-element";
export type {
	TrackswitchDomEventName,
	TrackswitchPlayerElement,
} from "./default-element";
export {
	defineTrackswitchDefaultElement,
	defineTrackswitchElement,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TRACKSWITCH_DOM_EVENTS,
	TRACKSWITCH_ELEMENT_NAME,
	TrackswitchPlayer,
} from "./default-element";

import {
	defineTrackswitchAlignmentElement,
	type TrackswitchAlignmentPlayer,
} from "./alignment-element";
import {
	defineTrackswitchDefaultElement,
	type TrackswitchPlayer,
} from "./default-element";

export function defineTrackswitchElements(
	registry: CustomElementRegistry = customElements,
): {
	default: typeof TrackswitchPlayer;
	alignment: typeof TrackswitchAlignmentPlayer;
} {
	return {
		default: defineTrackswitchDefaultElement(registry),
		alignment: defineTrackswitchAlignmentElement(registry),
	};
}
