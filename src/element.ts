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

import { defineTrackswitchDefaultElement, type TrackswitchPlayer } from "./default-element";

export function defineTrackswitchElements(
	registry: CustomElementRegistry = customElements,
): {
	default: typeof TrackswitchPlayer;
} {
	return {
		default: defineTrackswitchDefaultElement(registry),
	};
}
