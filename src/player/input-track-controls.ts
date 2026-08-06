import { eventTargetAsElement } from "../shared/dom";
import type { ControllerPointerEvent } from "../shared/seek";
import type { TrackSwitchControllerImpl } from "./player-controller";

export function toggleSoloFromPointerEvent(
	controller: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): void {
	const groupIndexFromTarget = controller.trackGroupIndexFromTarget(
		event.target ?? null,
	);

	// The row above an aligned list selects the list itself — the first level of
	// the hierarchy, where its tracks count as one timeline.
	const target = eventTargetAsElement(event.target ?? null);
	if (target?.closest(".track-list-select") && groupIndexFromTarget >= 0) {
		controller.selectTrackListUnit(groupIndexFromTarget);
		return;
	}

	const index = controller.trackIndexFromTarget(event.target ?? null);
	if (index < 0) {
		return;
	}

	const groupIndex =
		groupIndexFromTarget >= 0
			? groupIndexFromTarget
			: controller.groupIndexForTrack(index);

	// Shift-clicking the last remaining selection of an ordinary list brings the
	// whole list back, which is the quickest way out of a narrowed-down comparison.
	if (
		event.shiftKey &&
		!controller.isGroupExclusive(groupIndex) &&
		controller.runtimes[index]?.state.solo
	) {
		const trackIndexes = controller.trackIndexesInGroup(groupIndex);
		const selectedCount = trackIndexes.reduce(
			(count: number, trackIndex: number) =>
				count + (controller.runtimes[trackIndex].state.solo ? 1 : 0),
			0,
		);

		if (selectedCount === 1) {
			trackIndexes.forEach((trackIndex: number) => {
				controller.runtimes[trackIndex].state.solo = true;
			});
			controller.applyTrackProperties();
			controller.updateMainControls();
			return;
		}
	}

	controller.toggleSolo(index, !!event.shiftKey, groupIndex);
}

export function parseSliderValue(target: HTMLInputElement): number {
	return parseFloat(target.value || "0") / 100;
}

export function getTrackInputTarget(
	controller: TrackSwitchControllerImpl,
	event: ControllerPointerEvent,
): { target: HTMLInputElement; trackIndex: number } | null {
	const target = eventTargetAsElement(event.target ?? null);
	if (!(target instanceof HTMLInputElement)) {
		return null;
	}

	const trackIndex = controller.trackIndexFromTarget(target);
	if (trackIndex < 0) {
		return null;
	}

	return {
		target,
		trackIndex,
	};
}
