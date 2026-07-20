import type { TrackMarkerDisplayConfig } from "../domain/types";

const markerDisplayAttributes = [
	"data-timeline-markers",
	"data-marker-color",
	"data-marker-line-style",
] as const;

export function setMarkerDisplayAttributes(
	element: HTMLElement,
	config: TrackMarkerDisplayConfig | undefined,
): void {
	if (!config) {
		return;
	}

	element.setAttribute("data-timeline-markers", "true");
	element.setAttribute("data-marker-color", String(config.color));
	element.setAttribute("data-marker-line-style", String(config.lineStyle));
}

export function copyMarkerDisplayAttributes(
	source: HTMLElement,
	target: HTMLElement,
): void {
	markerDisplayAttributes.forEach((attribute) => {
		const value = source.getAttribute(attribute);
		if (value !== null) {
			target.setAttribute(attribute, value);
		}
	});
}

export function readMarkerDisplayConfig(
	element: HTMLElement,
): Required<TrackMarkerDisplayConfig> | null {
	if (element.getAttribute("data-timeline-markers") !== "true") {
		return null;
	}

	return {
		color: element.getAttribute("data-marker-color") as string,
		lineStyle: element.getAttribute(
			"data-marker-line-style",
		) as Required<TrackMarkerDisplayConfig>["lineStyle"],
	};
}
