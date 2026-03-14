import { TrackRuntime, TrackSwitchUiState } from '../domain/types';

function buildUiState(controller: any): TrackSwitchUiState {
    return {
        playing: controller.state.playing,
        repeat: controller.state.repeat,
        position: controller.state.position,
        longestDuration: controller.longestDuration,
        syncEnabled: controller.globalSyncEnabled,
        syncAvailable: controller.isGlobalSyncAvailable(),
        loop: {
            pointA: controller.state.loop.pointA,
            pointB: controller.state.loop.pointB,
            enabled: controller.state.loop.enabled,
        },
    };
}

export function applyTrackProperties(ctx: any): any {
    return (function(this: any) {
        const panSupported = this.audioEngine.supportsStereoPanning();
        const noSoloFallbackGate = this.isAlignmentMode() && this.globalSyncEnabled ? 0 : undefined;
        if (!panSupported) {
            this.runtimes.forEach((runtime: TrackRuntime) => {
                runtime.state.pan = 0;
            });
        }

        this.renderer.updateTrackControls(
            this.runtimes,
            this.syncLockedTrackIndexes,
            this.effectiveSingleSoloMode,
            panSupported,
            this.globalSyncEnabled
        );
        this.audioEngine.applyTrackStateGains(this.runtimes, noSoloFallbackGate);
        this.renderer.switchPosterImage(this.runtimes);
        this.renderer.renderWaveforms(
            this.waveformEngine,
            this.runtimes,
            this.longestDuration,
            this.getWaveformTimelineProjector(),
            this.getWaveformTimelineContext()
        );

        this.runtimes.forEach((runtime: TrackRuntime, index: number) => {
            this.emit('trackState', {
                index: index,
                state: {
                    solo: runtime.state.solo,
                    volume: runtime.state.volume,
                    pan: runtime.state.pan,
                },
            });
        });
    }).call(ctx);
}

export function updateMainControls(ctx: any): any {
    return (function(this: any) {
        const uiState = buildUiState(this);

        this.renderer.updateMainControls(
            uiState,
            this.runtimes,
            this.getWaveformTimelineContext(),
            this.getWarpingMatrixContext()
        );
        this.sheetMusicEngine.updatePosition(this.state.position, this.isSyncReferenceAxisActive());

        this.emit('position', {
            position: this.state.position,
            duration: this.longestDuration,
        });
    }).call(ctx);
}

export function updatePlaybackPositionUi(ctx: any): any {
    return (function(this: any) {
        const uiState = buildUiState(this);

        this.renderer.updatePlaybackPosition(
            uiState,
            this.runtimes,
            this.getWaveformTimelineContext(),
            this.getWarpingMatrixContext()
        );
        this.sheetMusicEngine.updatePosition(this.state.position, this.isSyncReferenceAxisActive());

        this.emit('position', {
            position: this.state.position,
            duration: this.longestDuration,
        });
    }).call(ctx);
}
