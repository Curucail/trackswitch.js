import type { MarkerLayerConfig, ResolvedMarkerSet } from "../domain/types";
import type { Marker, MarkerSet } from "../timeline/marker";
import type { ProjectionService } from "../timeline/projection";
import type { TimelineId } from "../timeline/timeline";
import type { MidiSeekSurfaceMetadata } from "./render-midi";

export interface MarkerPlacement {
	referenceTime: number;
	surfaceTime: number;
	duration: number;
}

export type SeekTimelineContextResolver = (seekWrap: HTMLElement) => {
	duration: number;
	fromReferenceTime(referenceTime: number): number;
};

export interface MarkerRenderData {
	markerSets: ReadonlyMap<string, ResolvedMarkerSet>;
	alignmentMarkerSet: MarkerSet | null;
	referenceTimeline: TimelineId;
	projection: ProjectionService | null;
	getSeekTimelineContext: SeekTimelineContextResolver;
	formatReferenceValue(value: number): string;
}

interface MarkerRendererContext {
	root: HTMLElement;
	waveformSeekSurfaces: Array<{ seekWrap: HTMLElement }>;
	midiSeekSurfaces: MidiSeekSurfaceMetadata[];
	getSeekMarkerLayers(seekWrap: HTMLElement): MarkerLayerConfig[];
}

function resolveMarkerReferenceTime(
	marker: Marker,
	data: MarkerRenderData,
): number | null {
	if (!data.projection) {
		// No alignment block: exactly one timeline exists, so whatever single
		// value the marker carries — regardless of the timeline id it's keyed
		// under — already is the reference-equivalent position.
		const values = Array.from(marker.placements.values());
		return values.length > 0 ? values[0] : null;
	}

	return data.projection.projectMarker(marker, data.referenceTimeline);
}

function resolvePlacement(
	referenceTime: number | null,
	timeline: {
		duration: number;
		fromReferenceTime(referenceTime: number): number;
	},
): MarkerPlacement | null {
	if (
		referenceTime === null ||
		!Number.isFinite(referenceTime) ||
		timeline.duration <= 0
	) {
		return null;
	}

	const surfaceTime = timeline.fromReferenceTime(referenceTime);
	if (surfaceTime < 0 || surfaceTime > timeline.duration) {
		return null;
	}

	return { referenceTime, surfaceTime, duration: timeline.duration };
}

function createMarkerAriaLabel(marker: Marker, referenceTime: string): string {
	const label = marker.label ? `, ${marker.label}` : "";
	return `Marker ${marker.id}${label}, ${referenceTime}`;
}

function renderMarkerLayer(
	seekWrap: HTMLElement,
	layer: MarkerLayerConfig,
	markers: Marker[],
	data: MarkerRenderData,
): void {
	const timeline = data.getSeekTimelineContext(seekWrap);

	const entries: Array<{ marker: Marker; placement: MarkerPlacement }> = [];
	markers.forEach((marker) => {
		const referenceTime = resolveMarkerReferenceTime(marker, data);
		const placement = resolvePlacement(referenceTime, timeline);
		if (placement) {
			entries.push({ marker, placement });
		}
	});

	if (entries.length === 0) {
		return;
	}

	entries.sort(
		(left, right) => left.placement.surfaceTime - right.placement.surfaceTime,
	);

	const layerElement = seekWrap.ownerDocument.createElement("div");
	layerElement.className = "timeline-marker-layer";
	layerElement.setAttribute("role", "group");
	layerElement.setAttribute("aria-label", "Timeline markers");
	layerElement.setAttribute("data-marker-set", layer.set);

	entries.forEach((entry, index) => {
		const button = seekWrap.ownerDocument.createElement("button");
		button.type = "button";
		button.className = `timeline-marker timeline-marker-${layer.line ?? "dashed"}`;
		button.tabIndex = index === 0 ? 0 : -1;
		const ariaLabel = createMarkerAriaLabel(
			entry.marker,
			data.formatReferenceValue(entry.placement.referenceTime),
		);
		button.setAttribute("aria-label", ariaLabel);
		button.title = ariaLabel;
		button.setAttribute("data-marker-id", entry.marker.id);
		button.setAttribute(
			"data-marker-reference-time",
			String(entry.placement.referenceTime),
		);
		button.setAttribute(
			"data-marker-surface-time",
			String(entry.placement.surfaceTime),
		);
		button.style.setProperty(
			"--ts-marker-position",
			`${(entry.placement.surfaceTime / entry.placement.duration) * 100}%`,
		);
		if (entry.placement.surfaceTime / entry.placement.duration >= 0.75) {
			button.classList.add("timeline-marker-label-before");
		}
		if (layer.color) {
			button.style.setProperty("--ts-marker-highlight-color", layer.color);
		}

		if (entry.marker.label) {
			const labelNode = seekWrap.ownerDocument.createElement("span");
			labelNode.className = "timeline-marker-label";
			labelNode.textContent = entry.marker.label;
			button.appendChild(labelNode);
		}

		layerElement.appendChild(button);
	});

	seekWrap.appendChild(layerElement);
}

function renderConfiguredLayers(
	ctx: MarkerRendererContext,
	seekWrap: HTMLElement,
	data: MarkerRenderData,
): void {
	seekWrap
		.querySelectorAll(":scope > .timeline-marker-layer")
		.forEach((existing) => {
			existing.remove();
		});

	const layers = ctx.getSeekMarkerLayers(seekWrap);
	layers.forEach((layer) => {
		if (layer.set === "alignment") {
			// Alignment sets never generate DOM — drawn on canvas via foldToReference.
			return;
		}

		const resolvedSet = data.markerSets.get(layer.set);
		if (!resolvedSet) {
			return;
		}

		renderMarkerLayer(seekWrap, layer, resolvedSet.markerSet.markers, data);
	});
}

export function renderTimelineMarkers(
	ctx: MarkerRendererContext,
	data: MarkerRenderData,
): void {
	ctx.waveformSeekSurfaces.forEach((surface) => {
		renderConfiguredLayers(ctx, surface.seekWrap, data);
	});

	ctx.midiSeekSurfaces.forEach((surface) => {
		renderConfiguredLayers(ctx, surface.seekWrap, data);
	});

	ctx.root
		.querySelectorAll(".seekable-img-wrap > .seekwrap")
		.forEach((candidate) => {
			if (candidate instanceof HTMLElement) {
				renderConfiguredLayers(ctx, candidate, data);
			}
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
