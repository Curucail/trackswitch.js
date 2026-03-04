import { NormalizedTrackGroupLayout, TrackRuntime, TrackSwitchFeatures, TrackSwitchUiState } from '../domain/types';
import { escapeHtml, sanitizeInlineStyle } from '../shared/dom';
import { formatSecondsToHHMMSSmmm } from '../shared/format';
import { clampPercent } from '../shared/math';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import * as d3 from 'd3';
import * as viewRendererCore from './view-renderer-core';
import * as viewRendererWaveform from './view-renderer-waveform';
import * as viewRendererWarping from './view-renderer-warping';

type SvgSelection = d3.Selection<SVGSVGElement, unknown, null, undefined>;
type GroupSelection = d3.Selection<SVGGElement, unknown, null, undefined>;
type PathSelection = d3.Selection<SVGPathElement, unknown, null, undefined>;
type RectSelection = d3.Selection<SVGRectElement, unknown, null, undefined>;
type LineSelection = d3.Selection<SVGLineElement, unknown, null, undefined>;
type CircleSelection = d3.Selection<SVGCircleElement, unknown, null, undefined>;
type TextSelection = d3.Selection<SVGTextElement, unknown, null, undefined>;

export interface WaveformTimelineContext {
    enabled: boolean;
    referenceToTrackTime(trackIndex: number, referenceTime: number): number;
    getTrackDuration(trackIndex: number): number;
}

export interface SheetMusicHostConfig {
    host: HTMLElement;
    scrollContainer: HTMLElement;
    source: string;
    measureCsv: string;
    renderScale: number | null;
    followPlayback: boolean;
    cursorColor: string;
    cursorAlpha: number;
}

export interface WarpingMatrixDataPoint {
    referenceTime: number;
    trackTime: number;
}

export interface WarpingMatrixTrackSeries {
    trackIndex: number;
    columnKey: string;
    points: WarpingMatrixDataPoint[];
    trackDuration: number;
}

export interface WarpingMatrixRenderContext {
    enabled: boolean;
    syncEnabled: boolean;
    referenceDuration: number;
    currentReferenceTime: number;
    columnOrder: string[];
    trackSeries: WarpingMatrixTrackSeries[];
}

interface WaveformSeekSurfaceMetadata {
    wrapper: HTMLElement;
    scrollContainer: HTMLElement;
    overlay: HTMLElement;
    surface: HTMLElement;
    tileLayer: HTMLElement;
    seekWrap: HTMLElement;
    waveformSource: 'audible' | number;
    originalHeight: number;
    barWidth: number;
    maxZoom: number;
    baseWidth: number;
    zoom: number;
    timingNode: HTMLElement | null;
    zoomNode: HTMLElement;
    tiles: Map<number, { canvas: HTMLCanvasElement; lastDrawKey: string | null }>;
    normalizationPeak: number;
    normalizationCacheKey: string | null;
}

interface LatestWaveformRenderInput {
    waveformEngine: WaveformEngine;
    runtimes: TrackRuntime[];
    timelineDuration: number;
    trackTimelineProjector?: TrackTimelineProjector;
    waveformTimelineContext?: WaveformTimelineContext;
}

interface WarpingMatrixPathPoint {
    referenceTime: number;
    trackTime: number;
}

interface WarpingMatrixPathSeriesData {
    pointsByReferenceTime: WarpingMatrixPathPoint[];
    pointsByTrackTime: WarpingMatrixPathPoint[];
    trackDuration: number;
}

interface WarpingMatrixMatrixData {
    byColumn: Map<string, WarpingMatrixPathSeriesData>;
}

interface WarpingMatrixTempoPoint {
    trackTime: number;
    referenceTime: number;
    tempoPercent: number;
}

interface WarpingMatrixTempoData {
    byColumn: Map<string, WarpingMatrixTempoPoint[]>;
}

interface WarpingPlotMargins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface WarpingMatrixPlotState {
    svg: SvgSelection;
    title: TextSelection;
    xAxis: GroupSelection;
    yAxis: GroupSelection;
    xLabel: TextSelection;
    yLabel: TextSelection;
    plotRoot: GroupSelection;
    pathLayer: GroupSelection;
    clipRect: RectSelection;
    pathByColumn: Map<string, PathSelection>;
    guideDiagonal: LineSelection;
    playhead: CircleSelection;
    xScale: d3.ScaleLinear<number, number>;
    yScale: d3.ScaleLinear<number, number>;
    margins: WarpingPlotMargins;
    innerWidth: number;
    innerHeight: number;
}

interface WarpingTempoPlotState {
    svg: SvgSelection;
    title: TextSelection;
    xAxis: GroupSelection;
    yAxis: GroupSelection;
    xLabel: TextSelection;
    yLabel: TextSelection;
    plotRoot: GroupSelection;
    clipRect: RectSelection;
    path: PathSelection;
    baseline: LineSelection;
    centerLine: LineSelection;
    xScale: d3.ScaleLinear<number, number>;
    yScale: d3.ScaleLinear<number, number>;
    margins: WarpingPlotMargins;
    innerWidth: number;
    innerHeight: number;
}

interface WarpingMatrixHostMetadata {
    wrapper: HTMLElement;
    host: HTMLElement;
    matrixPanel: HTMLElement;
    matrixPlotHost: HTMLElement;
    matrixPlot: WarpingMatrixPlotState | null;
    matrixDisabledOverlay: HTMLElement;
    tempoPanel: HTMLElement;
    tempoPlotHost: HTMLElement;
    tempoPlot: WarpingTempoPlotState | null;
    tempoDisabledOverlay: HTMLElement;
    tempoControls: HTMLElement;
    tempoWindowSlider: HTMLInputElement;
    tempoWindowValueNode: HTMLElement;
    tempoYScaleSlider: HTMLInputElement;
    tempoYScaleValueNode: HTMLElement;
    matrixSeriesSignature: string | null;
    matrixDataCache: WarpingMatrixMatrixData | null;
    matrixDataCacheKey: string | null;
    tempoDataCache: WarpingMatrixTempoData | null;
    tempoDataCacheKey: string | null;
    matrixDisabled: boolean;
    matrixTrackDuration: number;
    configuredHeight: number | null;
    tempoWindowSeconds: number;
    tempoYHalfRangePercent: number;
    colorByColumn: Map<string, string>;
    activeColumnKey: string | null;
    referenceDuration: number;
    currentReferenceTime: number;
    currentTrackTime: number;
    matrixActivePointerId: number | null;
    lastSizeKey: string | null;
}

export class ViewRenderer {

    private readonly root: HTMLElement;
    private readonly features: TrackSwitchFeatures;
    private readonly presetNames: string[];
    private readonly trackGroups: NormalizedTrackGroupLayout[];

    private originalImage = '';
    private readonly waveformSeekSurfaces: WaveformSeekSurfaceMetadata[] = [];
    private readonly sheetMusicHosts: SheetMusicHostConfig[] = [];
    private readonly warpingMatrixHosts: WarpingMatrixHostMetadata[] = [];
    private waveformTileRefreshFrameId: number | null = null;
    private latestWaveformRenderInput: LatestWaveformRenderInput | null = null;
    private readonly onWarpingMatrixSeek?: (referenceTime: number) => void;
    private warpingClipPathCounter = 0;
    private readonly warpingMatrixTempoControlState = new WeakMap<
        HTMLElement,
        { windowSeconds: number; yHalfRangePercent: number }
    >();

    constructor(
        root: HTMLElement,
        features: TrackSwitchFeatures,
        presetNames: string[],
        trackGroups: NormalizedTrackGroupLayout[] = [],
        onWarpingMatrixSeek?: (referenceTime: number) => void
    ) {
        this.root = root;
        this.features = features;
        this.presetNames = presetNames;
        this.trackGroups = trackGroups;
        this.onWarpingMatrixSeek = onWarpingMatrixSeek;
    }

private query(selector: string): HTMLElement | null {
        return viewRendererCore.query(this, selector);
    }

private queryAll(selector: string): HTMLElement[] {
        return viewRendererCore.queryAll(this, selector);
    }

private getWarpingMatrixPathStrokeWidth(): number {
        return viewRendererWarping.getWarpingMatrixPathStrokeWidth(this);
    }

private getWarpingMatrixLocalTempoWindowSeconds(host: WarpingMatrixHostMetadata): number {
        return viewRendererWarping.getWarpingMatrixLocalTempoWindowSeconds(this, host);
    }

private getWarpingMatrixLocalTempoSlopeHalfWindowPoints(): number {
        return viewRendererWarping.getWarpingMatrixLocalTempoSlopeHalfWindowPoints(this);
    }

private getWarpingMatrixTempoYHalfRangePercent(host: WarpingMatrixHostMetadata): number {
        return viewRendererWarping.getWarpingMatrixTempoYHalfRangePercent(this, host);
    }

private updateWarpingMatrixTempoControlLabels(host: WarpingMatrixHostMetadata): void {
        return viewRendererWarping.updateWarpingMatrixTempoControlLabels(this, host);
    }

private persistWarpingMatrixTempoControls(host: WarpingMatrixHostMetadata): void {
        return viewRendererWarping.persistWarpingMatrixTempoControls(this, host);
    }

private getWarpingMatrixSquarePlotSize(plot: WarpingMatrixPlotState): number {
        return viewRendererWarping.getWarpingMatrixSquarePlotSize(this, plot);
    }

private resolveWarpingMatrixColumnColor(_columnKey: string, _columnOrder: string[]): string {
        return viewRendererWarping.resolveWarpingMatrixColumnColor(this, _columnKey, _columnOrder);
    }

private getCanvasPixelRatio(): number {
        return viewRendererWaveform.getCanvasPixelRatio(this);
    }

initialize(runtimes: TrackRuntime[]): void {
        return viewRendererCore.initialize(this, runtimes);
    }

private buildMainControlHtml(runtimes: TrackRuntime[]): string {
        return viewRendererCore.buildMainControlHtml(this, runtimes);
    }

private shouldRenderGlobalSync(runtimes: TrackRuntime[]): boolean {
        return viewRendererCore.shouldRenderGlobalSync(this, runtimes);
    }

private buildTrackRow(runtime: TrackRuntime, index: number): HTMLElement {
        return viewRendererCore.buildTrackRow(this, runtime, index);
    }

private renderTrackList(runtimes: TrackRuntime[]): void {
        return viewRendererCore.renderTrackList(this, runtimes);
    }

private wrapSeekableImages(): void {
        return viewRendererCore.wrapSeekableImages(this);
    }

private wrapWaveformCanvases(): void {
        return viewRendererWaveform.wrapWaveformCanvases(this);
    }

private wrapSheetMusicContainers(): void {
        return viewRendererCore.wrapSheetMusicContainers(this);
    }

getPreparedSheetMusicHosts(): SheetMusicHostConfig[] {
        return viewRendererCore.getPreparedSheetMusicHosts(this);
    }

private wrapWarpingMatrixContainers(): void {
        return viewRendererWarping.wrapWarpingMatrixContainers(this);
    }

private createWarpingMatrixPlotState(
        plotHost: HTMLElement,
        width: number,
        height: number
    ): WarpingMatrixPlotState {
        return viewRendererWarping.createWarpingMatrixPlotState(this, plotHost, width, height);
    }

private createWarpingTempoPlotState(
        plotHost: HTMLElement,
        width: number,
        height: number
    ): WarpingTempoPlotState {
        return viewRendererWarping.createWarpingTempoPlotState(this, plotHost, width, height);
    }

private applyWarpingMatrixPlotDimensions(
        plot: WarpingMatrixPlotState,
        width: number,
        height: number
    ): void {
        return viewRendererWarping.applyWarpingMatrixPlotDimensions(this, plot, width, height);
    }

private applyWarpingTempoPlotDimensions(
        plot: WarpingTempoPlotState,
        width: number,
        height: number
    ): void {
        return viewRendererWarping.applyWarpingTempoPlotDimensions(this, plot, width, height);
    }

private isPointerInsidePlotArea(
        plotHost: HTMLElement,
        margins: WarpingPlotMargins,
        innerWidth: number,
        innerHeight: number,
        clientX: number,
        clientY: number
    ): boolean {
        return viewRendererWarping.isPointerInsidePlotArea(this, plotHost, margins, innerWidth, innerHeight, clientX, clientY);
    }

private onWarpingMatrixPointerDown(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        return viewRendererWarping.onWarpingMatrixPointerDown(this, host, event);
    }

private onWarpingMatrixPointerMove(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        return viewRendererWarping.onWarpingMatrixPointerMove(this, host, event);
    }

private onWarpingMatrixPointerUp(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        return viewRendererWarping.onWarpingMatrixPointerUp(this, host, event);
    }

private seekWarpingMatrixFromPointerX(host: WarpingMatrixHostMetadata, clientX: number): void {
        return viewRendererWarping.seekWarpingMatrixFromPointerX(this, host, clientX);
    }

private onWarpingTempoPointerDown(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        return viewRendererWarping.onWarpingTempoPointerDown(this, host, event);
    }

private onWarpingTempoWheel(host: WarpingMatrixHostMetadata, event: WheelEvent): void {
        return viewRendererWarping.onWarpingTempoWheel(this, host, event);
    }

private seekWarpingMatrixFromTempoPointerX(host: WarpingMatrixHostMetadata, clientX: number): void {
        return viewRendererWarping.seekWarpingMatrixFromTempoPointerX(this, host, clientX);
    }

private getPrimaryWarpingSeriesData(host: WarpingMatrixHostMetadata): WarpingMatrixPathSeriesData | null {
        return viewRendererWarping.getPrimaryWarpingSeriesData(this, host);
    }

private getPrimaryTempoSeries(host: WarpingMatrixHostMetadata): WarpingMatrixTempoPoint[] {
        return viewRendererWarping.getPrimaryTempoSeries(this, host);
    }

private updateWarpingMatrix(
        host: WarpingMatrixHostMetadata,
        context: WarpingMatrixRenderContext | undefined
    ): void {
        return viewRendererWarping.updateWarpingMatrix(this, host, context);
    }

private renderWarpingMatrixPathPlot(host: WarpingMatrixHostMetadata, pathStrokeWidth: number): void {
        return viewRendererWarping.renderWarpingMatrixPathPlot(this, host, pathStrokeWidth);
    }

private renderWarpingMatrixTempoPlot(host: WarpingMatrixHostMetadata): void {
        return viewRendererWarping.renderWarpingMatrixTempoPlot(this, host);
    }

private resolveCenteredWarpingWindow(
        center: number,
        windowSeconds: number,
        _maxTime: number
    ): [number, number] {
        return viewRendererWarping.resolveCenteredWarpingWindow(this, center, windowSeconds, _maxTime);
    }

private buildWarpingMatrixData(
        trackSeries: WarpingMatrixTrackSeries[],
        referenceDuration: number
    ): WarpingMatrixMatrixData {
        return viewRendererWarping.buildWarpingMatrixData(this, trackSeries, referenceDuration);
    }

private buildWarpingTempoData(
        trackSeries: WarpingMatrixTrackSeries[],
        halfWindowPoints: number
    ): WarpingMatrixTempoData {
        return viewRendererWarping.buildWarpingTempoData(this, trackSeries, halfWindowPoints);
    }

private interpolateWarpingTrackTime(points: WarpingMatrixPathPoint[], referenceTime: number): number {
        return viewRendererWarping.interpolateWarpingTrackTime(this, points, referenceTime);
    }

private interpolateWarpingReferenceTime(pointsByTrackTime: WarpingMatrixPathPoint[], trackTime: number): number {
        return viewRendererWarping.interpolateWarpingReferenceTime(this, pointsByTrackTime, trackTime);
    }

private createWaveformTimingNode(overlay: HTMLElement): HTMLElement {
        return viewRendererWaveform.createWaveformTimingNode(this, overlay);
    }

private createWaveformZoomNode(overlay: HTMLElement): HTMLElement {
        return viewRendererWaveform.createWaveformZoomNode(this, overlay);
    }

private resolveWaveformBaseWidth(scrollContainer: HTMLElement, fallback: number): number {
        return viewRendererWaveform.resolveWaveformBaseWidth(this, scrollContainer, fallback);
    }

private setWaveformSurfaceWidth(surfaceMetadata: WaveformSeekSurfaceMetadata): void {
        return viewRendererWaveform.setWaveformSurfaceWidth(this, surfaceMetadata);
    }

private forEachVisibleWaveformTile(
        surfaceMetadata: WaveformSeekSurfaceMetadata,
        pixelRatio: number,
        callback: (tile: {
            tileIndex: number;
            tileStartPx: number;
            tileCssWidth: number;
            surfaceWidth: number;
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
            renderBarWidth: number;
            isNew: boolean;
            record: { canvas: HTMLCanvasElement; lastDrawKey: string | null };
        }) => void
    ): void {
        return viewRendererWaveform.forEachVisibleWaveformTile(this, surfaceMetadata, pixelRatio, callback);
    }

private scheduleVisibleWaveformTileRefresh(): void {
        return viewRendererWaveform.scheduleVisibleWaveformTileRefresh(this);
    }

private refreshVisibleWaveformTilesFromLatestInput(): void {
        return viewRendererWaveform.refreshVisibleWaveformTilesFromLatestInput(this);
    }

private computeNormalizationPeak(
        waveformEngine: WaveformEngine,
        sourceRuntimes: TrackRuntime[],
        renderBarWidth: number,
        duration: number,
        baseProjector: TrackTimelineProjector,
        baseWidth: number
    ): number {
        return viewRendererWaveform.computeNormalizationPeak(this, waveformEngine, sourceRuntimes, renderBarWidth, duration, baseProjector, baseWidth);
    }

private buildWaveformNormalizationCacheKey(
        surfaceMetadata: WaveformSeekSurfaceMetadata,
        runtimes: TrackRuntime[],
        sourceRuntimes: TrackRuntime[],
        fullDuration: number,
        renderBarWidth: number,
        useLocalAxis: boolean,
        hasTimelineProjector: boolean
    ): string {
        return viewRendererWaveform.buildWaveformNormalizationCacheKey(this, surfaceMetadata, runtimes, sourceRuntimes, fullDuration, renderBarWidth, useLocalAxis, hasTimelineProjector);
    }

private findWaveformSurface(
        seekWrap: HTMLElement | null
    ): WaveformSeekSurfaceMetadata | null {
        return viewRendererWaveform.findWaveformSurface(this, seekWrap);
    }

reflowWaveforms(): void {
        return viewRendererWaveform.reflowWaveforms(this);
    }

getWaveformZoom(seekWrap: HTMLElement): number | null {
        return viewRendererWaveform.getWaveformZoom(this, seekWrap);
    }

isWaveformZoomEnabled(seekWrap: HTMLElement): boolean {
        return viewRendererWaveform.isWaveformZoomEnabled(this, seekWrap);
    }

setWaveformZoom(seekWrap: HTMLElement, zoom: number, anchorPageX?: number): boolean {
        return viewRendererWaveform.setWaveformZoom(this, seekWrap, zoom, anchorPageX);
    }

drawDummyWaveforms(waveformEngine: WaveformEngine): void {
        return viewRendererWaveform.drawDummyWaveforms(this, waveformEngine);
    }

renderWaveforms(
        waveformEngine: WaveformEngine,
        runtimes: TrackRuntime[],
        timelineDuration: number,
        trackTimelineProjector?: TrackTimelineProjector,
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        return viewRendererWaveform.renderWaveforms(this, waveformEngine, runtimes, timelineDuration, trackTimelineProjector, waveformTimelineContext);
    }

private renderWaveformsInternal(
        waveformEngine: WaveformEngine,
        runtimes: TrackRuntime[],
        timelineDuration: number,
        trackTimelineProjector?: TrackTimelineProjector,
        waveformTimelineContext?: WaveformTimelineContext,
        performReflow = true,
        forceRedrawVisibleTiles = true
    ): void {
        return viewRendererWaveform.renderWaveformsInternal(this, waveformEngine, runtimes, timelineDuration, trackTimelineProjector, waveformTimelineContext, performReflow, forceRedrawVisibleTiles);
    }

private getWaveformSourceRuntimes(
        runtimes: TrackRuntime[],
        waveformSource: 'audible' | number
    ): TrackRuntime[] {
        return viewRendererWaveform.getWaveformSourceRuntimes(this, runtimes, waveformSource);
    }

private resolveWaveformTrackIndex(
        runtimes: TrackRuntime[],
        waveformSource: 'audible' | number
    ): number | null {
        return viewRendererWaveform.resolveWaveformTrackIndex(this, runtimes, waveformSource);
    }

updateMainControls(
        state: TrackSwitchUiState,
        runtimes: TrackRuntime[],
        waveformTimelineContext?: WaveformTimelineContext,
        warpingMatrixContext?: WarpingMatrixRenderContext
    ): void {
        return viewRendererCore.updateMainControls(this, state, runtimes, waveformTimelineContext, warpingMatrixContext);
    }

private updateWaveformZoomIndicators(): void {
        return viewRendererWaveform.updateWaveformZoomIndicators(this);
    }

private applyFixedWaveformLocalSeekVisuals(
        state: TrackSwitchUiState,
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        return viewRendererWaveform.applyFixedWaveformLocalSeekVisuals(this, state, waveformTimelineContext);
    }

private getLongestWaveformSourceDuration(
        runtimes: TrackRuntime[],
        waveformSource: 'audible' | number
    ): number {
        return viewRendererWaveform.getLongestWaveformSourceDuration(this, runtimes, waveformSource);
    }

private updateWaveformTiming(
        state: TrackSwitchUiState,
        runtimes: TrackRuntime[],
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        return viewRendererWaveform.updateWaveformTiming(this, state, runtimes, waveformTimelineContext);
    }

private updateSeekWrapVisuals(
        seekWrap: Element,
        position: number,
        duration: number,
        loop: { pointA: number | null; pointB: number | null; enabled: boolean }
    ): void {
        return viewRendererWaveform.updateSeekWrapVisuals(this, seekWrap, position, duration, loop);
    }

updateTrackControls(
        runtimes: TrackRuntime[],
        syncLockedTrackIndexes?: ReadonlySet<number>,
        effectiveSingleSoloMode = this.features.exclusiveSolo,
        panSupported = true
    ): void {
        return viewRendererCore.updateTrackControls(this, runtimes, syncLockedTrackIndexes, effectiveSingleSoloMode, panSupported);
    }

switchPosterImage(runtimes: TrackRuntime[]): void {
        return viewRendererCore.switchPosterImage(this, runtimes);
    }

setVolumeSlider(volumeZeroToOne: number): void {
        return viewRendererCore.setVolumeSlider(this, volumeZeroToOne);
    }

setTrackVolumeSlider(trackIndex: number, volumeZeroToOne: number): void {
        return viewRendererCore.setTrackVolumeSlider(this, trackIndex, volumeZeroToOne);
    }

setTrackPanSlider(trackIndex: number, panMinusOneToOne: number): void {
        return viewRendererCore.setTrackPanSlider(this, trackIndex, panMinusOneToOne);
    }

updateVolumeIcon(volumeZeroToOne: number): void {
        return viewRendererCore.updateVolumeIcon(this, volumeZeroToOne);
    }

private applyVolumeIconState(icon: HTMLElement, volumeZeroToOne: number): void {
        return viewRendererCore.applyVolumeIconState(this, icon, volumeZeroToOne);
    }

setOverlayLoading(isLoading: boolean): void {
        return viewRendererCore.setOverlayLoading(this, isLoading);
    }

showOverlayInfoText(): void {
        return viewRendererCore.showOverlayInfoText(this);
    }

hideOverlayOnLoaded(): void {
        return viewRendererCore.hideOverlayOnLoaded(this);
    }

showError(message: string, runtimes: TrackRuntime[]): void {
        return viewRendererCore.showError(this, message, runtimes);
    }

destroy(): void {
        return viewRendererCore.destroy(this);
    }

getPresetCount(): number {
        return viewRendererCore.getPresetCount(this);
    }

updateTiming(position: number, longestDuration: number): void {
        return viewRendererCore.updateTiming(this, position, longestDuration);
    }
}
