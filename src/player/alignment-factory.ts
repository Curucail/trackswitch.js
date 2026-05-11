import { normalizeInit } from "../config/normalize-init";
import type { TrackSwitchController, TrackSwitchInit } from "../domain/types";
import { AlignmentTrackSwitchControllerImpl } from "./alignment-player-controller";

export function createAlignmentTrackSwitch(
	rootElement: HTMLElement,
	init: TrackSwitchInit,
): TrackSwitchController {
	return new AlignmentTrackSwitchControllerImpl(
		rootElement,
		normalizeInit(rootElement, init, { variant: "alignment" }),
	);
}
