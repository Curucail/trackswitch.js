import type { WaveformPlaybackFollowMode } from "../domain/types";

export const MIN_TIMELINE_ZOOM = 1;

export interface TimelineSurfaceGeometry {
	scrollContainer: HTMLElement;
	surface: HTMLElement;
	baseWidth: number;
	zoom: number;
	zoomMinimapNode: HTMLElement;
	/**
	 * Last known `scrollContainer.clientWidth`. Reading it live during playback
	 * forces a synchronous layout on every tick, so the per-frame paths read this
	 * cache instead. Refreshed whenever the surface is reflowed or resized.
	 */
	cachedViewportWidth?: number;
}

export interface TimelineViewportState {
	startRatio: number;
	widthRatio: number;
}

/** Visible slice of a virtual surface that a sliding tile canvas has to cover. */
export interface TimelineTileWindow {
	tileStartPx: number;
	tileCssWidth: number;
	tileCssHeight: number;
	surfaceWidth: number;
	viewportWidth: number;
}

export function clampTimelineValue(
	value: number,
	minimum: number,
	maximum: number,
): number {
	if (!Number.isFinite(value)) {
		return minimum;
	}

	if (value < minimum) {
		return minimum;
	}

	if (value > maximum) {
		return maximum;
	}

	return value;
}

export function sanitizeTimelineDuration(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}

	return value;
}

export function getTimelineSurfaceWidth(
	surface: Pick<TimelineSurfaceGeometry, "baseWidth" | "zoom">,
): number {
	return Math.max(1, Math.round(surface.baseWidth * surface.zoom));
}

/**
 * Reads the scroll viewport width from the cache when it has been primed, so
 * per-frame callers never trigger a layout flush. `refreshTimelineViewportWidth`
 * repopulates it whenever geometry actually changes.
 */
function getTimelineViewportWidth(surface: TimelineSurfaceGeometry): number {
	const cached = surface.cachedViewportWidth;
	if (Number.isFinite(cached) && (cached as number) > 0) {
		return cached as number;
	}

	return refreshTimelineViewportWidth(surface);
}

export function refreshTimelineViewportWidth(
	surface: TimelineSurfaceGeometry,
): number {
	const viewportWidth = Math.max(1, surface.scrollContainer.clientWidth);
	surface.cachedViewportWidth = viewportWidth;
	return viewportWidth;
}

export function getTimelineViewportState(
	surface: TimelineSurfaceGeometry,
): TimelineViewportState {
	const surfaceWidth = getTimelineSurfaceWidth(surface);
	const viewportWidth = getTimelineViewportWidth(surface);
	const widthRatio = clampTimelineValue(viewportWidth / surfaceWidth, 0, 1);
	const maxStartRatio = Math.max(0, 1 - widthRatio);
	const startRatio = clampTimelineValue(
		surface.scrollContainer.scrollLeft / surfaceWidth,
		0,
		maxStartRatio,
	);
	return { startRatio, widthRatio };
}

export function updateTimelineMinimapViewport(
	surface: TimelineSurfaceGeometry,
): void {
	const minimapWidth = Math.max(1, surface.zoomMinimapNode.clientWidth);
	const viewportState = getTimelineViewportState(surface);
	surface.zoomMinimapNode.style.setProperty(
		"--ts-zoom-viewport-left",
		`${viewportState.startRatio * minimapWidth}px`,
	);
	surface.zoomMinimapNode.style.setProperty(
		"--ts-zoom-viewport-width",
		`${Math.max(0, viewportState.widthRatio * minimapWidth)}px`,
	);
}

export function resolveTimelineBaseWidth(
	scrollContainer: HTMLElement,
	fallback: number,
): number {
	const scrollWidth = scrollContainer.clientWidth;
	if (Number.isFinite(scrollWidth) && scrollWidth > 0) {
		return Math.max(1, Math.round(scrollWidth));
	}

	if (Number.isFinite(fallback) && fallback > 0) {
		return Math.max(1, Math.round(fallback));
	}

	return 1;
}

export function getTimelineMaximumZoom(
	durationSeconds: number,
	maxZoomSeconds: number,
): number {
	const safeDuration = sanitizeTimelineDuration(durationSeconds);
	if (safeDuration <= 0 || maxZoomSeconds <= 0) {
		return MIN_TIMELINE_ZOOM;
	}

	return Math.max(MIN_TIMELINE_ZOOM, safeDuration / maxZoomSeconds);
}

export function setTimelineZoomForSurface<T extends TimelineSurfaceGeometry>(
	surface: T,
	zoom: number,
	maximum: number,
	anchorPageX: number | undefined,
	applySurfaceWidth: (surface: T, width: number) => void,
): boolean {
	const nextZoom = clampTimelineValue(
		Number.isFinite(zoom) ? zoom : MIN_TIMELINE_ZOOM,
		MIN_TIMELINE_ZOOM,
		maximum,
	);
	if (Math.abs(nextZoom - surface.zoom) < 0.000001) {
		updateTimelineMinimapViewport(surface);
		return false;
	}

	const previousSurfaceWidth = getTimelineSurfaceWidth(surface);
	const wrapperRect = surface.scrollContainer.getBoundingClientRect();
	const wrapperWidth = refreshTimelineViewportWidth(surface);
	const anchorWithinWrapper = Number.isFinite(anchorPageX)
		? clampTimelineValue(
				(anchorPageX as number) - (wrapperRect.left + window.scrollX),
				0,
				wrapperWidth,
			)
		: wrapperWidth / 2;
	const anchorRatio =
		previousSurfaceWidth > 0
			? (surface.scrollContainer.scrollLeft + anchorWithinWrapper) /
				previousSurfaceWidth
			: 0;

	surface.zoom = nextZoom;
	const nextSurfaceWidth = getTimelineSurfaceWidth(surface);
	applySurfaceWidth(surface, nextSurfaceWidth);

	const maxScrollLeft = Math.max(0, nextSurfaceWidth - wrapperWidth);
	const nextScrollLeft = anchorRatio * nextSurfaceWidth - anchorWithinWrapper;
	surface.scrollContainer.scrollLeft = clampTimelineValue(
		nextScrollLeft,
		0,
		maxScrollLeft,
	);
	updateTimelineMinimapViewport(surface);
	return true;
}

export function reflowTimelineSurface<T extends TimelineSurfaceGeometry>(
	surface: T,
	applySurfaceWidth: (surface: T, width: number) => void,
): void {
	const previousSurfaceWidth = getTimelineSurfaceWidth(surface);
	const viewportWidth = refreshTimelineViewportWidth(surface);
	const viewportCenter = viewportWidth / 2;
	const centerRatio =
		previousSurfaceWidth > 0
			? (surface.scrollContainer.scrollLeft + viewportCenter) /
				previousSurfaceWidth
			: 0;

	surface.baseWidth = resolveTimelineBaseWidth(
		surface.scrollContainer,
		surface.baseWidth,
	);
	const nextSurfaceWidth = getTimelineSurfaceWidth(surface);
	applySurfaceWidth(surface, nextSurfaceWidth);

	const maxScrollLeft = Math.max(0, nextSurfaceWidth - viewportWidth);
	const nextScrollLeft = centerRatio * nextSurfaceWidth - viewportCenter;
	surface.scrollContainer.scrollLeft = clampTimelineValue(
		nextScrollLeft,
		0,
		maxScrollLeft,
	);
	updateTimelineMinimapViewport(surface);
}

export function resolveTimelinePlaybackFollowScrollLeft(
	surface: TimelineSurfaceGeometry & {
		playbackFollowMode: WaveformPlaybackFollowMode;
	},
	playheadRatio: number,
): number | null {
	if (surface.playbackFollowMode === "off") {
		return null;
	}

	const viewportWidth = getTimelineViewportWidth(surface);
	const surfaceWidth = getTimelineSurfaceWidth(surface);
	const maxScrollLeft = Math.max(0, surfaceWidth - viewportWidth);
	if (maxScrollLeft <= 0) {
		return null;
	}

	const playheadPx = clampTimelineValue(playheadRatio, 0, 1) * surfaceWidth;
	const currentScrollLeft = clampTimelineValue(
		surface.scrollContainer.scrollLeft,
		0,
		maxScrollLeft,
	);
	const visibleStart = currentScrollLeft;
	const visibleEnd = currentScrollLeft + viewportWidth;

	if (surface.playbackFollowMode === "center") {
		return clampTimelineValue(playheadPx - viewportWidth / 2, 0, maxScrollLeft);
	}

	if (playheadPx < visibleStart || playheadPx > visibleEnd) {
		return clampTimelineValue(playheadPx, 0, maxScrollLeft);
	}

	return null;
}

/**
 * Sizes a canvas backing store for the given CSS box at device-pixel resolution,
 * clears it and returns a context already scaled so drawing can use CSS pixel
 * coordinates. The CSS box itself is left to the caller or the stylesheet.
 */
export function resizeCanvasForCssSize(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
): CanvasRenderingContext2D | null {
	const cssWidth = Math.max(1, Math.round(width));
	const cssHeight = Math.max(1, Math.round(height));
	const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
	const pixelWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
	const pixelHeight = Math.max(1, Math.round(cssHeight * pixelRatio));

	if (canvas.width !== pixelWidth) {
		canvas.width = pixelWidth;
	}
	if (canvas.height !== pixelHeight) {
		canvas.height = pixelHeight;
	}

	const context = canvas.getContext("2d");
	if (!context) {
		return null;
	}

	context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
	context.clearRect(0, 0, cssWidth, cssHeight);
	return context;
}

/**
 * Computes the slice of the virtual surface a sliding tile canvas must cover:
 * the viewport plus one viewport of buffer on each side.
 *
 * The window edges are snapped to a half-viewport grid. Without that, a
 * playback-follow scroll of a pixel per frame would shift the window by a pixel
 * per frame and force a full redraw every frame, which is exactly what the
 * buffer exists to avoid. Snapped, the window only re-anchors once the viewport
 * has travelled half a screen, while still always covering the viewport.
 */
export function resolveVisibleTileWindow(
	surface: TimelineSurfaceGeometry,
	tileHeight: number,
): TimelineTileWindow {
	const surfaceWidth = getTimelineSurfaceWidth(surface);
	const viewportWidth = getTimelineViewportWidth(surface);
	const scrollLeft = clampTimelineValue(
		surface.scrollContainer.scrollLeft,
		0,
		Math.max(0, surfaceWidth - viewportWidth),
	);
	const bufferPx = viewportWidth;
	const stepPx = Math.max(1, Math.round(viewportWidth / 2));
	const visibleStart = Math.max(
		0,
		Math.floor((scrollLeft - bufferPx) / stepPx) * stepPx,
	);
	const visibleEnd = Math.min(
		surfaceWidth,
		Math.ceil((scrollLeft + viewportWidth + bufferPx) / stepPx) * stepPx,
	);
	return {
		tileStartPx: visibleStart,
		tileCssWidth: Math.max(1, Math.ceil(visibleEnd - visibleStart)),
		tileCssHeight: Math.max(1, Math.round(tileHeight)),
		surfaceWidth,
		viewportWidth,
	};
}

export function positionTileCanvas(
	canvas: HTMLCanvasElement,
	tileWindow: TimelineTileWindow,
): void {
	canvas.style.left = `${tileWindow.tileStartPx}px`;
	canvas.style.width = `${tileWindow.tileCssWidth}px`;
	canvas.style.height = `${tileWindow.tileCssHeight}px`;
}
