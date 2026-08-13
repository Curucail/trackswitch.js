import type {
	TrackRuntime,
	TrackSwitchUiState,
	TrackSwitchWaveformViewConfig,
	WaveformPlaybackFollowMode,
	WaveformSourceIndex,
	WaveformTimeAxis,
} from "../domain/types";
import type {
	TrackTimelineProjector,
	WaveformEngine,
	WaveformPeakBuckets,
} from "../engine/waveform-engine";
import { applyCssOverrides } from "../shared/dom";
import {
	isWaveformTrackAudible,
	resolveAudibleWaveformTrackIndex,
	resolveWaveformTrackIndices,
	serializeWaveformSource,
} from "../shared/waveform-source";
import {
	clampTimelineValue,
	getTimelineMaximumZoom,
	getTimelineSurfaceWidth,
	getTimelineViewportState,
	MIN_TIMELINE_ZOOM,
	positionTileCanvas,
	reflowTimelineSurface,
	resizeCanvasForCssSize,
	resolveTimelineBaseWidth,
	resolveTimelinePlaybackFollowScrollLeft,
	resolveVisibleTileWindow,
	sanitizeTimelineDuration,
	setTimelineZoomForSurface,
	updateTimelineMinimapViewport,
} from "./timeline-surface";
import type { ViewRenderer, WaveformTimelineContext } from "./view-renderer";

interface WaveformSeekSurfaceMetadata {
	wrapper: HTMLElement;
	scrollContainer: HTMLElement;
	overlay: HTMLElement;
	surface: HTMLElement;
	tileLayer: HTMLElement;
	endedRegion: HTMLElement;
	seekWrap: HTMLElement;
	waveformSource: WaveformSourceIndex;
	playbackFollowMode: WaveformPlaybackFollowMode;
	timeAxis: WaveformTimeAxis;
	originalHeight: number;
	/** The configured `height`, immutable — the base a fullscreen grow restores to. */
	configuredHeight: number;
	barWidth: number;
	maxZoomSeconds: number;
	baseWidth: number;
	zoom: number;
	timingNode: HTMLElement | null;
	zoomNode: HTMLElement;
	zoomMinimapNode: HTMLElement;
	zoomCanvas: HTMLCanvasElement;
	zoomEndedRegion: HTMLElement;
	zoomViewportNode: HTMLElement;
	zoomCanvasLastDrawKey: string | null;
	waveformColor: string | null;
	tiles: Map<
		number,
		{
			canvas: HTMLCanvasElement;
			lastDrawKey: string | null;
		}
	>;
	normalizationPeak: number;
	normalizationCacheKey: string | null;
	tilePeakCache: Map<string, WaveformPeakBuckets>;
	tilePeakCacheOrder: string[];
	alignedPlayhead: boolean;
	refHooksCanvas: HTMLCanvasElement | null;
	showAlignmentPoints: boolean;
	alignmentPointsLastW: number;
	alignmentPointsLastH: number;
}

const MIN_WAVEFORM_ZOOM = MIN_TIMELINE_ZOOM;
const WAVEFORM_TILE_PEAK_CACHE_LIMIT = 64;
/** The player draws the waveform itself, so the seek surface spans it exactly. */
function buildSeekWrap(): string {
	return (
		'<div class="seekwrap">' +
		'<div class="loop-region"></div>' +
		'<div class="loop-marker marker-a"></div>' +
		'<div class="loop-marker marker-b"></div>' +
		'<div class="seekhead"></div>' +
		'<canvas class="seekhead-ref-hooks"></canvas>' +
		"</div>"
	);
}

function clampTime(value: number, minimum: number, maximum: number): number {
	return clampTimelineValue(value, minimum, maximum);
}

function sanitizeDuration(value: number): number {
	return sanitizeTimelineDuration(value);
}

function isWaveformTrackAudibleForCtx(
	ctx: ViewRenderer,
	runtimes: TrackRuntime[],
	trackIndex: number,
	waveformSource: WaveformSourceIndex,
): boolean {
	return isWaveformTrackAudible(
		runtimes,
		trackIndex,
		waveformSource,
		ctx.isAlignmentMode(),
		ctx.isTrackExclusive,
	);
}

function resolveWaveformColor(element: HTMLElement): string {
	return (
		getComputedStyle(element).getPropertyValue("--waveform-color").trim() ||
		"#ED8C01"
	);
}

function updateWaveformEndedRegions(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	trackDuration: number,
	axisDuration: number,
	visible: boolean,
): void {
	const shouldShow =
		visible &&
		trackDuration > 0 &&
		axisDuration > 0 &&
		trackDuration < axisDuration - 0.000001;
	const display = shouldShow ? "block" : "none";
	surfaceMetadata.endedRegion.style.display = display;
	surfaceMetadata.zoomEndedRegion.style.display = display;

	if (!shouldShow) {
		return;
	}

	const startPercent = Math.max(
		0,
		Math.min(100, (trackDuration / axisDuration) * 100),
	);
	const left = `${String(startPercent)}%`;
	surfaceMetadata.endedRegion.style.left = left;
	surfaceMetadata.zoomEndedRegion.style.left = left;
}

function getWaveformBucketPeak(buckets: WaveformPeakBuckets | null): number {
	if (!buckets) {
		return 0;
	}

	let peak = 0;
	for (let index = 0; index < buckets.maxes.length; index += 1) {
		peak = Math.max(
			peak,
			Math.abs(buckets.mins[index]),
			Math.abs(buckets.maxes[index]),
		);
	}
	return peak;
}

function clearWaveformTilePeakCache(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
): void {
	surfaceMetadata.tilePeakCache.clear();
	surfaceMetadata.tilePeakCacheOrder = [];
}

function getCachedWaveformTilePeaks(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	key: string,
): WaveformPeakBuckets | null {
	const cached = surfaceMetadata.tilePeakCache.get(key);
	if (!cached) {
		return null;
	}

	const existingIndex = surfaceMetadata.tilePeakCacheOrder.indexOf(key);
	if (existingIndex !== -1) {
		surfaceMetadata.tilePeakCacheOrder.splice(existingIndex, 1);
	}
	surfaceMetadata.tilePeakCacheOrder.push(key);
	return cached;
}

function setCachedWaveformTilePeaks(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	key: string,
	buckets: WaveformPeakBuckets,
): void {
	if (!surfaceMetadata.tilePeakCache.has(key)) {
		surfaceMetadata.tilePeakCacheOrder.push(key);
	}
	surfaceMetadata.tilePeakCache.set(key, buckets);

	while (
		surfaceMetadata.tilePeakCacheOrder.length > WAVEFORM_TILE_PEAK_CACHE_LIMIT
	) {
		const oldestKey = surfaceMetadata.tilePeakCacheOrder.shift();
		if (oldestKey) {
			surfaceMetadata.tilePeakCache.delete(oldestKey);
		}
	}
}

function renderWaveformCanvas(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
	buckets: WaveformPeakBuckets | null,
	barWidth: number,
	color: string,
	normalizationPeak?: number,
	alpha = 1,
	maxDrawWidth = width,
): void {
	const context = resizeCanvasForCssSize(canvas, width, height);
	if (
		!context ||
		!buckets ||
		buckets.maxes.length === 0 ||
		width <= 0 ||
		height <= 0
	) {
		return;
	}

	let maxPeak =
		Number.isFinite(normalizationPeak) && (normalizationPeak as number) > 0
			? (normalizationPeak as number)
			: getWaveformBucketPeak(buckets);
	if (maxPeak <= 0) {
		maxPeak = 1;
	}

	const centerY = Math.round(height / 2);
	const scale = (height * 0.475) / maxPeak;
	const snappedBarWidth = Math.max(1, Math.round(barWidth));
	const safeMaxDrawWidth = Math.max(0, Math.min(width, maxDrawWidth));
	context.save();
	context.globalAlpha = alpha;
	context.fillStyle = color;

	for (let index = 0; index < buckets.maxes.length; index += 1) {
		const x = Math.round(index * snappedBarWidth);
		if (x >= safeMaxDrawWidth) {
			break;
		}

		const top = Math.round(centerY - buckets.maxes[index] * scale);
		const bottom = Math.round(centerY - buckets.mins[index] * scale);
		let y1 = Math.round(clampTime(Math.min(top, bottom), 0, height));
		let y2 = Math.round(clampTime(Math.max(top, bottom), 0, height));
		if (y2 <= y1) {
			y1 = clampTime(centerY, 0, Math.max(0, height - 1));
			y2 = y1 + 1;
		}

		context.fillRect(
			x,
			y1,
			Math.min(snappedBarWidth, Math.max(0, safeMaxDrawWidth - x)),
			Math.max(1, y2 - y1),
		);
	}

	context.restore();
}

function renderPlaceholderCanvas(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
	barWidth: number,
	color: string,
	alpha: number,
): void {
	const context = resizeCanvasForCssSize(canvas, width, height);
	if (width <= 0 || height <= 0) {
		return;
	}

	const snappedBarWidth = Math.max(1, Math.round(barWidth));
	const bars = Math.max(1, Math.floor(width / snappedBarWidth));
	if (!context) {
		return;
	}

	context.save();
	context.globalAlpha = alpha;
	context.fillStyle = color;

	for (let x = 0; x < bars; x += 1) {
		const waveA = Math.sin(x * 0.21);
		const waveB = Math.sin(x * 0.051 + 0.8);
		const amplitude = 0.25 + 0.75 * (Math.abs(waveA + waveB) / 2);
		const barHeight = Math.max(1, Math.round(amplitude * height * 0.7));
		const y = Math.round((height - barHeight) / 2);
		const barX = Math.round(x * snappedBarWidth);
		context.fillRect(
			barX,
			y,
			Math.min(snappedBarWidth, Math.max(1, width - barX)),
			barHeight,
		);
	}

	context.restore();
}

function clearCanvas(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
): void {
	resizeCanvasForCssSize(canvas, width, height);
}

function getWaveformSurfaceWidth(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
): number {
	return getTimelineSurfaceWidth(surfaceMetadata);
}

function getWaveformViewportState(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
): { startRatio: number; widthRatio: number } {
	return getTimelineViewportState(surfaceMetadata);
}

function updateWaveformMinimapViewport(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
): void {
	updateTimelineMinimapViewport(surfaceMetadata);
}

function resolveWaveformPlaybackMetrics(
	ctx: ViewRenderer,
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	state: { position: number },
	runtimes: TrackRuntime[],
	waveformTimelineContext?: WaveformTimelineContext,
	useAxisDuration = false,
): { position: number; duration: number; trackIndex: number | null } {
	let position = state.position;
	let duration = ctx.getLongestWaveformSourceDuration(
		runtimes,
		surfaceMetadata.waveformSource,
	);
	// A fixed source resolves to its own track index outright. A dynamic
	// "audible" source resolves to the first audible track — under alignment
	// everything audible at once shares one timeline, so that track's own local
	// timeline stands in for position/duration, same as a fixed source would.
	// Resolved without an alignment too, where it names nothing but the medium
	// whose unit the readout is printed in.
	const resolvedTrackIndex = resolveAudibleWaveformTrackIndex(
		runtimes,
		surfaceMetadata.waveformSource,
		ctx.isAlignmentMode(),
		ctx.isTrackExclusive,
	);

	if (waveformTimelineContext?.enabled && resolvedTrackIndex !== null) {
		const trackDuration = sanitizeDuration(
			waveformTimelineContext.getTrackDuration(resolvedTrackIndex),
		);
		if (trackDuration > 0) {
			duration = trackDuration;
			if (useAxisDuration && surfaceMetadata.timeAxis === "shared") {
				for (let index = 0; index < runtimes.length; index += 1) {
					duration = Math.max(
						duration,
						sanitizeDuration(waveformTimelineContext.getTrackDuration(index)),
					);
				}
			}
			position = clampTime(
				waveformTimelineContext.getPlaybackPosition(resolvedTrackIndex) ??
					waveformTimelineContext.referenceToTrackTime(
						resolvedTrackIndex,
						state.position,
					),
				0,
				trackDuration,
			);
		} else {
			duration = 0;
			position = 0;
		}
	}

	const safeDuration = sanitizeDuration(duration);
	return {
		position: safeDuration > 0 ? clampTime(position, 0, safeDuration) : 0,
		duration: safeDuration,
		// Null on a waveform with nothing audible, whose metrics are then the
		// reference timeline's own.
		trackIndex: resolvedTrackIndex,
	};
}

function resolvePlaybackFollowScrollLeft(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	playheadRatio: number,
): number | null {
	return resolveTimelinePlaybackFollowScrollLeft(
		surfaceMetadata,
		playheadRatio,
	);
}

function applyWaveformPlaybackFollowScroll(
	ctx: ViewRenderer,
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	nextScrollLeft: number | null,
): boolean {
	if (!Number.isFinite(nextScrollLeft)) {
		return false;
	}

	const surfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
	const maxScrollLeft = Math.max(
		0,
		surfaceWidth - surfaceMetadata.scrollContainer.clientWidth,
	);
	const clampedScrollLeft = clampTime(
		nextScrollLeft as number,
		0,
		maxScrollLeft,
	);

	if (
		Math.abs(clampedScrollLeft - surfaceMetadata.scrollContainer.scrollLeft) <
		0.000001
	) {
		return false;
	}

	surfaceMetadata.scrollContainer.scrollLeft = clampedScrollLeft;
	updateWaveformMinimapViewport(surfaceMetadata);
	ctx.scheduleVisibleWaveformTileRefresh();
	return true;
}

function getWaveformMaximumZoom(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	durationSeconds: number,
): number {
	return getTimelineMaximumZoom(
		durationSeconds,
		surfaceMetadata.maxZoomSeconds,
	);
}

function setWaveformZoomForSurface(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	zoom: number,
	maximum: number,
	anchorPageX?: number,
): boolean {
	return setTimelineZoomForSurface(
		surfaceMetadata,
		zoom,
		maximum,
		anchorPageX,
		(surface, width) => {
			surface.surface.style.width = `${width}px`;
			surface.surface.style.height = `${surface.originalHeight}px`;
			surface.tileLayer.style.height = `${surface.originalHeight}px`;
		},
	);
}

export function wrapWaveformCanvases(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		const canvases = this.root.querySelectorAll("canvas.waveform");
		canvases.forEach((canvasElement: Element) => {
			if (!(canvasElement instanceof HTMLCanvasElement)) {
				return;
			}

			if (canvasElement.closest(".waveform-wrap")) {
				return;
			}

			const definition = this.getConfiguredViewHost(canvasElement);
			if (definition.view.type !== "waveform") return;
			const config = definition.view as TrackSwitchWaveformViewConfig;
			const waveformSource = definition.waveformSource ?? "audible";
			const barWidth = config.waveformBarWidth ?? 1;
			const maxZoomSeconds = config.maxZoom ?? 5;
			const playbackFollowMode = config.playbackFollowMode ?? "center";
			const timeAxis = config.timeAxis ?? "shared";
			const timerEnabled = config.timer ?? this.isAlignmentMode();
			const alignedPlayhead = config.alignedPlayhead === true;
			const showAlignmentPoints = !!config.markerLayers?.some(
				(layer) => layer.set === "alignment" && layer.foldToReference,
			);
			const originalHeight = canvasElement.height;

			const wrapper = document.createElement("div");
			wrapper.className = "waveform-wrap ts-stack-section";
			applyCssOverrides(wrapper, config.css);
			const scrollContainer = document.createElement("div");
			scrollContainer.className = "waveform-scroll";
			const overlay = document.createElement("div");
			overlay.className = "waveform-overlay";
			const surface = document.createElement("div");
			surface.className = "waveform-surface";

			const parent = canvasElement.parentElement;
			if (!parent) {
				return;
			}

			parent.insertBefore(wrapper, canvasElement);
			wrapper.appendChild(scrollContainer);
			wrapper.appendChild(overlay);
			scrollContainer.appendChild(surface);
			surface.insertAdjacentHTML("beforeend", buildSeekWrap());

			// One viewport-sized canvas slides over the virtual waveform surface.
			// This keeps zoom independent of browser canvas limits without creating a
			// DOM node per tile.
			const tileLayer = document.createElement("canvas");
			tileLayer.className = "waveform waveform-tile waveform-tile-layer";
			const endedRegion = document.createElement("div");
			endedRegion.className = "waveform-ended-region";
			const seekWrap = surface.querySelector(".seekwrap");
			if (seekWrap instanceof HTMLElement) {
				surface.insertBefore(tileLayer, seekWrap);
				surface.insertBefore(endedRegion, seekWrap);
			} else {
				surface.appendChild(tileLayer);
				surface.appendChild(endedRegion);
			}

			surface.style.height = `${originalHeight}px`;
			scrollContainer.style.height = `${originalHeight}px`;
			canvasElement.remove();

			if (seekWrap instanceof HTMLElement) {
				this.registerSeekMarkerLayers(seekWrap, config.markerLayers);
				seekWrap.setAttribute("data-seek-surface", "waveform");
				const timingNode = timerEnabled
					? this.createWaveformTimingNode(overlay)
					: null;
				const refHooksCanvas = seekWrap.querySelector(".seekhead-ref-hooks");
				const zoomNode = this.createWaveformZoomNode(overlay);
				const zoomMinimapNode = zoomNode.querySelector(
					".waveform-zoom-minimap",
				);
				const zoomCanvas = zoomNode.querySelector(".waveform-zoom-canvas");
				const zoomEndedRegion = zoomNode.querySelector(
					".waveform-zoom-ended-region",
				);
				const zoomViewportNode = zoomNode.querySelector(
					".waveform-zoom-viewport",
				);
				if (
					!(zoomMinimapNode instanceof HTMLElement) ||
					!(zoomCanvas instanceof HTMLCanvasElement) ||
					!(zoomEndedRegion instanceof HTMLElement) ||
					!(zoomViewportNode instanceof HTMLElement)
				) {
					return;
				}
				this.waveformSeekSurfaces.push({
					wrapper: wrapper,
					scrollContainer: scrollContainer,
					overlay: overlay,
					surface: surface,
					tileLayer: tileLayer,
					endedRegion: endedRegion,
					seekWrap: seekWrap,
					waveformSource: waveformSource,
					playbackFollowMode: playbackFollowMode,
					timeAxis: timeAxis,
					originalHeight: originalHeight,
					configuredHeight: originalHeight,
					barWidth: barWidth,
					maxZoomSeconds: maxZoomSeconds,
					baseWidth: this.resolveWaveformBaseWidth(
						scrollContainer,
						canvasElement.width,
					),
					zoom: MIN_WAVEFORM_ZOOM,
					timingNode: timingNode,
					zoomNode: zoomNode,
					zoomMinimapNode: zoomMinimapNode,
					zoomCanvas: zoomCanvas,
					zoomEndedRegion: zoomEndedRegion,
					zoomViewportNode: zoomViewportNode,
					zoomCanvasLastDrawKey: null,
					waveformColor: null,
					tiles: new Map<
						number,
						{
							canvas: HTMLCanvasElement;
							lastDrawKey: string | null;
						}
					>([[0, { canvas: tileLayer, lastDrawKey: null }]]),
					normalizationPeak: 1,
					normalizationCacheKey: null,
					tilePeakCache: new Map<string, WaveformPeakBuckets>(),
					tilePeakCacheOrder: [],
					alignedPlayhead: alignedPlayhead,
					refHooksCanvas:
						refHooksCanvas instanceof HTMLCanvasElement ? refHooksCanvas : null,
					showAlignmentPoints: showAlignmentPoints,
					alignmentPointsLastW: -1,
					alignmentPointsLastH: -1,
				});

				scrollContainer.addEventListener(
					"scroll",
					() => {
						const currentSurface = this.findWaveformSurface(seekWrap);
						if (currentSurface) {
							updateWaveformMinimapViewport(currentSurface);
						}
						this.scheduleVisibleWaveformTileRefresh();
					},
					{ passive: true },
				);
			}
		});
	}).call(ctx);
}

export function createWaveformTimingNode(
	ctx: ViewRenderer,
	overlay: HTMLElement,
): HTMLElement {
	return function (this: ViewRenderer, overlay: HTMLElement) {
		const timing = document.createElement("div");
		timing.className = "waveform-timing";
		timing.textContent = "--:--:--:--- / --:--:--:---";
		overlay.appendChild(timing);
		return timing;
	}.call(ctx, overlay);
}

export function createWaveformZoomNode(
	ctx: ViewRenderer,
	overlay: HTMLElement,
): HTMLElement {
	return function (this: ViewRenderer, overlay: HTMLElement) {
		const zoom = document.createElement("div");
		zoom.className = "waveform-zoom";
		zoom.innerHTML =
			'<span class="waveform-zoom-label">Zoom</span>' +
			'<div class="waveform-zoom-minimap">' +
			'<canvas class="waveform waveform-zoom-canvas"></canvas>' +
			'<div class="waveform-zoom-ended-region"></div>' +
			'<div class="waveform-zoom-viewport"></div>' +
			"</div>";
		zoom.style.display = "none";
		overlay.appendChild(zoom);
		return zoom;
	}.call(ctx, overlay);
}

export function resolveWaveformBaseWidth(
	ctx: ViewRenderer,
	scrollContainer: HTMLElement,
	fallback: number,
): number {
	return function (
		this: ViewRenderer,
		scrollContainer: HTMLElement,
		fallback: number,
	) {
		return resolveTimelineBaseWidth(scrollContainer, fallback);
	}.call(ctx, scrollContainer, fallback);
}

export function setWaveformSurfaceWidth(
	ctx: ViewRenderer,
	surfaceMetadata: WaveformSeekSurfaceMetadata,
): void {
	(function (this: ViewRenderer, surfaceMetadata: WaveformSeekSurfaceMetadata) {
		const width = getWaveformSurfaceWidth(surfaceMetadata);
		surfaceMetadata.surface.style.width = `${width}px`;
		surfaceMetadata.surface.style.height = `${surfaceMetadata.originalHeight}px`;
		surfaceMetadata.tileLayer.style.height = `${surfaceMetadata.originalHeight}px`;
		updateWaveformMinimapViewport(surfaceMetadata);
	}).call(ctx, surfaceMetadata);
}

/** Resizes a surface's rendered height (fullscreen growth/restore) and redraws it. */
export function setWaveformSurfaceHeight(
	ctx: ViewRenderer,
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	height: number,
): void {
	(function (
		this: ViewRenderer,
		surfaceMetadata: WaveformSeekSurfaceMetadata,
		height: number,
	) {
		if (surfaceMetadata.originalHeight === height) {
			return;
		}

		surfaceMetadata.originalHeight = height;
		surfaceMetadata.surface.style.height = `${height}px`;
		surfaceMetadata.scrollContainer.style.height = `${height}px`;
		surfaceMetadata.tileLayer.style.height = `${height}px`;
		surfaceMetadata.zoomCanvasLastDrawKey = null;
		surfaceMetadata.alignmentPointsLastW = -1;
		surfaceMetadata.alignmentPointsLastH = -1;
		this.refreshVisibleWaveformTilesFromLatestInput();
	}).call(ctx, surfaceMetadata, height);
}

export interface WaveformVisibleTile {
	tileIndex: number;
	tileStartPx: number;
	tileCssWidth: number;
	tileCssHeight: number;
	surfaceWidth: number;
	canvas: HTMLCanvasElement;
	renderBarWidth: number;
	isNew: boolean;
	record: {
		canvas: HTMLCanvasElement;
		lastDrawKey: string | null;
	};
}

export function forEachVisibleWaveformTile(
	ctx: ViewRenderer,
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	callback: (tile: WaveformVisibleTile) => void,
): void {
	(function (
		this: ViewRenderer,
		surfaceMetadata: WaveformSeekSurfaceMetadata,
		callback: (tile: WaveformVisibleTile) => void,
	) {
		const tileRecord = surfaceMetadata.tiles.get(0);
		if (!tileRecord) return;
		const tileCanvas = tileRecord.canvas;
		const tileWindow = resolveVisibleTileWindow(
			surfaceMetadata,
			surfaceMetadata.originalHeight,
		);
		const { tileStartPx, tileCssWidth, tileCssHeight, surfaceWidth } =
			tileWindow;
		positionTileCanvas(tileCanvas, tileWindow);
		callback({
			tileIndex: 0,
			tileStartPx,
			tileCssWidth,
			tileCssHeight,
			surfaceWidth,
			canvas: tileCanvas,
			renderBarWidth: Math.max(1, Math.round(surfaceMetadata.barWidth)),
			isNew: false,
			record: tileRecord,
		});
	}).call(ctx, surfaceMetadata, callback);
}

export function scheduleVisibleWaveformTileRefresh(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		if (this.waveformTileRefreshFrameId !== null) {
			return;
		}

		this.waveformTileRefreshFrameId = requestAnimationFrame(() => {
			this.waveformTileRefreshFrameId = null;
			this.refreshVisibleWaveformTilesFromLatestInput();
		});
	}).call(ctx);
}

export function refreshVisibleWaveformTilesFromLatestInput(
	ctx: ViewRenderer,
): void {
	(function (this: ViewRenderer) {
		const latestInput = this.latestWaveformRenderInput;
		if (!latestInput) {
			return;
		}

		this.renderWaveformsInternal(
			latestInput.waveformEngine,
			latestInput.runtimes,
			latestInput.timelineDuration,
			latestInput.trackTimelineProjector,
			latestInput.waveformTimelineContext,
			false,
			false,
		);
	}).call(ctx);
}

export function computeNormalizationPeak(
	ctx: ViewRenderer,
	waveformEngine: WaveformEngine,
	sourceRuntimes: TrackRuntime[],
	renderBarWidth: number,
	duration: number,
	baseProjector: TrackTimelineProjector | undefined,
	baseWidth: number,
): number {
	return function (
		this: ViewRenderer,
		waveformEngine: WaveformEngine,
		sourceRuntimes: TrackRuntime[],
		renderBarWidth: number,
		duration: number,
		baseProjector: TrackTimelineProjector | undefined,
		baseWidth: number,
	) {
		if (
			!Number.isFinite(duration) ||
			duration <= 0 ||
			sourceRuntimes.length === 0
		) {
			return 1;
		}

		const normalizationPeakCount = Math.max(
			256,
			Math.min(4096, Math.round(baseWidth)),
		);
		const mixed = waveformEngine.calculateMixedWaveform(
			sourceRuntimes,
			normalizationPeakCount,
			renderBarWidth,
			duration,
			baseProjector,
			0,
			undefined,
		);
		if (!mixed || mixed.maxes.length === 0) {
			return 1;
		}

		const maxPeak = getWaveformBucketPeak(mixed);
		return maxPeak > 0 ? maxPeak : 1;
	}.call(
		ctx,
		waveformEngine,
		sourceRuntimes,
		renderBarWidth,
		duration,
		baseProjector,
		baseWidth,
	);
}

export function buildWaveformNormalizationCacheKey(
	ctx: ViewRenderer,
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	runtimes: TrackRuntime[],
	sourceRuntimes: TrackRuntime[],
	fullDuration: number,
	renderBarWidth: number,
	useLocalAxis: boolean,
	hasTimelineProjector: boolean,
): string {
	return function (
		this: ViewRenderer,
		surfaceMetadata: WaveformSeekSurfaceMetadata,
		runtimes: TrackRuntime[],
		sourceRuntimes: TrackRuntime[],
		fullDuration: number,
		renderBarWidth: number,
		useLocalAxis: boolean,
		hasTimelineProjector: boolean,
	) {
		const sourceKey = runtimes
			.map((runtime: TrackRuntime, index: number) => {
				const duration = runtime.buffer ? runtime.buffer.duration : 0;
				const timingDuration = runtime.timing
					? runtime.timing.effectiveDuration
					: 0;
				const summarySampleCount = runtime.waveformSummary
					? runtime.waveformSummary.sampleCount
					: 0;
				const selected = sourceRuntimes.indexOf(runtime) !== -1 ? 1 : 0;
				return [
					index,
					selected,
					runtime.activeVariant,
					runtime.sourceIndex,
					runtime.state.solo ? 1 : 0,
					Math.round(runtime.state.volume * 1000),
					Math.round(duration * 1000),
					Math.round(timingDuration * 1000),
					summarySampleCount,
				].join(":");
			})
			.join("|");

		return [
			serializeWaveformSource(surfaceMetadata.waveformSource),
			useLocalAxis ? "local" : "reference",
			hasTimelineProjector ? "projector" : "identity",
			Math.round(fullDuration * 1000),
			renderBarWidth,
			Math.round(surfaceMetadata.baseWidth),
			sourceKey,
		].join("#");
	}.call(
		ctx,
		surfaceMetadata,
		runtimes,
		sourceRuntimes,
		fullDuration,
		renderBarWidth,
		useLocalAxis,
		hasTimelineProjector,
	);
}

function renderWaveformMinimap(
	surfaceMetadata: WaveformSeekSurfaceMetadata,
	waveformEngine: WaveformEngine,
	sourceRuntimes: TrackRuntime[],
	fullDuration: number,
	baseProjector: TrackTimelineProjector | undefined,
	normalizationPeak: number,
	normalizationCacheKey: string,
	waveformEndRatio: number,
): void {
	if (surfaceMetadata.zoom <= MIN_WAVEFORM_ZOOM + 0.000001) {
		return;
	}

	const waveformColor = resolveWaveformColor(surfaceMetadata.zoomCanvas);
	surfaceMetadata.waveformColor = waveformColor;

	const cssWidth = Math.max(
		1,
		Math.round(surfaceMetadata.zoomMinimapNode.clientWidth),
	);
	const cssHeight = Math.max(
		1,
		Math.round(surfaceMetadata.zoomMinimapNode.clientHeight),
	);
	const canvas = surfaceMetadata.zoomCanvas;

	const drawKey = [
		normalizationCacheKey,
		"minimap",
		cssWidth,
		cssHeight,
		waveformColor,
		Math.max(1, window.devicePixelRatio || 1),
	].join("#");
	if (surfaceMetadata.zoomCanvasLastDrawKey === drawKey) {
		return;
	}

	if (fullDuration <= 0) {
		renderPlaceholderCanvas(canvas, cssWidth, cssHeight, 1, waveformColor, 0.2);
		surfaceMetadata.zoomCanvasLastDrawKey = drawKey;
		return;
	}

	const mixed = waveformEngine.calculateMixedWaveform(
		sourceRuntimes,
		cssWidth,
		1,
		fullDuration,
		baseProjector,
		0,
		undefined,
	);
	if (!mixed) {
		renderPlaceholderCanvas(canvas, cssWidth, cssHeight, 1, waveformColor, 0.2);
		surfaceMetadata.zoomCanvasLastDrawKey = drawKey;
		return;
	}

	renderWaveformCanvas(
		canvas,
		cssWidth,
		cssHeight,
		mixed,
		1,
		waveformColor,
		normalizationPeak,
		1,
		cssWidth * waveformEndRatio,
	);
	surfaceMetadata.zoomCanvasLastDrawKey = drawKey;
}

export function findWaveformSurface(
	ctx: ViewRenderer,
	seekWrap: HTMLElement | null,
): WaveformSeekSurfaceMetadata | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement | null) {
		if (!seekWrap) {
			return null;
		}

		for (let index = 0; index < this.waveformSeekSurfaces.length; index += 1) {
			const entry = this.waveformSeekSurfaces[index];
			if (entry.seekWrap === seekWrap) {
				return entry;
			}
		}

		return null;
	}.call(ctx, seekWrap);
}

export function reflowWaveforms(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		this.waveformSeekSurfaces.forEach(
			(surfaceMetadata: WaveformSeekSurfaceMetadata) => {
				reflowTimelineSurface(surfaceMetadata, (surface, width) => {
					surface.surface.style.width = `${width}px`;
					surface.surface.style.height = `${surface.originalHeight}px`;
					surface.tileLayer.style.height = `${surface.originalHeight}px`;
				});
			},
		);
	}).call(ctx);
}

export function getWaveformZoom(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
): number | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement) {
		const surfaceMetadata = this.findWaveformSurface(seekWrap);
		if (!surfaceMetadata) {
			return null;
		}

		return surfaceMetadata.zoom;
	}.call(ctx, seekWrap);
}

export function isWaveformZoomEnabled(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
	durationSeconds: number,
): boolean {
	return function (
		this: ViewRenderer,
		seekWrap: HTMLElement,
		durationSeconds: number,
	) {
		const surfaceMetadata = this.findWaveformSurface(seekWrap);
		if (!surfaceMetadata) {
			return false;
		}

		return (
			getWaveformMaximumZoom(surfaceMetadata, durationSeconds) >
			MIN_WAVEFORM_ZOOM
		);
	}.call(ctx, seekWrap, durationSeconds);
}

export function getWaveformMinimapViewport(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
): { startRatio: number; widthRatio: number } | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement) {
		const surfaceMetadata = this.findWaveformSurface(seekWrap);
		if (!surfaceMetadata) {
			return null;
		}

		return getWaveformViewportState(surfaceMetadata);
	}.call(ctx, seekWrap);
}

export function setWaveformMinimapViewportStart(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
	startRatio: number,
): boolean {
	return function (
		this: ViewRenderer,
		seekWrap: HTMLElement,
		startRatio: number,
	) {
		const surfaceMetadata = this.findWaveformSurface(seekWrap);
		if (!surfaceMetadata) {
			return false;
		}

		const viewportState = getWaveformViewportState(surfaceMetadata);
		const surfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
		const maxStartRatio = Math.max(0, 1 - viewportState.widthRatio);
		const nextStartRatio = clampTime(startRatio, 0, maxStartRatio);
		const nextScrollLeft = nextStartRatio * surfaceWidth;
		const maxScrollLeft = Math.max(
			0,
			surfaceWidth - surfaceMetadata.scrollContainer.clientWidth,
		);
		const clampedScrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
		if (
			Math.abs(clampedScrollLeft - surfaceMetadata.scrollContainer.scrollLeft) <
			0.000001
		) {
			updateWaveformMinimapViewport(surfaceMetadata);
			return false;
		}

		surfaceMetadata.scrollContainer.scrollLeft = clampedScrollLeft;
		updateWaveformMinimapViewport(surfaceMetadata);
		this.scheduleVisibleWaveformTileRefresh();
		return true;
	}.call(ctx, seekWrap, startRatio);
}

export function setWaveformZoom(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
	zoom: number,
	durationSeconds: number,
	anchorPageX: number | undefined,
): boolean {
	return function (
		this: ViewRenderer,
		seekWrap: HTMLElement,
		zoom: number,
		durationSeconds: number,
		anchorPageX: number | undefined,
	) {
		const surfaceMetadata = this.findWaveformSurface(seekWrap);
		if (!surfaceMetadata) {
			return false;
		}

		return setWaveformZoomForSurface(
			surfaceMetadata,
			zoom,
			getWaveformMaximumZoom(surfaceMetadata, durationSeconds),
			anchorPageX,
		);
	}.call(ctx, seekWrap, zoom, durationSeconds, anchorPageX);
}

export function drawDummyWaveforms(
	ctx: ViewRenderer,
	waveformEngine: WaveformEngine,
): void {
	(function (this: ViewRenderer, waveformEngine: WaveformEngine) {
		if (this.waveformSeekSurfaces.length === 0) {
			return;
		}

		this.reflowWaveforms();

		for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
			const surfaceMetadata = this.waveformSeekSurfaces[i];
			this.forEachVisibleWaveformTile(
				surfaceMetadata,
				(tile: {
					canvas: HTMLCanvasElement;
					tileCssWidth: number;
					tileCssHeight: number;
					renderBarWidth: number;
				}) => {
					renderPlaceholderCanvas(
						tile.canvas,
						tile.tileCssWidth,
						tile.tileCssHeight,
						tile.renderBarWidth,
						resolveWaveformColor(tile.canvas),
						0.3,
					);
				},
			);
			if (surfaceMetadata.zoom > MIN_WAVEFORM_ZOOM) {
				renderWaveformMinimap(
					surfaceMetadata,
					waveformEngine,
					[],
					0,
					undefined,
					1,
					"placeholder",
					1,
				);
			}
		}
		this.updateWaveformZoomIndicators();
	}).call(ctx, waveformEngine);
}

export function renderWaveforms(
	ctx: ViewRenderer,
	waveformEngine: WaveformEngine,
	runtimes: TrackRuntime[],
	timelineDuration: number,
	trackTimelineProjector: TrackTimelineProjector | undefined,
	waveformTimelineContext: WaveformTimelineContext | undefined,
): void {
	(function (
		this: ViewRenderer,
		waveformEngine: WaveformEngine,
		runtimes: TrackRuntime[],
		timelineDuration: number,
		trackTimelineProjector: TrackTimelineProjector | undefined,
		waveformTimelineContext: WaveformTimelineContext | undefined,
	) {
		this.latestWaveformRenderInput = {
			waveformEngine,
			runtimes,
			timelineDuration,
			trackTimelineProjector,
			waveformTimelineContext,
		};

		this.renderWaveformsInternal(
			waveformEngine,
			runtimes,
			timelineDuration,
			trackTimelineProjector,
			waveformTimelineContext,
			true,
		);
	}).call(
		ctx,
		waveformEngine,
		runtimes,
		timelineDuration,
		trackTimelineProjector,
		waveformTimelineContext,
	);
}

export function renderWaveformsInternal(
	ctx: ViewRenderer,
	waveformEngine: WaveformEngine,
	runtimes: TrackRuntime[],
	timelineDuration: number,
	trackTimelineProjector: TrackTimelineProjector | undefined,
	waveformTimelineContext: WaveformTimelineContext | undefined,
	performReflow: boolean,
	forceRedrawVisibleTiles: boolean,
): void {
	(function (
		this: ViewRenderer,
		waveformEngine: WaveformEngine,
		runtimes: TrackRuntime[],
		timelineDuration: number,
		trackTimelineProjector: TrackTimelineProjector | undefined,
		waveformTimelineContext: WaveformTimelineContext | undefined,
		performReflow: boolean,
		forceRedrawVisibleTiles: boolean,
	) {
		if (this.waveformSeekSurfaces.length === 0) {
			return;
		}

		if (performReflow) {
			this.reflowWaveforms();
		}

		const safeTimelineDuration =
			Number.isFinite(timelineDuration) && timelineDuration > 0
				? timelineDuration
				: 0;

		let longestTrackDuration = 0;
		if (waveformTimelineContext?.enabled) {
			for (let ti = 0; ti < waveformTimelineContext.getTrackCount(); ti++) {
				const d = sanitizeDuration(
					waveformTimelineContext.getTrackDuration(ti),
				);
				if (d > longestTrackDuration) longestTrackDuration = d;
			}
		}

		for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
			const surfaceMetadata = this.waveformSeekSurfaces[i];
			const waveformSource = surfaceMetadata.waveformSource;
			const sourceRuntimes = this.getWaveformSourceRuntimes(
				runtimes,
				waveformSource,
			);
			// A fixed source resolves to its own track index outright. A dynamic
			// "audible" source resolves to the first audible track and renders its
			// own unwarped waveform exactly like a fixed source would — everything
			// audible beside it shares that timeline. With nothing audible there is
			// no track to bind to, and it falls back below to the flat,
			// projector-warped reference timeline.
			const fixedWaveformTrackIndex = resolveAudibleWaveformTrackIndex(
				runtimes,
				waveformSource,
				this.isAlignmentMode(),
				this.isTrackExclusive,
			);
			const localTrackDuration =
				fixedWaveformTrackIndex === null || !waveformTimelineContext
					? 0
					: sanitizeDuration(
							waveformTimelineContext.getTrackDuration(fixedWaveformTrackIndex),
						);
			const useFixedTrackAxis =
				!!waveformTimelineContext &&
				waveformTimelineContext.enabled &&
				fixedWaveformTrackIndex !== null &&
				localTrackDuration > 0;
			const useIndividualAxis =
				useFixedTrackAxis && surfaceMetadata.timeAxis === "individual";
			const fullDuration = useFixedTrackAxis
				? useIndividualAxis
					? localTrackDuration
					: longestTrackDuration > 0
						? longestTrackDuration
						: localTrackDuration
				: safeTimelineDuration;
			const baseProjector: TrackTimelineProjector = useFixedTrackAxis
				? (_runtime, trackTimelineTimeSeconds) => trackTimelineTimeSeconds
				: trackTimelineProjector ||
					((_runtime, trackTimelineTimeSeconds) => trackTimelineTimeSeconds);
			const waveformProjector =
				!useFixedTrackAxis && trackTimelineProjector
					? baseProjector
					: undefined;
			updateWaveformEndedRegions(
				surfaceMetadata,
				localTrackDuration,
				fullDuration,
				useFixedTrackAxis && !useIndividualAxis,
			);
			setWaveformZoomForSurface(
				surfaceMetadata,
				surfaceMetadata.zoom,
				getWaveformMaximumZoom(surfaceMetadata, fullDuration),
			);

			const surfaceRenderBarWidth = Math.max(
				1,
				Math.round(surfaceMetadata.barWidth),
			);
			const normalizationCacheKey = this.buildWaveformNormalizationCacheKey(
				surfaceMetadata,
				runtimes,
				sourceRuntimes,
				fullDuration,
				surfaceRenderBarWidth,
				useFixedTrackAxis,
				!useFixedTrackAxis && !!trackTimelineProjector,
			);

			if (surfaceMetadata.normalizationCacheKey !== normalizationCacheKey) {
				surfaceMetadata.normalizationPeak = this.computeNormalizationPeak(
					waveformEngine,
					sourceRuntimes,
					surfaceRenderBarWidth,
					fullDuration,
					waveformProjector,
					surfaceMetadata.baseWidth,
				);
				surfaceMetadata.normalizationCacheKey = normalizationCacheKey;
				clearWaveformTilePeakCache(surfaceMetadata);
			}

			const normalizationPeak = surfaceMetadata.normalizationPeak;

			this.forEachVisibleWaveformTile(
				surfaceMetadata,
				(tile: {
					tileStartPx: number;
					tileCssWidth: number;
					tileCssHeight: number;
					surfaceWidth: number;
					canvas: HTMLCanvasElement;
					renderBarWidth: number;
					isNew: boolean;
					record: { lastDrawKey: string | null };
				}) => {
					const waveformColor = resolveWaveformColor(tile.canvas);
					const tileDrawKey = [
						normalizationCacheKey,
						Math.round(tile.tileStartPx),
						Math.round(tile.tileCssWidth),
						Math.round(tile.tileCssHeight),
						tile.renderBarWidth,
						waveformColor,
						Math.max(1, window.devicePixelRatio || 1),
					].join("#");

					if (
						!forceRedrawVisibleTiles &&
						!tile.isNew &&
						tile.record.lastDrawKey === tileDrawKey
					) {
						return;
					}

					const peakCount = Math.max(
						1,
						Math.floor(tile.tileCssWidth / tile.renderBarWidth),
					);
					if (fullDuration <= 0) {
						renderPlaceholderCanvas(
							tile.canvas,
							tile.tileCssWidth,
							tile.tileCssHeight,
							tile.renderBarWidth,
							waveformColor,
							0.3,
						);
						tile.record.lastDrawKey = tileDrawKey;
						return;
					}

					const tileStartTime =
						fullDuration * (tile.tileStartPx / tile.surfaceWidth);
					const tileDuration =
						fullDuration * (tile.tileCssWidth / tile.surfaceWidth);
					if (!Number.isFinite(tileDuration) || tileDuration <= 0) {
						renderPlaceholderCanvas(
							tile.canvas,
							tile.tileCssWidth,
							tile.tileCssHeight,
							tile.renderBarWidth,
							waveformColor,
							0.3,
						);
						tile.record.lastDrawKey = tileDrawKey;
						return;
					}

					const peakCacheKey = [
						tileDrawKey,
						Math.round(tileStartTime * 1000000),
						Math.round(tileDuration * 1000000),
						peakCount,
					].join("#");
					let mixed = getCachedWaveformTilePeaks(surfaceMetadata, peakCacheKey);
					if (!mixed) {
						mixed = waveformEngine.calculateMixedWaveform(
							sourceRuntimes,
							peakCount,
							tile.renderBarWidth,
							fullDuration,
							waveformProjector,
							tileStartTime,
							tileDuration,
						);
						if (mixed) {
							setCachedWaveformTilePeaks(surfaceMetadata, peakCacheKey, mixed);
						}
					}

					if (!mixed) {
						renderPlaceholderCanvas(
							tile.canvas,
							tile.tileCssWidth,
							tile.tileCssHeight,
							tile.renderBarWidth,
							waveformColor,
							0.3,
						);
						tile.record.lastDrawKey = tileDrawKey;
						return;
					}

					renderWaveformCanvas(
						tile.canvas,
						tile.tileCssWidth,
						tile.tileCssHeight,
						mixed,
						tile.renderBarWidth,
						waveformColor,
						normalizationPeak,
						1,
						useFixedTrackAxis && !useIndividualAxis
							? Math.max(
									0,
									Math.min(
										tile.tileCssWidth,
										(localTrackDuration / fullDuration) * tile.surfaceWidth -
											tile.tileStartPx,
									),
								)
							: tile.tileCssWidth,
					);
					tile.record.lastDrawKey = tileDrawKey;
				},
			);
			renderWaveformMinimap(
				surfaceMetadata,
				waveformEngine,
				sourceRuntimes,
				fullDuration,
				waveformProjector,
				normalizationPeak,
				normalizationCacheKey,
				useFixedTrackAxis && !useIndividualAxis
					? Math.max(0, Math.min(1, localTrackDuration / fullDuration))
					: 1,
			);
		}
		this.updateWaveformZoomIndicators();
	}).call(
		ctx,
		waveformEngine,
		runtimes,
		timelineDuration,
		trackTimelineProjector,
		waveformTimelineContext,
		performReflow,
		forceRedrawVisibleTiles,
	);
}

export function getWaveformSourceRuntimes(
	ctx: ViewRenderer,
	runtimes: TrackRuntime[],
	waveformSource: WaveformSourceIndex,
): TrackRuntime[] {
	return function (
		this: ViewRenderer,
		runtimes: TrackRuntime[],
		waveformSource: WaveformSourceIndex,
	) {
		return resolveWaveformTrackIndices(runtimes.length, waveformSource)
			.filter((trackIndex: number) =>
				isWaveformTrackAudibleForCtx(
					this,
					runtimes,
					trackIndex,
					waveformSource,
				),
			)
			.map((trackIndex: number) => runtimes[trackIndex]);
	}.call(ctx, runtimes, waveformSource);
}

function drawWaveformAlignmentOverlay(
	surface: WaveformSeekSurfaceMetadata,
	width: number,
	height: number,
	refSegments: Array<{ refPx: number; localPx: number }> = [],
	alignmentSegments: Array<{ refPx: number; trackPx: number }> = [],
): void {
	if (!surface.refHooksCanvas) {
		return;
	}

	const context = resizeCanvasForCssSize(surface.refHooksCanvas, width, height);
	if (!context || width <= 0 || height <= 0) {
		return;
	}

	const computedStyle = getComputedStyle(surface.seekWrap);
	const vertExtentRaw = parseFloat(
		computedStyle.getPropertyValue("--seekhead-vertical-extent").trim(),
	);
	const vertExtent = Number.isFinite(vertExtentRaw)
		? Math.max(0, Math.min(0.5, vertExtentRaw))
		: 0.35;
	const segTop = height * (0.5 - vertExtent);
	const segBot = height * (0.5 + vertExtent);

	if (alignmentSegments.length > 0) {
		context.save();
		context.strokeStyle =
			computedStyle.getPropertyValue("--alignment-points-color").trim() ||
			"rgba(128, 128, 128, 0.5)";
		context.lineWidth = 1;
		context.setLineDash([1, 1]);
		context.beginPath();
		for (let index = 0; index < alignmentSegments.length; index += 1) {
			const segment = alignmentSegments[index];
			context.moveTo(segment.refPx, 0);
			context.lineTo(segment.trackPx, segTop);
			context.lineTo(segment.trackPx, segBot);
			context.lineTo(segment.refPx, height);
		}
		context.stroke();
		context.restore();
	}

	if (refSegments.length > 0) {
		context.save();
		context.strokeStyle =
			computedStyle.getPropertyValue("--seekhead-ref-color").trim() ||
			"#383838";
		context.lineWidth = 2;
		context.setLineDash([]);
		context.beginPath();
		for (let index = 0; index < refSegments.length; index += 1) {
			const segment = refSegments[index];
			context.moveTo(segment.refPx, 0);
			context.lineTo(segment.localPx, segTop);
			context.lineTo(segment.localPx, segBot);
			context.lineTo(segment.refPx, height);
		}
		context.stroke();
		context.restore();
	}
}

export function updateWaveformZoomIndicators(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		this.waveformSeekSurfaces.forEach(
			(surface: WaveformSeekSurfaceMetadata) => {
				if (surface.zoom <= MIN_WAVEFORM_ZOOM + 0.000001) {
					surface.zoomNode.style.display = "none";
					return;
				}

				updateWaveformMinimapViewport(surface);
				surface.zoomNode.style.display = "flex";
			},
		);
	}).call(ctx);
}

export function applyWaveformLocalSeekVisuals(
	ctx: ViewRenderer,
	state: TrackSwitchUiState,
	runtimes: TrackRuntime[],
	waveformTimelineContext: WaveformTimelineContext | undefined,
): void {
	(function (
		this: ViewRenderer,
		state: TrackSwitchUiState,
		runtimes: TrackRuntime[],
		waveformTimelineContext: WaveformTimelineContext | undefined,
	) {
		if (!waveformTimelineContext?.enabled) {
			this.waveformSeekSurfaces.forEach(
				(surface: WaveformSeekSurfaceMetadata) => {
					surface.seekWrap.classList.remove("aligned-playhead");
					if (surface.refHooksCanvas) {
						clearCanvas(
							surface.refHooksCanvas,
							surface.seekWrap.offsetWidth,
							surface.seekWrap.offsetHeight,
						);
					}
					surface.alignmentPointsLastW = -1;
					surface.alignmentPointsLastH = -1;
				},
			);
			return;
		}

		let longestTrackDuration = 0;
		for (let ti = 0; ti < waveformTimelineContext.getTrackCount(); ti++) {
			const d = sanitizeDuration(waveformTimelineContext.getTrackDuration(ti));
			if (d > longestTrackDuration) longestTrackDuration = d;
		}

		this.waveformSeekSurfaces.forEach(
			(surface: WaveformSeekSurfaceMetadata) => {
				const trackIndex = resolveAudibleWaveformTrackIndex(
					runtimes,
					surface.waveformSource,
					this.isAlignmentMode(),
					this.isTrackExclusive,
				);
				if (trackIndex === null) {
					surface.seekWrap.classList.remove("aligned-playhead");
					if (surface.refHooksCanvas) {
						clearCanvas(
							surface.refHooksCanvas,
							surface.seekWrap.offsetWidth,
							surface.seekWrap.offsetHeight,
						);
					}
					return;
				}

				const trackDuration = sanitizeDuration(
					waveformTimelineContext.getTrackDuration(trackIndex),
				);
				if (trackDuration <= 0) {
					surface.seekWrap.classList.remove("aligned-playhead");
					if (surface.refHooksCanvas) {
						clearCanvas(
							surface.refHooksCanvas,
							surface.seekWrap.offsetWidth,
							surface.seekWrap.offsetHeight,
						);
					}
					return;
				}

				const sharedDuration =
					longestTrackDuration > 0 ? longestTrackDuration : trackDuration;
				const seekDuration =
					surface.timeAxis === "individual" ? trackDuration : sharedDuration;
				const referenceDisplayDuration =
					surface.timeAxis === "individual" ? sharedDuration : seekDuration;

				// The playhead comes from the anchor where there is one: projecting
				// the reference position back out collapses any stretch the
				// alignment holds at one reference value onto a single point, which
				// is what makes the head jump while the audio runs through it. Loop
				// points below are reference coordinates and have no anchor.
				const localPosition = clampTime(
					waveformTimelineContext.getPlaybackPosition(trackIndex) ??
						waveformTimelineContext.referenceToTrackTime(
							trackIndex,
							state.position,
						),
					0,
					trackDuration,
				);
				const localPointA =
					state.loop.pointA === null
						? null
						: clampTime(
								waveformTimelineContext.referenceToTrackTime(
									trackIndex,
									state.loop.pointA,
								),
								0,
								trackDuration,
							);
				const localPointB =
					state.loop.pointB === null
						? null
						: clampTime(
								waveformTimelineContext.referenceToTrackTime(
									trackIndex,
									state.loop.pointB,
								),
								0,
								trackDuration,
							);

				let orderedPointA = localPointA;
				let orderedPointB = localPointB;
				if (
					orderedPointA !== null &&
					orderedPointB !== null &&
					orderedPointA > orderedPointB
				) {
					const previousA = orderedPointA;
					orderedPointA = orderedPointB;
					orderedPointB = previousA;
				}

				this.updateSeekWrapVisuals(
					surface.seekWrap,
					localPosition,
					seekDuration,
					{
						pointA: orderedPointA,
						pointB: orderedPointB,
						enabled: state.loop.enabled,
					},
				);

				const needsDimensions =
					(surface.refHooksCanvas &&
						surface.alignedPlayhead &&
						seekDuration > 0) ||
					(surface.refHooksCanvas &&
						surface.showAlignmentPoints &&
						seekDuration > 0);
				const w = needsDimensions ? surface.seekWrap.offsetWidth : 0;
				const h = needsDimensions ? surface.seekWrap.offsetHeight : 0;

				const refSegments: Array<{ refPx: number; localPx: number }> = [];
				const alignmentSegments: Array<{ refPx: number; trackPx: number }> = [];

				if (surface.alignedPlayhead && seekDuration > 0) {
					surface.seekWrap.classList.add("aligned-playhead");
					refSegments.push({
						localPx: (localPosition / seekDuration) * w,
						refPx: (state.position / referenceDisplayDuration) * w,
					});
				} else {
					surface.seekWrap.classList.remove("aligned-playhead");
				}

				if (surface.showAlignmentPoints && seekDuration > 0) {
					const points =
						waveformTimelineContext.getTrackAlignmentPoints(trackIndex);
					for (let pi = 0; pi < points.length; pi++) {
						const pt = points[pi];
						alignmentSegments.push({
							trackPx: (pt.trackTime / seekDuration) * w,
							refPx: (pt.referenceTime / referenceDisplayDuration) * w,
						});
					}
					surface.alignmentPointsLastW = w;
					surface.alignmentPointsLastH = h;
				} else {
					surface.alignmentPointsLastW = -1;
					surface.alignmentPointsLastH = -1;
				}

				if (surface.refHooksCanvas) {
					drawWaveformAlignmentOverlay(
						surface,
						Math.max(1, w),
						Math.max(1, h),
						refSegments,
						alignmentSegments,
					);
				}
			},
		);
	}).call(ctx, state, runtimes, waveformTimelineContext);
}

export function getLongestWaveformSourceDuration(
	ctx: ViewRenderer,
	runtimes: TrackRuntime[],
	waveformSource: WaveformSourceIndex,
): number {
	return function (
		this: ViewRenderer,
		runtimes: TrackRuntime[],
		waveformSource: WaveformSourceIndex,
	) {
		const getRuntimeDuration = (runtime: TrackRuntime): number => {
			return runtime.timing
				? runtime.timing.effectiveDuration
				: runtime.buffer
					? runtime.buffer.duration
					: 0;
		};

		const sourceRuntimes = this.getWaveformSourceRuntimes(
			runtimes,
			waveformSource,
		);
		let longest = 0;
		sourceRuntimes.forEach((runtime: TrackRuntime) => {
			const duration = getRuntimeDuration(runtime);
			if (duration > longest) {
				longest = duration;
			}
		});

		return longest;
	}.call(ctx, runtimes, waveformSource);
}

export function updateWaveformTiming(
	ctx: ViewRenderer,
	state: TrackSwitchUiState,
	runtimes: TrackRuntime[],
	waveformTimelineContext: WaveformTimelineContext | undefined,
): void {
	(function (
		this: ViewRenderer,
		state: TrackSwitchUiState,
		runtimes: TrackRuntime[],
		waveformTimelineContext: WaveformTimelineContext | undefined,
	) {
		this.waveformSeekSurfaces.forEach(
			(surface: WaveformSeekSurfaceMetadata) => {
				if (!surface.timingNode) {
					return;
				}

				const playbackMetrics = resolveWaveformPlaybackMetrics(
					this,
					surface,
					state,
					runtimes,
					waveformTimelineContext,
				);
				// The readout belongs to the timeline the metrics were resolved on:
				// the track's own when one is audible, the reference otherwise.
				const timeline =
					playbackMetrics.trackIndex === null
						? this.referenceTimelineId
						: (runtimes[playbackMetrics.trackIndex]?.definition.id ?? null);
				surface.timingNode.textContent = this.formatLocalTimelinePair(
					timeline,
					playbackMetrics.position,
					playbackMetrics.duration,
				);
			},
		);
	}).call(ctx, state, runtimes, waveformTimelineContext);
}

export function updateWaveformPlaybackFollow(
	ctx: ViewRenderer,
	state: TrackSwitchUiState,
	runtimes: TrackRuntime[],
	waveformTimelineContext: WaveformTimelineContext | undefined,
	suppressFollow: boolean,
): void {
	(function (
		this: ViewRenderer,
		state: TrackSwitchUiState,
		runtimes: TrackRuntime[],
		waveformTimelineContext: WaveformTimelineContext | undefined,
		suppressFollow: boolean,
	) {
		if (suppressFollow) {
			return;
		}

		this.waveformSeekSurfaces.forEach(
			(surface: WaveformSeekSurfaceMetadata) => {
				if (surface.playbackFollowMode === "off") {
					return;
				}

				const playbackMetrics = resolveWaveformPlaybackMetrics(
					this,
					surface,
					state,
					runtimes,
					waveformTimelineContext,
					true,
				);
				if (playbackMetrics.duration <= 0) {
					return;
				}

				applyWaveformPlaybackFollowScroll(
					this,
					surface,
					resolvePlaybackFollowScrollLeft(
						surface,
						playbackMetrics.position / playbackMetrics.duration,
					),
				);
			},
		);
	}).call(ctx, state, runtimes, waveformTimelineContext, suppressFollow);
}
