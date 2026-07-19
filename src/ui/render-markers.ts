import type {
	TrackMarker,
	TrackRuntime,
	WaveformSource,
} from "../domain/types";
import { formatSecondsToHHMMSSmmm } from "../shared/format";
import type { MidiSeekSurfaceMetadata } from "./render-midi";

export interface MarkerPlacement {
	referenceTime: number;
	surfaceTime: number;
	duration: number;
}

export type MarkerPlacementResolver = (
	seekWrap: HTMLElement,
	marker: TrackMarker,
) => MarkerPlacement | null;

interface MarkerRenderEntry {
	marker: TrackMarker;
	trackTitle: string;
	placement: MarkerPlacement;
}

interface MarkerRendererContext {
	root: HTMLElement;
	waveformSeekSurfaces: Array<{
		seekWrap: HTMLElement;
		waveformSource: WaveformSource;
	}>;
	midiSeekSurfaces: MidiSeekSurfaceMetadata[];
	getWaveformSourceRuntimes(
		runtimes: TrackRuntime[],
		waveformSource: WaveformSource,
	): TrackRuntime[];
}

function resolveTrackTitle(runtime: TrackRuntime, trackIndex: number): string {
	const configured = runtime.definition.title;
	return typeof configured === "string" && configured.trim().length > 0
		? configured.trim()
		: `Track ${trackIndex + 1}`;
}

function createMarkerAriaLabel(entry: MarkerRenderEntry): string {
	const markerLabel = entry.marker.label ? `, ${entry.marker.label}` : "";
	return `${entry.trackTitle}, marker ${entry.marker.id}${markerLabel}, ${formatSecondsToHHMMSSmmm(entry.marker.time)}`;
}

function renderMarkerLayer(
	seekWrap: HTMLElement,
	runtimes: TrackRuntime[],
	markerRuntimes: TrackRuntime[],
	resolvePlacement: MarkerPlacementResolver,
): void {
	seekWrap.querySelector(":scope > .timeline-marker-layer")?.remove();

	const entries: MarkerRenderEntry[] = [];
	markerRuntimes.forEach((runtime) => {
		const trackIndex = runtimes.indexOf(runtime);
		if (trackIndex < 0) {
			return;
		}

		const trackTitle = resolveTrackTitle(runtime, trackIndex);
		runtime.markers.forEach((marker) => {
			const placement = resolvePlacement(seekWrap, marker);
			if (
				!placement ||
				!Number.isFinite(placement.surfaceTime) ||
				!Number.isFinite(placement.duration) ||
				placement.duration <= 0 ||
				placement.surfaceTime < 0 ||
				placement.surfaceTime > placement.duration
			) {
				return;
			}

			entries.push({ marker: marker, trackTitle: trackTitle, placement });
		});
	});

	if (entries.length === 0) {
		return;
	}

	entries.sort((left, right) => {
		if (left.placement.surfaceTime !== right.placement.surfaceTime) {
			return left.placement.surfaceTime - right.placement.surfaceTime;
		}
		if (left.marker.trackIndex !== right.marker.trackIndex) {
			return left.marker.trackIndex - right.marker.trackIndex;
		}
		return left.marker.id - right.marker.id;
	});

	const layer = seekWrap.ownerDocument.createElement("div");
	layer.className = "timeline-marker-layer";
	layer.setAttribute("role", "group");
	layer.setAttribute("aria-label", "Timeline markers");

	entries.forEach((entry, index) => {
		const marker = seekWrap.ownerDocument.createElement("button");
		marker.type = "button";
		marker.className = `timeline-marker timeline-marker-${entry.marker.lineStyle}`;
		marker.tabIndex = index === 0 ? 0 : -1;
		marker.setAttribute("aria-label", createMarkerAriaLabel(entry));
		marker.title = createMarkerAriaLabel(entry);
		marker.setAttribute("data-marker-id", String(entry.marker.id));
		marker.setAttribute(
			"data-marker-track-index",
			String(entry.marker.trackIndex),
		);
		marker.setAttribute(
			"data-marker-reference-time",
			String(entry.placement.referenceTime),
		);
		marker.setAttribute(
			"data-marker-surface-time",
			String(entry.placement.surfaceTime),
		);
		marker.style.setProperty(
			"--ts-marker-position",
			`${(entry.placement.surfaceTime / entry.placement.duration) * 100}%`,
		);
		if (entry.placement.surfaceTime / entry.placement.duration >= 0.75) {
			marker.classList.add("timeline-marker-label-before");
		}
		marker.style.setProperty("--ts-marker-highlight-color", entry.marker.color);

		if (entry.marker.label.length > 0) {
			const label = seekWrap.ownerDocument.createElement("span");
			label.className = "timeline-marker-label";
			label.textContent = entry.marker.label;
			marker.appendChild(label);
		}

		layer.appendChild(marker);
	});

	seekWrap.prepend(layer);
}

export function renderTimelineMarkers(
	ctx: MarkerRendererContext,
	runtimes: TrackRuntime[],
	activeMarkerRuntimes: TrackRuntime[],
	resolvePlacement: MarkerPlacementResolver,
): void {
	ctx.waveformSeekSurfaces.forEach((surface) => {
		renderMarkerLayer(
			surface.seekWrap,
			runtimes,
			ctx.getWaveformSourceRuntimes(runtimes, surface.waveformSource),
			resolvePlacement,
		);
	});

	ctx.midiSeekSurfaces.forEach((surface) => {
		renderMarkerLayer(
			surface.seekWrap,
			runtimes,
			activeMarkerRuntimes,
			resolvePlacement,
		);
	});

	ctx.root
		.querySelectorAll(".seekable-img-wrap > .seekwrap[data-marker-image-scope]")
		.forEach((candidate) => {
			if (!(candidate instanceof HTMLElement)) {
				return;
			}

			const scope = candidate.getAttribute("data-marker-image-scope");
			let imageRuntimes = activeMarkerRuntimes;
			if (scope === "per-track") {
				const selected = runtimes.filter((runtime) => runtime.state.solo);
				imageRuntimes = selected.length === 1 ? selected : [];
			}

			renderMarkerLayer(candidate, runtimes, imageRuntimes, resolvePlacement);
		});
}

export function updateMarkerNavigationControls(
	root: HTMLElement,
	canGoPrevious: boolean,
	canGoNext: boolean,
): void {
	const updateButton = (selector: string, enabled: boolean): void => {
		const button = root.querySelector(selector);
		if (!(button instanceof HTMLButtonElement)) {
			return;
		}
		button.disabled = !enabled;
		button.setAttribute("aria-disabled", String(!enabled));
	};

	updateButton(".marker-previous", canGoPrevious);
	updateButton(".marker-next", canGoNext);
}
