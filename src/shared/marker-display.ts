import type { MarkerLayerConfig } from "../domain/types";

const MARKER_LAYERS_ATTRIBUTE = "data-marker-layers";

export function setMarkerLayersAttribute(
	element: HTMLElement,
	layers: MarkerLayerConfig[] | undefined,
): void {
	if (!layers || layers.length === 0) {
		return;
	}

	element.setAttribute(MARKER_LAYERS_ATTRIBUTE, JSON.stringify(layers));
}

export function copyMarkerDisplayAttributes(
	source: HTMLElement,
	target: HTMLElement,
): void {
	const value = source.getAttribute(MARKER_LAYERS_ATTRIBUTE);
	if (value !== null) {
		target.setAttribute(MARKER_LAYERS_ATTRIBUTE, value);
	}
}

export function readMarkerLayersAttribute(
	element: HTMLElement,
): MarkerLayerConfig[] {
	const raw = element.getAttribute(MARKER_LAYERS_ATTRIBUTE);
	if (!raw) {
		return [];
	}

	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as MarkerLayerConfig[]) : [];
	} catch (_error) {
		return [];
	}
}
