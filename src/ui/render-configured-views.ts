import type { ViewNormalizeContext } from "../config/ui-elements";
import type {
	MediaId,
	TrackId,
	TrackSwitchImageViewConfig,
	TrackSwitchPerTrackImageViewConfig,
	TrackSwitchPianoRollViewConfig,
	TrackSwitchSeparatorViewConfig,
	TrackSwitchSheetMusicViewConfig,
	TrackSwitchTextViewConfig,
	TrackSwitchViewConfig,
	TrackSwitchWarpingMatrixViewConfig,
	TrackSwitchWaveformViewConfig,
} from "../domain/types";
import type { PerTrackImageSource } from "./view-renderer";

interface ConfiguredViewRenderer {
	root: HTMLElement;
	registerConfiguredViewHost(
		element: Element,
		definition: {
			view: TrackSwitchViewConfig;
			waveformSource?: "audible" | number | number[];
			alignmentTimeline?: string;
			source?: string;
		},
	): void;
	setPerTrackImageSources(sources: Map<TrackId, PerTrackImageSource>): void;
}

/**
 * Normalization resolves every dimension, so a missing one means an
 * unnormalized config reached the renderer rather than a value needing a default.
 */
function resolvedSize(value: number | undefined, label: string): number {
	if (value === undefined) {
		throw new Error(
			`Internal error: ${label} reached the renderer unresolved.`,
		);
	}

	return value;
}

function resolveWaveformTracksIndex(
	tracks: string[] | "audible" | undefined,
	ctx: ViewNormalizeContext,
): "audible" | number | number[] {
	if (!tracks || tracks === "audible") return "audible";
	const indexes = tracks.map((id) => ctx.trackIds.indexOf(id));
	return indexes.length === 1 ? indexes[0] : indexes;
}

// ═══════════ typed view rendering ═══════════

function renderWarpingMatrix(
	renderer: ConfiguredViewRenderer,
	warpingMatrix: TrackSwitchWarpingMatrixViewConfig,
): void {
	const container = document.createElement("div");
	container.className = "warping-matrix";
	if (warpingMatrix.height !== undefined) {
		container.setAttribute(
			"data-warping-matrix-height",
			String(warpingMatrix.height),
		);
	}
	if (warpingMatrix.tempoSmoothingSeconds !== undefined) {
		container.setAttribute(
			"data-warping-matrix-tempo-smoothing-seconds",
			String(warpingMatrix.tempoSmoothingSeconds),
		);
	}
	container.setAttribute("data-warping-matrix-x", warpingMatrix.x);
	container.setAttribute("data-warping-matrix-y", warpingMatrix.y);
	renderer.registerConfiguredViewHost(container, { view: warpingMatrix });
	renderer.root.appendChild(container);
}

function renderTrackList(root: HTMLElement, groupIndex: number): void {
	const container = document.createElement("div");
	container.className = "track-group ts-stack-section";
	container.setAttribute("data-track-group-index", String(groupIndex));
	root.appendChild(container);
}

function renderNavigationBar(root: HTMLElement): void {
	const container = document.createElement("div");
	container.className = "navigation-bar-host";
	root.appendChild(container);
}

function renderText(
	renderer: ConfiguredViewRenderer,
	text: TrackSwitchTextViewConfig,
): void {
	const container = document.createElement("div");
	container.className = "ts-text";
	container.textContent = text.text;
	renderer.registerConfiguredViewHost(container, { view: text });
	renderer.root.appendChild(container);
}

function renderSeparator(
	root: HTMLElement,
	separator: TrackSwitchSeparatorViewConfig,
): void {
	const container = document.createElement("div");
	container.className = "ts-separator ts-stack-section";
	container.style.setProperty(
		"--ts-separator-thickness",
		`${String(resolvedSize(separator.thickness, "separator.thickness"))}px`,
	);
	root.appendChild(container);
}

function renderImage(
	renderer: ConfiguredViewRenderer,
	image: TrackSwitchImageViewConfig,
	ctx: ViewNormalizeContext,
): void {
	const entry = ctx.media[image.mediaID];
	const source = entry && "src" in entry ? entry.src : undefined;
	const imageElement = createImageElement(image);
	imageElement.src = source ?? "";
	renderer.registerConfiguredViewHost(imageElement, {
		view: image,
		alignmentTimeline: resolveAlignmentTimelineAttribute(image.mediaID, ctx),
		source,
	});
	renderer.root.appendChild(imageElement);
}

function renderPerTrackImage(
	renderer: ConfiguredViewRenderer,
	image: TrackSwitchPerTrackImageViewConfig,
	ctx: ViewNormalizeContext,
): void {
	renderer.setPerTrackImageSources(collectPerTrackImageSources(ctx));
	const imageElement = createImageElement(image);
	imageElement.classList.add("per-track-image");
	imageElement.setAttribute("data-per-track-image", "true");
	imageElement.style.display = "none";
	renderer.registerConfiguredViewHost(imageElement, { view: image });
	renderer.root.appendChild(imageElement);
}

/**
 * The image medium each track shows when soloed, resolved to what the swap
 * needs: the file to display and the alignment column it is placed on.
 */
function collectPerTrackImageSources(
	ctx: ViewNormalizeContext,
): Map<TrackId, PerTrackImageSource> {
	const sources = new Map<TrackId, PerTrackImageSource>();
	Object.entries(ctx.media).forEach(([trackId, entry]) => {
		if (entry.type !== "audio" || !entry.imageID) {
			return;
		}
		const imageEntry = ctx.media[entry.imageID];
		if (imageEntry?.type !== "image") {
			return;
		}
		sources.set(trackId, {
			src: imageEntry.src,
			alignmentTimeline: resolveAlignmentTimelineAttribute(entry.imageID, ctx),
		});
	});
	return sources;
}

function createImageElement(
	image: Pick<
		TrackSwitchImageViewConfig,
		"seekable" | "css" | "seekMarginLeft" | "seekMarginRight" | "markerLayers"
	>,
): HTMLImageElement {
	const imageElement = document.createElement("img");

	if (image.seekable) {
		imageElement.classList.add("seekable");
	}
	return imageElement;
}

function renderWaveform(
	renderer: ConfiguredViewRenderer,
	waveform: TrackSwitchWaveformViewConfig,
	ctx: ViewNormalizeContext,
): void {
	const sourceIndex = resolveWaveformTracksIndex(waveform.tracks, ctx);
	const canvas = document.createElement("canvas");
	canvas.className = "waveform";
	canvas.width = 1200;
	canvas.height = resolvedSize(waveform.height, "waveform.height");
	renderer.registerConfiguredViewHost(canvas, {
		view: waveform,
		waveformSource: sourceIndex,
		alignmentTimeline: ctx.hasAlignment ? "individual" : "shared",
	});
	renderer.root.appendChild(canvas);
}

function resolveAlignmentTimelineAttribute(
	mediaID: MediaId,
	ctx: ViewNormalizeContext,
): string {
	return ctx.hasAlignment && ctx.alignmentTimelines.has(mediaID) ? mediaID : "";
}

function renderPianoRoll(
	renderer: ConfiguredViewRenderer,
	pianoRoll: TrackSwitchPianoRollViewConfig,
	ctx: ViewNormalizeContext,
): void {
	const canvas = document.createElement("canvas");
	canvas.className = "piano-roll";
	canvas.width = 1200;
	canvas.height = resolvedSize(pianoRoll.height, "pianoRoll.height");
	renderer.registerConfiguredViewHost(canvas, {
		view: pianoRoll,
		alignmentTimeline: resolveAlignmentTimelineAttribute(
			pianoRoll.mediaID,
			ctx,
		),
		source: ctx.media[pianoRoll.mediaID]?.src,
	});
	renderer.root.appendChild(canvas);
}

function renderSheetMusic(
	renderer: ConfiguredViewRenderer,
	sheetmusic: TrackSwitchSheetMusicViewConfig,
	ctx: ViewNormalizeContext,
): void {
	const entry = ctx.media[sheetmusic.mediaID];
	const container = document.createElement("div");
	container.className = "sheetmusic";
	renderer.registerConfiguredViewHost(container, {
		view: sheetmusic,
		alignmentTimeline: resolveAlignmentTimelineAttribute(
			sheetmusic.mediaID,
			ctx,
		),
		source: entry && "src" in entry ? entry.src : undefined,
	});
	renderer.root.appendChild(container);
}

export function renderConfiguredViews(
	renderer: ConfiguredViewRenderer,
	views: TrackSwitchViewConfig[],
	ctx: ViewNormalizeContext,
): void {
	let trackGroupIndex = 0;
	views.forEach((entry) => {
		if (entry.type === "trackList") {
			renderTrackList(renderer.root, trackGroupIndex);
			trackGroupIndex += 1;
			return;
		}
		if (entry.type === "navigationBar") {
			renderNavigationBar(renderer.root);
			return;
		}
		if (entry.type === "image") {
			renderImage(renderer, entry, ctx);
			return;
		}
		if (entry.type === "text") {
			renderText(renderer, entry);
			return;
		}
		if (entry.type === "separator") {
			renderSeparator(renderer.root, entry);
			return;
		}
		if (entry.type === "perTrackImage") {
			renderPerTrackImage(renderer, entry, ctx);
			return;
		}
		if (entry.type === "waveform") {
			renderWaveform(renderer, entry, ctx);
			return;
		}
		if (entry.type === "pianoRoll") {
			renderPianoRoll(renderer, entry, ctx);
			return;
		}
		if (entry.type === "sheetMusic") {
			renderSheetMusic(renderer, entry, ctx);
			return;
		}
		if (entry.type === "warpingMatrix") {
			renderWarpingMatrix(renderer, entry);
			return;
		}
		throw new Error(
			`Invalid view type: ${String((entry as { type?: unknown }).type)}`,
		);
	});
}
