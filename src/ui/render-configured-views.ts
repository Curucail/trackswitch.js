import type {
	MediaId,
	TrackSwitchImageViewConfig,
	TrackSwitchMidiViewConfig,
	TrackSwitchPerTrackImageViewConfig,
	TrackSwitchSheetMusicViewConfig,
	TrackSwitchTextViewConfig,
	TrackSwitchViewConfig,
	TrackSwitchWarpingMatrixViewConfig,
	TrackSwitchWaveformViewConfig,
} from "../domain/types";
import type { ViewNormalizeContext } from "../config/ui-elements";

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
}

function toCanvasSize(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.round(value)
		: fallback;
}

function resolveSourceTracksIndex(
	sourceTracks: string[] | "audible" | undefined,
	ctx: ViewNormalizeContext,
): "audible" | number | number[] {
	if (!sourceTracks || sourceTracks === "audible") return "audible";
	const indexes = sourceTracks.map((id) => ctx.trackIds.indexOf(id));
	return indexes.length === 1 ? indexes[0] : indexes;
}

// ═══════════ typed view rendering ═══════════

function renderWarpingMatrix(
	renderer: ConfiguredViewRenderer,
	warpingMatrix: TrackSwitchWarpingMatrixViewConfig,
): void {
	const container = document.createElement("div");
	container.className = "warping-matrix";
	if (warpingMatrix.style) {
		container.setAttribute("data-warping-matrix-style", warpingMatrix.style);
	}
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

function renderImage(
	renderer: ConfiguredViewRenderer,
	image: TrackSwitchImageViewConfig,
): void {
	const imageElement = createImageElement(image);
	imageElement.src = image.src;
	renderer.registerConfiguredViewHost(imageElement, { view: image });
	renderer.root.appendChild(imageElement);
}

function renderPerTrackImage(
	renderer: ConfiguredViewRenderer,
	image: TrackSwitchPerTrackImageViewConfig,
): void {
	const imageElement = createImageElement(image);
	imageElement.classList.add("per-track-image");
	imageElement.setAttribute("data-per-track-image", "true");
	imageElement.style.display = "none";
	renderer.registerConfiguredViewHost(imageElement, { view: image });
	renderer.root.appendChild(imageElement);
}

function createImageElement(
	image: Pick<
		TrackSwitchImageViewConfig,
		"seekable" | "style" | "seekMarginLeft" | "seekMarginRight" | "markerLayers"
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
	const sourceIndex = resolveSourceTracksIndex(waveform.sourceTracks, ctx);
	const canvas = document.createElement("canvas");
	canvas.className = "waveform";
	canvas.width = 1200;
	canvas.height = toCanvasSize(waveform.height, 150);
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

function renderMidi(
	renderer: ConfiguredViewRenderer,
	midi: TrackSwitchMidiViewConfig,
	ctx: ViewNormalizeContext,
): void {
	const canvas = document.createElement("canvas");
	canvas.className = "midi";
	canvas.width = 1200;
	canvas.height = toCanvasSize(midi.height, 180);
	renderer.registerConfiguredViewHost(canvas, {
		view: midi,
		alignmentTimeline: resolveAlignmentTimelineAttribute(midi.mediaID, ctx),
		source: ctx.media[midi.mediaID]?.src,
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
			renderImage(renderer, entry);
			return;
		}
		if (entry.type === "text") {
			renderText(renderer, entry);
			return;
		}
		if (entry.type === "perTrackImage") {
			renderPerTrackImage(renderer, entry);
			return;
		}
		if (entry.type === "waveform") {
			renderWaveform(renderer, entry, ctx);
			return;
		}
		if (entry.type === "midi") {
			renderMidi(renderer, entry, ctx);
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
