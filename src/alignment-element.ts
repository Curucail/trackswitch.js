import { TrackswitchPlayerBase } from "./default-element";
import type { TrackSwitchController, TrackSwitchInit } from "./domain/types";
import { createAlignmentTrackSwitch } from "./player/alignment-factory";

export const TRACKSWITCH_ALIGNMENT_ELEMENT_NAME =
	"trackswitch-alignment-player";

export class TrackswitchAlignmentPlayer extends TrackswitchPlayerBase {
	protected createController(
		rootElement: HTMLElement,
		init: TrackSwitchInit,
	): TrackSwitchController {
		return createAlignmentTrackSwitch(rootElement, init);
	}
}

function defineTrackswitchElementWithConstructor<
	T extends CustomElementConstructor,
>(
	registry: CustomElementRegistry,
	elementName: string,
	elementConstructor: T,
): T {
	const existingConstructor = registry.get(elementName);
	if (existingConstructor) {
		return existingConstructor as T;
	}

	registry.define(elementName, elementConstructor);
	return elementConstructor;
}

export function defineTrackswitchAlignmentElement(
	registry: CustomElementRegistry = customElements,
): typeof TrackswitchAlignmentPlayer {
	return defineTrackswitchElementWithConstructor(
		registry,
		TRACKSWITCH_ALIGNMENT_ELEMENT_NAME,
		TrackswitchAlignmentPlayer,
	);
}

declare global {
	interface HTMLElementTagNameMap {
		[TRACKSWITCH_ALIGNMENT_ELEMENT_NAME]: TrackswitchAlignmentPlayer;
	}
}
