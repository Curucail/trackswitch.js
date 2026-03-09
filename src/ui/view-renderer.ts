import {
    AudioDownloadSizeInfo,
    NormalizedTrackGroupLayout,
    TrackRuntime,
    TrackSwitchFeatures,
    TrackSwitchUiState,
} from '../domain/types';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import * as d3 from 'd3';
import * as viewRendererCore from './render-layout';
import * as viewRendererWaveform from './render-waveforms';
import * as viewRendererWarping from './render-warping-matrix';

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
    maxZoomSeconds: number;
    baseWidth: number;
    zoom: number;
    timingNode: HTMLElement | null;
    zoomNode: HTMLElement;
    zoomMinimapNode: HTMLElement;
    zoomCanvas: HTMLCanvasElement;
    zoomViewportNode: HTMLElement;
    zoomCanvasLastDrawKey: string | null;
    waveformColor: string | null;
    tiles: Map<number, {
        canvas: HTMLCanvasElement;
        context: CanvasRenderingContext2D | null;
        lastDrawKey: string | null;
    }>;
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
    syncDisabledOverlay: HTMLElement;
    matrixPanel: HTMLElement;
    matrixPlotHost: HTMLElement;
    matrixPlot: WarpingMatrixPlotState | null;
    tempoPanel: HTMLElement;
    tempoPlotHost: HTMLElement;
    tempoPlot: WarpingTempoPlotState | null;
    tempoControls: HTMLElement;
    tempoWindowSlider: HTMLInputElement;
    tempoWindowValueNode: HTMLElement;
    tempoYScaleSlider: HTMLInputElement;
    tempoYScaleValueNode: HTMLElement;
    tempoSmoothingSlider: HTMLInputElement;
    tempoSmoothingValueNode: HTMLElement;
    matrixSeriesSignature: string | null;
    matrixDataCache: WarpingMatrixMatrixData | null;
    matrixDataCacheKey: string | null;
    tempoDataCache: WarpingMatrixTempoData | null;
    tempoDataCacheKey: string | null;
    matrixDisabled: boolean;
    trackSeries: WarpingMatrixTrackSeries[];
    matrixTrackDuration: number;
    configuredHeight: number | null;
    tempoWindowSeconds: number;
    tempoYHalfRangePercent: number;
    tempoSmoothingHalfWindowPoints: number;
    colorByColumn: Map<string, string>;
    activeColumnKey: string | null;
    referenceDuration: number;
    currentReferenceTime: number;
    currentTrackTime: number;
    matrixActivePointerId: number | null;
    lastSizeKey: string | null;
    layoutDirty: boolean;
    staticPlotDirty: boolean;
    tempoSmoothingAutoInitialized: boolean;
    tempoSmoothingUsesAutoDefault: boolean;
}

export class ViewRenderer {

    public readonly root: HTMLElement;
    public readonly features: TrackSwitchFeatures;
    public readonly presetNames: string[];
    public readonly trackGroups: NormalizedTrackGroupLayout[];

    public readonly waveformSeekSurfaces: WaveformSeekSurfaceMetadata[] = [];
    public readonly sheetMusicHosts: SheetMusicHostConfig[] = [];
    public readonly warpingMatrixHosts: WarpingMatrixHostMetadata[] = [];
    public waveformTileRefreshFrameId: number | null = null;
    public latestWaveformRenderInput: LatestWaveformRenderInput | null = null;
    public readonly onWarpingMatrixSeek?: (referenceTime: number) => void;
    public warpingClipPathCounter = 0;
    public readonly warpingMatrixTempoControlState = new WeakMap<
        HTMLElement,
        { windowSeconds: number; yHalfRangePercent: number; smoothingHalfWindowPoints: number }
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

public query(selector: string): HTMLElement | null {
        return viewRendererCore.query(this, selector);
    }

public queryAll(selector: string): HTMLElement[] {
        return viewRendererCore.queryAll(this, selector);
    }

public getWarpingMatrixPathStrokeWidth(): number {
        return viewRendererWarping.getWarpingMatrixPathStrokeWidth(this);
    }

public getWarpingMatrixLocalTempoWindowSeconds(host: WarpingMatrixHostMetadata): number {
        return viewRendererWarping.getWarpingMatrixLocalTempoWindowSeconds(this, host);
    }

public getWarpingMatrixLocalTempoSlopeHalfWindowPoints(host: WarpingMatrixHostMetadata): number {
        return viewRendererWarping.getWarpingMatrixLocalTempoSlopeHalfWindowPoints(this, host);
    }

public getWarpingMatrixTempoYHalfRangePercent(host: WarpingMatrixHostMetadata): number {
        return viewRendererWarping.getWarpingMatrixTempoYHalfRangePercent(this, host);
    }

public updateWarpingMatrixTempoControlLabels(host: WarpingMatrixHostMetadata): void {
        return viewRendererWarping.updateWarpingMatrixTempoControlLabels(this, host);
    }

public persistWarpingMatrixTempoControls(host: WarpingMatrixHostMetadata): void {
        return viewRendererWarping.persistWarpingMatrixTempoControls(this, host);
    }

public getWarpingMatrixSquarePlotSize(plot: WarpingMatrixPlotState): number {
        return viewRendererWarping.getWarpingMatrixSquarePlotSize(this, plot);
    }

public resolveWarpingMatrixColumnColor(_columnKey: string, _columnOrder: string[]): string {
        return viewRendererWarping.resolveWarpingMatrixColumnColor(this, _columnKey, _columnOrder);
    }

public getCanvasPixelRatio(): number {
        return viewRendererWaveform.getCanvasPixelRatio(this);
    }

initialize(runtimes: TrackRuntime[]): void {
        return viewRendererCore.initialize(this, runtimes);
    }

public buildMainControlHtml(runtimes: TrackRuntime[]): string {
        return viewRendererCore.buildMainControlHtml(this, runtimes);
    }

public shouldRenderGlobalSync(runtimes: TrackRuntime[]): boolean {
        return viewRendererCore.shouldRenderGlobalSync(this, runtimes);
    }

public buildTrackRow(runtime: TrackRuntime, index: number): HTMLElement {
        return viewRendererCore.buildTrackRow(this, runtime, index);
    }

public renderTrackList(runtimes: TrackRuntime[]): void {
        return viewRendererCore.renderTrackList(this, runtimes);
    }

public wrapSeekableImages(): void {
        return viewRendererCore.wrapSeekableImages(this);
    }

public wrapWaveformCanvases(): void {
        return viewRendererWaveform.wrapWaveformCanvases(this);
    }

public wrapSheetMusicContainers(): void {
        return viewRendererCore.wrapSheetMusicContainers(this);
    }

getPreparedSheetMusicHosts(): SheetMusicHostConfig[] {
        return viewRendererCore.getPreparedSheetMusicHosts(this);
    }

public wrapWarpingMatrixContainers(): void {
        return viewRendererWarping.wrapWarpingMatrixContainers(this);
    }

public createWarpingMatrixPlotState(
        plotHost: HTMLElement,
        width: number,
        height: number
    ): WarpingMatrixPlotState {
        return viewRendererWarping.createWarpingMatrixPlotState(this, plotHost, width, height);
    }

public createWarpingTempoPlotState(
        plotHost: HTMLElement,
        width: number,
        height: number
    ): WarpingTempoPlotState {
        return viewRendererWarping.createWarpingTempoPlotState(this, plotHost, width, height);
    }

public applyWarpingMatrixPlotDimensions(
        plot: WarpingMatrixPlotState,
        width: number,
        height: number
    ): void {
        return viewRendererWarping.applyWarpingMatrixPlotDimensions(this, plot, width, height);
    }

public applyWarpingTempoPlotDimensions(
        plot: WarpingTempoPlotState,
        width: number,
        height: number
    ): void {
        return viewRendererWarping.applyWarpingTempoPlotDimensions(this, plot, width, height);
    }

public isPointerInsidePlotArea(
        plotHost: HTMLElement,
        margins: WarpingPlotMargins,
        innerWidth: number,
        innerHeight: number,
        clientX: number,
        clientY: number
    ): boolean {
        return viewRendererWarping.isPointerInsidePlotArea(this, plotHost, margins, innerWidth, innerHeight, clientX, clientY);
    }

public onWarpingMatrixPointerDown(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        return viewRendererWarping.onWarpingMatrixPointerDown(this, host, event);
    }

public onWarpingMatrixPointerMove(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        return viewRendererWarping.onWarpingMatrixPointerMove(this, host, event);
    }

public onWarpingMatrixPointerUp(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        return viewRendererWarping.onWarpingMatrixPointerUp(this, host, event);
    }

public seekWarpingMatrixFromPointerX(host: WarpingMatrixHostMetadata, clientX: number): void {
        return viewRendererWarping.seekWarpingMatrixFromPointerX(this, host, clientX);
    }

public onWarpingTempoPointerDown(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        return viewRendererWarping.onWarpingTempoPointerDown(this, host, event);
    }

public onWarpingTempoWheel(host: WarpingMatrixHostMetadata, event: WheelEvent): void {
        return viewRendererWarping.onWarpingTempoWheel(this, host, event);
    }

public seekWarpingMatrixFromTempoPointerX(host: WarpingMatrixHostMetadata, clientX: number): void {
        return viewRendererWarping.seekWarpingMatrixFromTempoPointerX(this, host, clientX);
    }

public getPrimaryWarpingSeriesData(host: WarpingMatrixHostMetadata): WarpingMatrixPathSeriesData | null {
        return viewRendererWarping.getPrimaryWarpingSeriesData(this, host);
    }

public getPrimaryTempoSeries(host: WarpingMatrixHostMetadata): WarpingMatrixTempoPoint[] {
        return viewRendererWarping.getPrimaryTempoSeries(this, host);
    }

public ensureWarpingLayout(host: WarpingMatrixHostMetadata): void {
        return viewRendererWarping.ensureWarpingLayout(this, host);
    }

public applyWarpingMatrixContext(
        host: WarpingMatrixHostMetadata,
        context: WarpingMatrixRenderContext
    ): void {
        return viewRendererWarping.applyWarpingMatrixContext(this, host, context);
    }

public updateWarpingMatrix(
        host: WarpingMatrixHostMetadata,
        context: WarpingMatrixRenderContext | undefined
    ): void {
        return viewRendererWarping.updateWarpingMatrix(this, host, context);
    }

public updateWarpingMatrixPlaybackState(
        host: WarpingMatrixHostMetadata,
        context: WarpingMatrixRenderContext | undefined
    ): void {
        return viewRendererWarping.updateWarpingMatrixPlaybackState(this, host, context);
    }

public renderWarpingMatrixPathPlot(host: WarpingMatrixHostMetadata, pathStrokeWidth: number): void {
        return viewRendererWarping.renderWarpingMatrixPathPlot(this, host, pathStrokeWidth);
    }

public renderWarpingMatrixPlayhead(host: WarpingMatrixHostMetadata): void {
        return viewRendererWarping.renderWarpingMatrixPlayhead(this, host);
    }

public renderWarpingMatrixTempoPlot(host: WarpingMatrixHostMetadata): void {
        return viewRendererWarping.renderWarpingMatrixTempoPlot(this, host);
    }

public resolveCenteredWarpingWindow(
        center: number,
        windowSeconds: number,
        _maxTime: number
    ): [number, number] {
        return viewRendererWarping.resolveCenteredWarpingWindow(this, center, windowSeconds, _maxTime);
    }

public buildWarpingMatrixData(
        trackSeries: WarpingMatrixTrackSeries[],
        referenceDuration: number
    ): WarpingMatrixMatrixData {
        return viewRendererWarping.buildWarpingMatrixData(this, trackSeries, referenceDuration);
    }

public buildWarpingTempoData(
        matrixData: WarpingMatrixMatrixData | null,
        halfWindowPoints: number
    ): WarpingMatrixTempoData {
        return viewRendererWarping.buildWarpingTempoData(this, matrixData, halfWindowPoints);
    }

public interpolateWarpingTrackTime(points: WarpingMatrixPathPoint[], referenceTime: number): number {
        return viewRendererWarping.interpolateWarpingTrackTime(this, points, referenceTime);
    }

public interpolateWarpingReferenceTime(pointsByTrackTime: WarpingMatrixPathPoint[], trackTime: number): number {
        return viewRendererWarping.interpolateWarpingReferenceTime(this, pointsByTrackTime, trackTime);
    }

public createWaveformTimingNode(overlay: HTMLElement): HTMLElement {
        return viewRendererWaveform.createWaveformTimingNode(this, overlay);
    }

public createWaveformZoomNode(overlay: HTMLElement): HTMLElement {
        return viewRendererWaveform.createWaveformZoomNode(this, overlay);
    }

public resolveWaveformBaseWidth(scrollContainer: HTMLElement, fallback: number): number {
        return viewRendererWaveform.resolveWaveformBaseWidth(this, scrollContainer, fallback);
    }

public setWaveformSurfaceWidth(surfaceMetadata: WaveformSeekSurfaceMetadata): void {
        return viewRendererWaveform.setWaveformSurfaceWidth(this, surfaceMetadata);
    }

public forEachVisibleWaveformTile(
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

public scheduleVisibleWaveformTileRefresh(): void {
        return viewRendererWaveform.scheduleVisibleWaveformTileRefresh(this);
    }

public refreshVisibleWaveformTilesFromLatestInput(): void {
        return viewRendererWaveform.refreshVisibleWaveformTilesFromLatestInput(this);
    }

public computeNormalizationPeak(
        waveformEngine: WaveformEngine,
        sourceRuntimes: TrackRuntime[],
        renderBarWidth: number,
        duration: number,
        baseProjector: TrackTimelineProjector,
        baseWidth: number
    ): number {
        return viewRendererWaveform.computeNormalizationPeak(this, waveformEngine, sourceRuntimes, renderBarWidth, duration, baseProjector, baseWidth);
    }

public buildWaveformNormalizationCacheKey(
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

public findWaveformSurface(
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

    isWaveformZoomEnabled(seekWrap: HTMLElement, durationSeconds: number): boolean {
        return viewRendererWaveform.isWaveformZoomEnabled(this, seekWrap, durationSeconds);
    }

    public getWaveformMinimapViewport(
        seekWrap: HTMLElement
    ): { startRatio: number; widthRatio: number } | null {
        return viewRendererWaveform.getWaveformMinimapViewport(this, seekWrap);
    }

    setWaveformMinimapViewportStart(seekWrap: HTMLElement, startRatio: number): boolean {
        return viewRendererWaveform.setWaveformMinimapViewportStart(this, seekWrap, startRatio);
    }

    setWaveformZoom(seekWrap: HTMLElement, zoom: number, durationSeconds: number, anchorPageX?: number): boolean {
        return viewRendererWaveform.setWaveformZoom(this, seekWrap, zoom, durationSeconds, anchorPageX);
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

public renderWaveformsInternal(
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

public getWaveformSourceRuntimes(
        runtimes: TrackRuntime[],
        waveformSource: 'audible' | number
    ): TrackRuntime[] {
        return viewRendererWaveform.getWaveformSourceRuntimes(this, runtimes, waveformSource);
    }

public resolveWaveformTrackIndex(
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

updatePlaybackPosition(
        state: TrackSwitchUiState,
        runtimes: TrackRuntime[],
        waveformTimelineContext?: WaveformTimelineContext,
        warpingMatrixContext?: WarpingMatrixRenderContext
    ): void {
        return viewRendererCore.updatePlaybackPosition(this, state, runtimes, waveformTimelineContext, warpingMatrixContext);
    }

public updateWaveformZoomIndicators(): void {
        return viewRendererWaveform.updateWaveformZoomIndicators(this);
    }

public applyFixedWaveformLocalSeekVisuals(
        state: TrackSwitchUiState,
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        return viewRendererWaveform.applyFixedWaveformLocalSeekVisuals(this, state, waveformTimelineContext);
    }

public getLongestWaveformSourceDuration(
        runtimes: TrackRuntime[],
        waveformSource: 'audible' | number
    ): number {
        return viewRendererWaveform.getLongestWaveformSourceDuration(this, runtimes, waveformSource);
    }

public updateWaveformTiming(
        state: TrackSwitchUiState,
        runtimes: TrackRuntime[],
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        return viewRendererWaveform.updateWaveformTiming(this, state, runtimes, waveformTimelineContext);
    }

public updateSeekWrapVisuals(
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
        panSupported = true,
        syncEnabled = false
    ): void {
        return viewRendererCore.updateTrackControls(
            this,
            runtimes,
            syncLockedTrackIndexes,
            effectiveSingleSoloMode,
            panSupported,
            syncEnabled
        );
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

public applyVolumeIconState(icon: HTMLElement, volumeZeroToOne: number): void {
        return viewRendererCore.applyVolumeIconState(this, icon, volumeZeroToOne);
    }

setOverlayLoading(isLoading: boolean): void {
        return viewRendererCore.setOverlayLoading(this, isLoading);
    }

setShortcutHelpVisible(isVisible: boolean): void {
        return viewRendererCore.setShortcutHelpVisible(this, isVisible);
    }

updateOverlayDownloadInfo(info: AudioDownloadSizeInfo): void {
        return viewRendererCore.updateOverlayDownloadInfo(this, info);
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
