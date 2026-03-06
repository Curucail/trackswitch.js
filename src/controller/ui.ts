import { TrackRuntime, TrackSwitchUiState } from '../domain/types';


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
        const uiState: TrackSwitchUiState = {
            playing: this.state.playing,
            repeat: this.state.repeat,
            position: this.state.position,
            longestDuration: this.longestDuration,
            syncEnabled: this.globalSyncEnabled,
            syncAvailable: this.isAlignmentMode()
                && this.runtimes.some((runtime: TrackRuntime) => this.hasSyncedVariant(runtime)),
            loop: {
                pointA: this.state.loop.pointA,
                pointB: this.state.loop.pointB,
                enabled: this.state.loop.enabled,
            },
        };

        this.renderer.updateMainControls(
            uiState,
            this.runtimes,
            this.getWaveformTimelineContext(),
            this.getWarpingMatrixContext()
        );
        this.sheetMusicEngine.updatePosition(this.state.position);

        this.emit('position', {
            position: this.state.position,
            duration: this.longestDuration,
        });
    }).call(ctx);
}
