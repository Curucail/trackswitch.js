import { TrackRuntime } from '../domain/types';
import { closestInRoot } from '../shared/dom';
import { clamp } from '../shared/math';
import { getSeekMetrics } from '../shared/seek';

interface SeekTimelineContext {
    duration: number;
    toReferenceTime(timelineTime: number): number;
    fromReferenceTime(referenceTime: number): number;
}
export function onSeekMove(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.isLoaded) {
            return;
        }

        if (this.waveformMinimapDragState) {
            if (this.updateWaveformMinimapDrag(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }

        if (this.pendingWaveformTouchSeek) {
            if (this.tryActivatePendingWaveformTouchSeek(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }

        if (this.pinchZoomState) {
            if (this.updatePinchZoom(event)) {
                event.preventDefault();
            }
            return;
        }

        if (this.draggingMarker !== null) {
            event.preventDefault();
            const seekTimelineContext = this.getSeekTimelineContext(this.seekingElement);
            const metrics = getSeekMetrics(this.seekingElement, event, seekTimelineContext.duration);
            if (!metrics) {
                return;
            }

            let newTime = metrics.time;
            if (this.draggingMarker === 'A') {
                const loopPointB = this.state.loop.pointB === null
                    ? null
                    : seekTimelineContext.fromReferenceTime(this.state.loop.pointB);
                if (loopPointB !== null) {
                    newTime = Math.min(newTime, loopPointB - this.loopMinDistance);
                }
                newTime = Math.max(0, newTime);
                this.state = {
                    ...this.state,
                    loop: {
                        ...this.state.loop,
                        pointA: seekTimelineContext.toReferenceTime(newTime),
                    },
                };
            } else {
                const loopPointA = this.state.loop.pointA === null
                    ? null
                    : seekTimelineContext.fromReferenceTime(this.state.loop.pointA);
                if (loopPointA !== null) {
                    newTime = Math.max(newTime, loopPointA + this.loopMinDistance);
                }
                newTime = Math.min(seekTimelineContext.duration, newTime);
                this.state = {
                    ...this.state,
                    loop: {
                        ...this.state.loop,
                        pointB: seekTimelineContext.toReferenceTime(newTime),
                    },
                };
            }

            this.updateMainControls();
            return;
        }

        if (this.features.looping && this.rightClickDragging) {
            event.preventDefault();

            const seekTimelineContext = this.getSeekTimelineContext(this.seekingElement);
            const metrics = getSeekMetrics(this.seekingElement, event, seekTimelineContext.duration);
            if (!metrics || this.loopDragStart === null) {
                return;
            }

            if (metrics.time >= this.loopDragStart) {
                const loopStart = this.loopDragStart;
                const loopEnd = Math.min(
                    seekTimelineContext.duration,
                    Math.max(metrics.time, this.loopDragStart + this.loopMinDistance)
                );
                const mappedStart = seekTimelineContext.toReferenceTime(loopStart);
                const mappedEnd = seekTimelineContext.toReferenceTime(loopEnd);
                this.state = {
                    ...this.state,
                    loop: {
                        ...this.state.loop,
                        pointA: Math.min(mappedStart, mappedEnd),
                        pointB: Math.max(mappedStart, mappedEnd),
                        enabled: false,
                    },
                };
            } else {
                const loopStart = this.loopDragStart;
                const loopEnd = Math.max(0, Math.min(metrics.time, this.loopDragStart - this.loopMinDistance));
                const mappedStart = seekTimelineContext.toReferenceTime(loopEnd);
                const mappedEnd = seekTimelineContext.toReferenceTime(loopStart);
                this.state = {
                    ...this.state,
                    loop: {
                        ...this.state.loop,
                        pointA: Math.min(mappedStart, mappedEnd),
                        pointB: Math.max(mappedStart, mappedEnd),
                        enabled: false,
                    },
                };
            }

            this.updateMainControls();
            return;
        }

        if (this.state.currentlySeeking) {
            event.preventDefault();
            this.seekFromEvent(event);
        }
    }).call(ctx, event);
}

export function onWaveformZoomWheel(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.features.waveform) {
            return;
        }

        const wheelEvent = event.originalEvent as WheelEvent | undefined;
        const deltaY = wheelEvent?.deltaY;
        if (typeof deltaY !== 'number' || !Number.isFinite(deltaY) || deltaY === 0) {
            return;
        }

        const wrapper = closestInRoot(this.root, event.target, '.waveform-wrap');
        if (!wrapper) {
            return;
        }

        const seekWrap = wrapper.querySelector('.seekwrap[data-seek-surface="waveform"]');
        if (!(seekWrap instanceof HTMLElement)) {
            return;
        }

        const zoomDuration = this.getSeekTimelineContext(seekWrap).duration;
        if (!this.renderer.isWaveformZoomEnabled(seekWrap, zoomDuration)) {
            return;
        }

        const currentZoom = this.renderer.getWaveformZoom(seekWrap);
        if (currentZoom === null) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const zoomFactor = Math.exp((-1 * deltaY) * 0.002);
        const nextZoom = currentZoom * zoomFactor;
        const changed = this.renderer.setWaveformZoom(
            seekWrap,
            nextZoom,
            zoomDuration,
            Number.isFinite(event.pageX) ? event.pageX : undefined
        );

        if (changed) {
            this.requestWaveformRender();
            this.updateMainControls();
        }
    }).call(ctx, event);
}

export function updateWaveformMinimapDrag(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.waveformMinimapDragState) {
            return false;
        }

        if (event.type === 'touchmove' && this.getActiveTouchCount(event) >= 2) {
            this.endWaveformMinimapDrag();
            return false;
        }

        if (!Number.isFinite(event.pageX)) {
            return true;
        }

        const rect = this.waveformMinimapDragState.minimapNode.getBoundingClientRect();
        const minimapWidth = Math.max(1, rect.width || this.waveformMinimapDragState.minimapNode.clientWidth);
        const pointerRatio = clamp(
            (((event.pageX as number) - (rect.left + window.scrollX)) / minimapWidth),
            0,
            1
        );
        this.renderer.setWaveformMinimapViewportStart(
            this.waveformMinimapDragState.seekWrap,
            pointerRatio - this.waveformMinimapDragState.pointerOffsetRatio
        );
        return true;
    }).call(ctx, event);
}

export function endWaveformMinimapDrag(ctx: any): any {
    return (function(this: any) {
        this.waveformMinimapDragState = null;
    }).call(ctx);
}

export function requestWaveformRender(ctx: any): any {
    return (function(this: any) {
        if (this.waveformRenderFrameId !== null) {
            return;
        }

        this.waveformRenderFrameId = requestAnimationFrame(() => {
            this.waveformRenderFrameId = null;
            this.renderer.renderWaveforms(
                this.waveformEngine,
                this.runtimes,
                this.longestDuration,
                this.getWaveformTimelineProjector(),
                this.getWaveformTimelineContext()
            );
        });
    }).call(ctx);
}

export function isWaveformSeekSurface(ctx: any, seekWrap: any): any {
    return (function(this: any, seekWrap: any) {
        return !!seekWrap && seekWrap.getAttribute('data-seek-surface') === 'waveform';
    }).call(ctx, seekWrap);
}

export function startInteractiveSeek(ctx: any, event: any, seekWrap: any): any {
    return (function(this: any, event: any, seekWrap: any) {
        this.seekingElement = seekWrap;
        this.seekFromEvent(event, true);
        this.dispatch({ type: 'set-seeking', seeking: true });
        this.disableLoopWhenSeekOutsideRegion();
    }).call(ctx, event, seekWrap);
}

export function disableLoopWhenSeekOutsideRegion(ctx: any): any {
    return (function(this: any) {
        if (
            this.state.loop.enabled
            && this.state.loop.pointA !== null
            && this.state.loop.pointB !== null
            && (this.state.position < this.state.loop.pointA || this.state.position > this.state.loop.pointB)
        ) {
            this.state = {
                ...this.state,
                loop: {
                    ...this.state.loop,
                    enabled: false,
                },
            };
        }
    }).call(ctx);
}

export function tryStartPendingWaveformTouchSeek(ctx: any, event: any, seekWrap: any): any {
    return (function(this: any, event: any, seekWrap: any) {
        if (
            event.type !== 'touchstart'
            || !this.features.waveform
            || !this.isWaveformSeekSurface(seekWrap)
            || this.getActiveTouchCount(event) !== 1
            || !seekWrap
        ) {
            return false;
        }

        if (!Number.isFinite(event.pageX)) {
            return false;
        }

        if (!Number.isFinite(event.pageY)) {
            return false;
        }

        this.pendingWaveformTouchSeek = {
            seekWrap: seekWrap,
            startPageX: event.pageX as number,
            startPageY: event.pageY as number,
        };
        this.seekingElement = seekWrap;
        return true;
    }).call(ctx, event, seekWrap);
}

export function tryActivatePendingWaveformTouchSeek(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.pendingWaveformTouchSeek) {
            return false;
        }

        if (this.getActiveTouchCount(event) >= 2) {
            return false;
        }

        if (!Number.isFinite(event.pageX)) {
            return false;
        }

        if (!Number.isFinite(event.pageY)) {
            return false;
        }

        const deltaX = Math.abs((event.pageX as number) - this.pendingWaveformTouchSeek.startPageX);
        const deltaY = Math.abs((event.pageY as number) - this.pendingWaveformTouchSeek.startPageY);

        if (deltaY >= this.touchSeekMoveThresholdPx && deltaY > deltaX) {
            this.pendingWaveformTouchSeek = null;
            this.seekingElement = null;
            return false;
        }

        if (deltaX < this.touchSeekMoveThresholdPx || deltaX < deltaY) {
            return false;
        }

        const seekWrap = this.pendingWaveformTouchSeek.seekWrap;
        this.pendingWaveformTouchSeek = null;
        this.startInteractiveSeek(event, seekWrap);
        return true;
    }).call(ctx, event);
}

export function applyPendingWaveformTouchSeekTap(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.pendingWaveformTouchSeek) {
            return;
        }

        if (Number.isFinite(event.pageX) && Number.isFinite(event.pageY)) {
            const deltaX = Math.abs((event.pageX as number) - this.pendingWaveformTouchSeek.startPageX);
            const deltaY = Math.abs((event.pageY as number) - this.pendingWaveformTouchSeek.startPageY);
            if (deltaX >= this.touchSeekMoveThresholdPx || deltaY >= this.touchSeekMoveThresholdPx) {
                this.pendingWaveformTouchSeek = null;
                this.seekingElement = null;
                return;
            }
        }

        this.seekingElement = this.pendingWaveformTouchSeek.seekWrap;
        this.pendingWaveformTouchSeek = null;
        this.seekFromEvent(event, false);
    }).call(ctx, event);
}

export function getTouchPair(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const touchEvent = event.originalEvent as TouchEvent | undefined;
        const touches = touchEvent?.touches;
        if (!touches || touches.length < 2) {
            return null;
        }

        const first = touches[0];
        const second = touches[1];
        if (!first || !second) {
            return null;
        }

        return [first, second];
    }).call(ctx, event);
}

export function getTouchDistance(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const touchPair = this.getTouchPair(event);
        if (!touchPair) {
            return null;
        }

        const [first, second] = touchPair;
        const distance = Math.hypot(
            first.pageX - second.pageX,
            first.pageY - second.pageY
        );
        if (!Number.isFinite(distance) || distance <= 0) {
            return null;
        }

        return distance;
    }).call(ctx, event);
}

export function getTouchCenterPageX(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const touchPair = this.getTouchPair(event);
        if (!touchPair) {
            return null;
        }

        const [first, second] = touchPair;
        return (first.pageX + second.pageX) / 2;
    }).call(ctx, event);
}

export function getActiveTouchCount(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        const touchEvent = event.originalEvent as TouchEvent | undefined;
        if (!touchEvent?.touches) {
            return 0;
        }

        return touchEvent.touches.length;
    }).call(ctx, event);
}

export function tryStartPinchZoom(ctx: any, event: any, seekWrap: any): any {
    return (function(this: any, event: any, seekWrap: any) {
        if (!this.features.waveform || event.type !== 'touchstart') {
            return false;
        }

        if (this.pinchZoomState) {
            return true;
        }

        if (!seekWrap || seekWrap.getAttribute('data-seek-surface') !== 'waveform') {
            return false;
        }

        const zoomDuration = this.getSeekTimelineContext(seekWrap).duration;
        if (!this.renderer.isWaveformZoomEnabled(seekWrap, zoomDuration)) {
            return false;
        }

        const initialDistance = this.getTouchDistance(event);
        if (initialDistance === null) {
            return false;
        }

        const initialZoom = this.renderer.getWaveformZoom(seekWrap);
        if (initialZoom === null) {
            return false;
        }

        this.pinchZoomState = {
            seekWrap: seekWrap,
            initialDistance: initialDistance,
            initialZoom: initialZoom,
        };
        this.pendingWaveformTouchSeek = null;
        this.waveformMinimapDragState = null;

        if (this.state.currentlySeeking) {
            this.dispatch({ type: 'set-seeking', seeking: false });
        }
        this.seekingElement = seekWrap;
        this.rightClickDragging = false;
        this.loopDragStart = null;
        this.draggingMarker = null;
        return true;
    }).call(ctx, event, seekWrap);
}

export function updatePinchZoom(ctx: any, event: any): any {
    return (function(this: any, event: any) {
        if (!this.pinchZoomState) {
            return false;
        }

        const distance = this.getTouchDistance(event);
        if (distance === null) {
            this.endPinchZoom();
            return false;
        }

        const anchorPageX = this.getTouchCenterPageX(event);
        const scale = distance / this.pinchZoomState.initialDistance;
        const zoomDuration = this.getSeekTimelineContext(this.pinchZoomState.seekWrap).duration;
        const changed = this.renderer.setWaveformZoom(
            this.pinchZoomState.seekWrap,
            this.pinchZoomState.initialZoom * scale,
            zoomDuration,
            anchorPageX === null ? undefined : anchorPageX
        );

        if (changed) {
            this.requestWaveformRender();
            this.updateMainControls();
        }

        return true;
    }).call(ctx, event);
}

export function endPinchZoom(ctx: any): any {
    return (function(this: any) {
        this.pinchZoomState = null;
        if (this.state.currentlySeeking) {
            this.dispatch({ type: 'set-seeking', seeking: false });
        }
        this.pendingWaveformTouchSeek = null;
        this.seekingElement = null;
    }).call(ctx);
}

export function trackIndexFromTarget(ctx: any, target: any): any {
    return (function(this: any, target: any) {
        const track = closestInRoot(this.root, target, '.track[data-track-index]');
        if (!track) {
            return -1;
        }

        const rawIndex = track.getAttribute('data-track-index');
        const parsed = Number(rawIndex);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return -1;
        }

        return Math.floor(parsed);
    }).call(ctx, target);
}

export function isFixedWaveformLocalAxisEnabled(ctx: any): any {
    return (function(this: any) {
        return this.isAlignmentMode() && !!this.alignmentContext && !this.globalSyncEnabled;
    }).call(ctx);
}

export function getSeekTimelineContext(ctx: any, seekingElement: any): any {
    return (function(this: any, seekingElement: any) {
        const referenceContext: SeekTimelineContext = {
            duration: this.longestDuration,
            toReferenceTime: (timelineTime: number): number => clamp(timelineTime, 0, this.longestDuration),
            fromReferenceTime: (referenceTime: number): number => clamp(referenceTime, 0, this.longestDuration),
        };

        if (!seekingElement || !this.isFixedWaveformLocalAxisEnabled()) {
            return referenceContext;
        }

        const waveformSource = seekingElement.getAttribute('data-waveform-source');
        if (!waveformSource || waveformSource === 'audible') {
            return referenceContext;
        }

        const parsedSource = Number(waveformSource);
        if (!Number.isFinite(parsedSource) || parsedSource < 0) {
            return referenceContext;
        }

        const trackIndex = Math.floor(parsedSource);
        const runtime = this.runtimes[trackIndex];
        if (!runtime) {
            return referenceContext;
        }

        const trackDuration = (ctx.constructor as any).getRuntimeDuration(runtime);
        if (!Number.isFinite(trackDuration) || trackDuration <= 0) {
            return referenceContext;
        }

        return {
            duration: trackDuration,
            toReferenceTime: (timelineTime: number): number => {
                const clampedTimelineTime = clamp(timelineTime, 0, trackDuration);
                return clamp(this.trackToReferenceTime(trackIndex, clampedTimelineTime), 0, this.longestDuration);
            },
            fromReferenceTime: (referenceTime: number): number => {
                const clampedReferenceTime = clamp(referenceTime, 0, this.longestDuration);
                return clamp(this.referenceToTrackTime(trackIndex, clampedReferenceTime), 0, trackDuration);
            },
        };
    }).call(ctx, seekingElement);
}

export function getWaveformTimelineContext(ctx: any): any {
    return (function(this: any) {
        return {
            enabled: this.isFixedWaveformLocalAxisEnabled(),
            referenceToTrackTime: (trackIndex: number, referenceTime: number): number => {
                const runtime = this.runtimes[trackIndex];
                if (!runtime) {
                    return 0;
                }

                const trackDuration = (ctx.constructor as any).getRuntimeDuration(runtime);
                if (!Number.isFinite(trackDuration) || trackDuration <= 0) {
                    return 0;
                }

                const clampedReferenceTime = clamp(referenceTime, 0, this.longestDuration);
                return clamp(this.referenceToTrackTime(trackIndex, clampedReferenceTime), 0, trackDuration);
            },
            getTrackDuration: (trackIndex: number): number => {
                const runtime = this.runtimes[trackIndex];
                if (!runtime) {
                    return 0;
                }

                const duration = (ctx.constructor as any).getRuntimeDuration(runtime);
                if (!Number.isFinite(duration) || duration <= 0) {
                    return 0;
                }

                return duration;
            },
        };
    }).call(ctx);
}

export function getWaveformTimelineProjector(ctx: any): any {
    return (function(this: any) {
        if (this.features.mode !== 'alignment' || !this.alignmentContext) {
            return undefined;
        }

        const trackIndexByRuntime = new Map<TrackRuntime, number>();
        const trackIndexByDefinition = new Map<object, number>();

        this.runtimes.forEach(function(runtime: TrackRuntime, index: number) {
            trackIndexByRuntime.set(runtime, index);
            trackIndexByDefinition.set(runtime.definition, index);
        });

        return (runtime: TrackRuntime, trackTimelineTime: number): number => {
            const directIndex = trackIndexByRuntime.get(runtime);
            if (directIndex !== undefined) {
                return this.trackToReferenceTime(directIndex, trackTimelineTime);
            }

            const definitionIndex = trackIndexByDefinition.get(runtime.definition);
            if (definitionIndex !== undefined) {
                return this.trackToReferenceTime(definitionIndex, trackTimelineTime);
            }

            return trackTimelineTime;
        };
    }).call(ctx);
}
