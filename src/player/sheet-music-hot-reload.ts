import type {
	NormalizedTrackSwitchConfig,
	TrackSwitchSheetMusicViewConfig,
} from "../domain/types";
import type { SheetMusicEntryModel } from "../engine/sheet-music/types";
import type { TrackSwitchControllerImpl } from "./player-controller";

export interface SheetMusicViewIdentity {
	view: TrackSwitchSheetMusicViewConfig;
	source: string;
}

export function sheetMusicViewIdentitiesMatch(
	current: readonly SheetMusicViewIdentity[],
	next: readonly SheetMusicViewIdentity[],
): boolean {
	return (
		current.length === next.length &&
		current.every((identity, index) => {
			const candidate = next[index];
			return (
				candidate !== undefined &&
				sheetMusicViewIdentityKey(identity) ===
					sheetMusicViewIdentityKey(candidate)
			);
		})
	);
}

function sheetMusicViewIdentityKey(identity: SheetMusicViewIdentity): string {
	const { source, view } = identity;
	return JSON.stringify([
		source,
		view.mediaID,
		view.maxWidth ?? null,
		view.maxHeight ?? null,
		view.renderScale ?? null,
		view.followPlayback ?? null,
		view.css ?? null,
		view.cursorColor ?? null,
		view.cursorAlpha ?? null,
	]);
}

interface PreservedSheetMusicView {
	entry: SheetMusicEntryModel;
	wrapper: HTMLElement;
}

export interface PreservedSheetMusicViews {
	views: PreservedSheetMusicView[];
}

function nextSheetMusicViewIdentities(
	config: NormalizedTrackSwitchConfig,
): SheetMusicViewIdentity[] {
	const identities: SheetMusicViewIdentity[] = [];
	config.views.forEach((view) => {
		if (view.type !== "sheetMusic") {
			return;
		}
		const medium = config.media[view.mediaID];
		identities.push({
			view,
			source: medium?.type === "musicxml" ? medium.src : "",
		});
	});
	return identities;
}

/** Detaches unchanged score DOM before the renderer clears its managed root. */
export function detachPreservableSheetMusicViews(
	controller: TrackSwitchControllerImpl,
	config: NormalizedTrackSwitchConfig,
): PreservedSheetMusicViews | null {
	const entries = controller.sheetMusicEngine.entries;
	if (entries.length === 0 || entries.some((entry) => !entry.osmd)) {
		return null;
	}

	const currentIdentities: SheetMusicViewIdentity[] = [];
	const preservedViews: PreservedSheetMusicView[] = [];
	for (const entry of entries) {
		const definition = controller.renderer.getConfiguredViewHost(entry.host);
		if (definition.view.type !== "sheetMusic") {
			return null;
		}
		const wrapper = entry.host.closest(".sheetmusic-wrap");
		if (!(wrapper instanceof HTMLElement)) {
			return null;
		}
		currentIdentities.push({ view: definition.view, source: entry.source });
		preservedViews.push({ entry, wrapper });
	}

	if (
		!sheetMusicViewIdentitiesMatch(
			currentIdentities,
			nextSheetMusicViewIdentities(config),
		)
	) {
		return null;
	}

	preservedViews.forEach(({ wrapper }) => {
		wrapper.remove();
	});
	return { views: preservedViews };
}

/** Replaces newly rendered placeholders with the preserved score wrappers. */
export function restorePreservedSheetMusicViews(
	controller: TrackSwitchControllerImpl,
	preserved: PreservedSheetMusicViews,
): void {
	const placeholders = Array.from(
		controller.root.querySelectorAll<HTMLElement>(":scope > .sheetmusic"),
	);
	if (placeholders.length !== preserved.views.length) {
		throw new Error("Failed to restore preserved sheet-music views.");
	}

	preserved.views.forEach(({ entry, wrapper }, index) => {
		const placeholder = placeholders[index];
		const definition = controller.renderer.getConfiguredViewHost(placeholder);
		controller.renderer.registerConfiguredViewHost(entry.host, definition);
		placeholder.replaceWith(wrapper);
	});
}

/** Updates alignment-dependent host metadata without replacing OSMD instances. */
export function rebindPreservedSheetMusicViews(
	controller: TrackSwitchControllerImpl,
	preserved: PreservedSheetMusicViews,
): void {
	const hosts = controller.renderer.getPreparedSheetMusicHosts();
	if (hosts.length !== preserved.views.length) {
		throw new Error("Failed to rebind preserved sheet-music views.");
	}

	preserved.views.forEach(({ entry }, index) => {
		const host = hosts[index];
		if (host.host !== entry.host || host.source !== entry.source) {
			throw new Error("Preserved sheet-music host changed during hot reload.");
		}
		entry.scrollContainer = host.scrollContainer;
		entry.measureColumn = host.measureColumn;
		entry.renderScale = host.renderScale;
		entry.followPlayback = host.followPlayback;
		entry.cursorColor = host.cursorColor;
		entry.cursorAlpha = host.cursorAlpha;
	});
}
