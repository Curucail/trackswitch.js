import type { TrackId } from "../domain/types";
import type { TrackSwitchControllerImpl } from "./player-controller";

/**
 * How a selection is scoped right now.
 *
 * - `lists` — every `trackList` decides for itself, the plain multitrack player.
 * - `alignment` — each timeline sits at its own audible position, so the whole
 *   player resolves to one *solo unit* (see `soloUnits`) at a time.
 * - `free` — nothing is exclusive; global sync runs every track on a shared
 *   clock, so they may all sound at once.
 */
export type SoloMode = "lists" | "alignment" | "free";

/**
 * One selectable timeline of the alignment hierarchy's first level: a single
 * track of a list with a `soloGroup`, or a whole list that declares none — those
 * tracks share one timeline and mix freely on the second level.
 */
export interface SoloUnit {
	groupIndex: number;
	trackIndexes: number[];
	/** Whether the unit is the list as a whole rather than one of its rows. */
	wholeList: boolean;
}

export function soloUnits(ctx: TrackSwitchControllerImpl): SoloUnit[] {
	if (ctx.soloMode !== "alignment") {
		return [];
	}

	const units: SoloUnit[] = [];
	ctx.trackGroups.forEach((group) => {
		const trackIndexes = ctx.trackIndexesInGroup(group.groupIndex);
		if (trackIndexes.length === 0) {
			return;
		}

		if (group.exclusiveSolo) {
			trackIndexes.forEach((trackIndex) => {
				units.push({
					groupIndex: group.groupIndex,
					trackIndexes: [trackIndex],
					wholeList: false,
				});
			});
			return;
		}

		units.push({
			groupIndex: group.groupIndex,
			trackIndexes: trackIndexes,
			wholeList: true,
		});
	});

	return units;
}

function isUnitActive(ctx: TrackSwitchControllerImpl, unit: SoloUnit): boolean {
	return unit.trackIndexes.some(
		(trackIndex) => ctx.runtimes[trackIndex].state.solo,
	);
}

/** The unit that currently sounds, or -1 while nothing is selected. */
export function activeSoloUnitIndex(ctx: TrackSwitchControllerImpl): number {
	return soloUnits(ctx).findIndex((unit) => isUnitActive(ctx, unit));
}

export function isTrackListUnitActive(
	ctx: TrackSwitchControllerImpl,
	groupIndex: number,
): boolean {
	return ctx
		.trackIndexesInGroup(groupIndex)
		.some((trackIndex) => ctx.runtimes[trackIndex].state.solo);
}

/**
 * A whole-list unit keeps the mix it was left with, so switching timelines and
 * coming back does not throw the listener's stem selection away.
 */
function rememberTrackListSelection(
	ctx: TrackSwitchControllerImpl,
	groupIndex: number,
): void {
	const selected: TrackId[] = ctx
		.trackIndexesInGroup(groupIndex)
		.filter((trackIndex) => ctx.runtimes[trackIndex].state.solo)
		.map((trackIndex) => ctx.runtimes[trackIndex].definition.id);

	if (selected.length > 0) {
		ctx.trackListSoloMemory.set(groupIndex, selected);
	}
}

/**
 * Brings a whole-list unit back: its remembered mix, or all of its tracks the
 * first time around. `focusTrackIndex` is the row that asked for the switch and
 * always ends up audible.
 */
function restoreTrackListSelection(
	ctx: TrackSwitchControllerImpl,
	groupIndex: number,
	focusTrackIndex: number | null,
): void {
	const trackIndexes = ctx.trackIndexesInGroup(groupIndex);
	const remembered = ctx.trackListSoloMemory.get(groupIndex) ?? [];
	const rememberedIndexes = trackIndexes.filter((trackIndex) =>
		remembered.includes(ctx.runtimes[trackIndex].definition.id),
	);
	const selection =
		rememberedIndexes.length > 0 ? rememberedIndexes : trackIndexes;

	trackIndexes.forEach((trackIndex) => {
		ctx.runtimes[trackIndex].state.solo =
			selection.includes(trackIndex) || trackIndex === focusTrackIndex;
	});
}

/** Silences every unit the predicate rejects, remembering what it had selected. */
function muteUnitsExcept(
	ctx: TrackSwitchControllerImpl,
	keep: (unit: SoloUnit) => boolean,
): void {
	soloUnits(ctx).forEach((unit) => {
		if (keep(unit)) {
			return;
		}

		if (unit.wholeList) {
			rememberTrackListSelection(ctx, unit.groupIndex);
		}

		unit.trackIndexes.forEach((trackIndex) => {
			ctx.runtimes[trackIndex].state.solo = false;
		});
	});
}

/**
 * The alignment reading of a solo click. Level one picks the unit the clicked
 * row belongs to; level two toggles the row inside an already selected list,
 * where the last remaining selection stays put — the selected audio supplies
 * the physical playback clock.
 */
export function toggleSoloWithinAlignment(
	ctx: TrackSwitchControllerImpl,
	trackIndex: number,
	groupIndex: number,
	exclusive: boolean,
): void {
	const group = ctx.trackGroups[groupIndex];
	if (!group || exclusive || group.exclusiveSolo) {
		muteUnitsExcept(ctx, () => false);
		ctx.runtimes[trackIndex].state.solo = true;
		return;
	}

	const wasActive = isTrackListUnitActive(ctx, groupIndex);
	muteUnitsExcept(ctx, (unit) => unit.groupIndex === groupIndex);

	if (!wasActive) {
		restoreTrackListSelection(ctx, groupIndex, trackIndex);
		return;
	}

	const runtime = ctx.runtimes[trackIndex];
	const soloedCount = ctx
		.trackIndexesInGroup(groupIndex)
		.filter((index) => ctx.runtimes[index].state.solo).length;
	if (runtime.state.solo && soloedCount <= 1) {
		return;
	}

	runtime.state.solo = !runtime.state.solo;
}

/** Level one for a whole-list unit — the row that selects the list itself. */
export function selectTrackListUnit(
	ctx: TrackSwitchControllerImpl,
	groupIndex: number,
): void {
	const group = ctx.trackGroups[groupIndex];
	if (
		ctx.soloMode !== "alignment" ||
		!group ||
		group.exclusiveSolo ||
		isTrackListUnitActive(ctx, groupIndex)
	) {
		return;
	}

	const previousUnitIndex = activeSoloUnitIndex(ctx);
	muteUnitsExcept(ctx, (unit) => unit.groupIndex === groupIndex);
	restoreTrackListSelection(ctx, groupIndex, null);

	ctx.applyTrackProperties();
	ctx.finishSoloUnitSwitch(previousUnitIndex);
}

/**
 * Narrows the current solo states down to a single selection of the active mode.
 * A mode change or a preset can leave several timelines selected at once, which
 * alignment cannot play.
 */
export function collapseToSingleSelection(
	ctx: TrackSwitchControllerImpl,
): void {
	if (ctx.soloMode === "free") {
		return;
	}

	if (ctx.soloMode === "lists") {
		const collapsed = new Set<number>();
		ctx.trackGroups.forEach((group) => {
			const soloGroup = group.soloGroup;
			if (soloGroup === null || collapsed.has(soloGroup)) {
				return;
			}
			collapsed.add(soloGroup);

			// Lists sharing a soloGroup are one selection, so they collapse together.
			const trackIndexes = ctx.trackIndexesInSoloScope(group.groupIndex);
			if (trackIndexes.length === 0) {
				return;
			}

			const selectedIndex = trackIndexes.find(
				(trackIndex) => ctx.runtimes[trackIndex].state.solo,
			);
			const targetIndex = selectedIndex ?? trackIndexes[0];
			trackIndexes.forEach((trackIndex) => {
				ctx.runtimes[trackIndex].state.solo = trackIndex === targetIndex;
			});
		});
		return;
	}

	const units = soloUnits(ctx);
	if (units.length === 0) {
		return;
	}

	const activeIndex = units.findIndex((unit) => isUnitActive(ctx, unit));
	const unit = units[activeIndex >= 0 ? activeIndex : 0];
	muteUnitsExcept(ctx, (candidate) => candidate === unit);

	if (!unit.wholeList) {
		ctx.runtimes[unit.trackIndexes[0]].state.solo = true;
		return;
	}

	if (!isTrackListUnitActive(ctx, unit.groupIndex)) {
		restoreTrackListSelection(ctx, unit.groupIndex, null);
	}
}
