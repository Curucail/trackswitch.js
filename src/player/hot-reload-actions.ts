import {
    NormalizedTrackSwitchConfig,
    TrackRuntime,
    TrackSwitchFeatures,
    TrackSwitchInit,
} from '../domain/types';
import { normalizeTrackSwitchConfig } from '../config/normalize-init';
import { injectConfiguredUiElements } from '../config/ui-elements';
import { normalizeFeatures } from '../domain/options';
import { createTrackRuntime } from '../domain/runtime';
import { createInitialPlayerState } from '../domain/state';
import { derivePresetNames } from '../shared/preset';
import { clamp } from '../shared/math';
import type { TrackSwitchControllerImpl } from './player-controller';

function resolveControllerFeatures(config: NormalizedTrackSwitchConfig): TrackSwitchFeatures {
    const features = normalizeFeatures(config.features);
    if (features.mode === 'alignment') {
        features.exclusiveSolo = true;
        features.presets = false;
    }
    return features;
}

function featuresEqual(left: TrackSwitchFeatures, right: TrackSwitchFeatures): boolean {
    const leftKeys = Object.keys(left) as Array<keyof TrackSwitchFeatures>;
    return leftKeys.every(function(key) {
        return left[key] === right[key];
    });
}

function createRuntimes(config: NormalizedTrackSwitchConfig, features: TrackSwitchFeatures): TrackRuntime[] {
    const runtimes = config.tracks.map(function(track, index) {
        return createTrackRuntime(track, index);
    });

    const hasAnySelectedTrack = runtimes.some(function(runtime) {
        return runtime.state.solo;
    });
    if (!hasAnySelectedTrack && runtimes.length > 0) {
        if (features.exclusiveSolo) {
            runtimes[0].state.solo = true;
        } else {
            const hasExplicitSoloConfiguration = config.tracks.some(function(track) {
                return typeof track.solo === 'boolean';
            });

            if (!hasExplicitSoloConfiguration) {
                runtimes.forEach(function(runtime) {
                    runtime.state.solo = true;
                });
            }
        }
    }

    return runtimes;
}

function resetTransientInteractionState(controller: TrackSwitchControllerImpl): void {
    if (controller.resizeDebounceTimer) {
        clearTimeout(controller.resizeDebounceTimer);
        controller.resizeDebounceTimer = null;
    }
    if (controller.waveformRenderFrameId !== null) {
        cancelAnimationFrame(controller.waveformRenderFrameId);
        controller.waveformRenderFrameId = null;
    }

    controller.seekingElement = null;
    controller.rightClickDragging = false;
    controller.loopDragStart = null;
    controller.draggingMarker = null;
    controller.pinchZoomState = null;
    controller.pendingWaveformTouchSeek = null;
    controller.waveformMinimapDragState = null;
    controller.shortcutHelpOpen = false;
}

function getHotReloadErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }

    const fallback = String(error ?? '').trim();
    return fallback && fallback !== '[object Object]'
        ? fallback
        : 'Unexpected error while updating TrackSwitch.';
}

async function buildStagedAlignmentContext(
    controller: TrackSwitchControllerImpl,
    config: NormalizedTrackSwitchConfig,
    runtimes: TrackRuntime[]
): Promise<unknown | null> {
    if (controller.features.mode !== 'alignment') {
        return null;
    }

    const previousRuntimes = controller.runtimes;
    const previousAlignmentConfig = controller.alignmentConfig;
    const previousAlignmentCsvRequest = controller.alignmentCsvRequest;

    controller.runtimes = runtimes;
    controller.alignmentConfig = config.alignment;
    controller.alignmentCsvRequest = null;

    try {
        const alignmentContext = await controller.buildAlignmentContext();
        if (typeof alignmentContext === 'string') {
            throw new Error(alignmentContext);
        }
        return alignmentContext;
    } finally {
        controller.runtimes = previousRuntimes;
        controller.alignmentConfig = previousAlignmentConfig;
        controller.alignmentCsvRequest = previousAlignmentCsvRequest;
    }
}

export async function updateInit(
    controller: TrackSwitchControllerImpl,
    nextInit: TrackSwitchInit
): Promise<void> {
    if (controller.isDestroyed) {
        throw new Error('TrackSwitch controller has already been destroyed.');
    }
    if (!controller.isLoaded) {
        throw new Error('TrackSwitch hot reload requires the player to be loaded first.');
    }

    let stagedRuntimes: TrackRuntime[] | null = null;
    let committed = false;

    try {
        const nextConfig = normalizeTrackSwitchConfig(nextInit);
        const nextFeatures = resolveControllerFeatures(nextConfig);
        if (!featuresEqual(controller.features, nextFeatures)) {
            throw new Error('TrackSwitch hot reload does not support changing features; recreate the player instead.');
        }

        const nextRuntimes = createRuntimes(nextConfig, controller.features);
        stagedRuntimes = nextRuntimes;
        await controller.audioEngine.loadTracks(nextRuntimes);

        const erroredTracks = nextRuntimes.filter(function(runtime) {
            return runtime.errored;
        });
        if (erroredTracks.length > 0) {
            controller.audioEngine.disconnectRuntimes(nextRuntimes);
            throw new Error('One or more audio files failed to load.');
        }

        const stagedAlignmentContext = await buildStagedAlignmentContext(controller, nextConfig, nextRuntimes);
        const wasPlaying = controller.state.playing;
        const previousPosition = wasPlaying
            ? controller.currentPlaybackReferencePosition()
            : controller.state.position;
        const previousLoop = { ...controller.state.loop };
        const previousRepeat = controller.state.repeat;
        const previousVolume = controller.state.volume;
        const oldRuntimes = controller.runtimes;

        if (wasPlaying) {
            controller.stopAudio();
        }
        controller.audioEngine.disconnectRuntimes(oldRuntimes);
        committed = true;
        resetTransientInteractionState(controller);
        controller.sheetMusicEngine.destroy();
        controller.renderer.destroy();

        injectConfiguredUiElements(controller.root, nextConfig.ui);

        const presetNames = controller.features.presets ? derivePresetNames(nextConfig) : [];
        controller.renderer.updateConfig(presetNames, nextConfig.trackGroups);
        controller.runtimes = nextRuntimes;
        controller.presetCount = presetNames.length;
        controller.alignmentConfig = nextConfig.alignment;
        controller.alignmentCsvRequest = null;
        controller.alignmentContext = null;
        controller.alignmentPlaybackTrackIndex = null;
        controller.globalSyncEnabled = false;
        controller.syncLockedTrackIndexes.clear();
        controller.preSyncSoloTrackIndex = null;
        controller.effectiveSingleSoloMode = controller.isAlignmentMode()
            ? true
            : controller.features.exclusiveSolo;
        controller.audioDownloadSizeRequest = null;
        controller.audioDownloadSizeInfo = {
            status: 'calculating',
            totalBytes: null,
            resolvedSourceCount: 0,
            totalSourceCount: 0,
        };

        controller.renderer.initialize(controller.runtimes);
        controller.renderer.hideOverlayOnLoaded();
        controller.longestDuration = controller.findLongestDuration();

        if (controller.features.mode === 'alignment') {
            controller.alignmentContext = stagedAlignmentContext as typeof controller.alignmentContext;
            const alignmentContext = controller.alignmentContext as {
                baseAxis: { referenceDuration: number };
            } | null;
            if (alignmentContext) {
                controller.longestDuration = alignmentContext.baseAxis.referenceDuration;
            }
            controller.setEffectiveSoloMode(true);
        }

        await controller.initializeSheetMusic();

        const nextPosition = clamp(previousPosition, 0, controller.longestDuration);
        controller.state = {
            ...createInitialPlayerState(previousRepeat),
            volume: previousVolume,
            position: nextPosition,
            loop: {
                enabled: previousLoop.enabled,
                pointA: previousLoop.pointA === null
                    ? null
                    : clamp(previousLoop.pointA, 0, controller.longestDuration),
                pointB: previousLoop.pointB === null
                    ? null
                    : clamp(previousLoop.pointB, 0, controller.longestDuration),
            },
        };
        if (
            controller.state.loop.pointA !== null
            && controller.state.loop.pointB !== null
            && controller.state.loop.pointA > controller.state.loop.pointB
        ) {
            const pointA = controller.state.loop.pointA;
            controller.state.loop.pointA = controller.state.loop.pointB;
            controller.state.loop.pointB = pointA;
        }

        if (controller.presetCount > 0) {
            controller.applyPreset(0);
        } else {
            controller.applyTrackProperties();
        }
        controller.audioEngine.setMasterVolume(controller.state.volume);
        controller.prefetchAudioDownloadSize();

        if (wasPlaying) {
            controller.startAudio(controller.state.position);
            controller.dispatch({ type: 'set-playing', playing: true });
        }

        controller.updateMainControls();
        controller.emit('loaded', {
            longestDuration: controller.longestDuration,
        });
    } catch (error) {
        if (stagedRuntimes && !committed) {
            controller.audioEngine.disconnectRuntimes(stagedRuntimes);
        }
        const message = getHotReloadErrorMessage(error);
        controller.emit('error', { message });
        throw error instanceof Error ? error : new Error(message);
    }
}
