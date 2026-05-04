export {
    TRACKSWITCH_DEFAULT_ELEMENT_NAME,
    TRACKSWITCH_ELEMENT_NAME,
    TRACKSWITCH_DOM_EVENTS,
    TrackswitchPlayer,
    defineTrackswitchDefaultElement,
    defineTrackswitchElement,
} from './default-element';
export type {
    TrackswitchDomEventName,
    TrackswitchPlayerElement,
} from './default-element';
export {
    TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
    TrackswitchAlignmentPlayer,
    defineTrackswitchAlignmentElement,
} from './alignment-element';

import {
    TrackswitchPlayer,
    defineTrackswitchDefaultElement,
} from './default-element';
import {
    TrackswitchAlignmentPlayer,
    defineTrackswitchAlignmentElement,
} from './alignment-element';

export function defineTrackswitchElements(
    registry: CustomElementRegistry = customElements
): {
    default: typeof TrackswitchPlayer;
    alignment: typeof TrackswitchAlignmentPlayer;
} {
    return {
        default: defineTrackswitchDefaultElement(registry),
        alignment: defineTrackswitchAlignmentElement(registry),
    };
}
