import {
    TrackRuntime,
    TrackSourceDefinition,
    TrackSwitchFeatures,
    TrackTiming,
} from '../domain/types';
import { calculateTrackTiming, inferSourceMimeType } from '../shared/audio';
import { getAudioContext } from './audio-context';

const MIME_TYPE_TABLE: Record<string, string> = {
    '.aac': 'audio/aac;',
    '.aif': 'audio/aiff;',
    '.aiff': 'audio/aiff;',
    '.au': 'audio/basic;',
    '.flac': 'audio/flac;',
    '.mp1': 'audio/mpeg;',
    '.mp2': 'audio/mpeg;',
    '.mp3': 'audio/mpeg;',
    '.mpg': 'audio/mpeg;',
    '.mpeg': 'audio/mpeg;',
    '.m4a': 'audio/mp4;',
    '.mp4': 'audio/mp4;',
    '.oga': 'audio/ogg;',
    '.ogg': 'audio/ogg;',
    '.wav': 'audio/wav;',
    '.webm': 'audio/webm;',
};

interface LoadTrackResult {
    success: boolean;
    error: string | null;
}

interface LoadedSourceSelection {
    buffer: AudioBuffer;
    timing: TrackTiming;
    sourceIndex: number;
}

interface LoadSourceSelectionResult {
    success: boolean;
    selection: LoadedSourceSelection | null;
    error: string | null;
}

const RESUME_WAIT_TIMEOUT_MS = 250;

export class AudioEngine {
    private context: AudioContext | null;
    private readonly features: TrackSwitchFeatures;
    private gainNodeMaster: GainNode | null;
    private gainNodeVolume: GainNode | null;
    private masterVolume: number;

    constructor(features: TrackSwitchFeatures, initialVolume: number) {
        this.features = features;
        this.context = null;
        this.gainNodeMaster = null;
        this.gainNodeVolume = null;
        this.masterVolume = Math.max(0, Math.min(1, Number.isFinite(initialVolume) ? initialVolume : 0));
    }

    private initializeAudioGraph(): void {
        if (this.context && this.gainNodeMaster && this.gainNodeVolume) {
            return;
        }

        const context = getAudioContext();
        if (!context) {
            this.context = null;
            this.gainNodeMaster = null;
            this.gainNodeVolume = null;
            return;
        }

        this.context = context;

        if (!this.gainNodeVolume) {
            const volumeNode = this.context.createGain();
            volumeNode.gain.value = this.features.globalvolume ? this.masterVolume : 1.0;
            volumeNode.connect(this.context.destination);
            this.gainNodeVolume = volumeNode;
        }

        if (!this.gainNodeMaster && this.gainNodeVolume) {
            const masterNode = this.context.createGain();
            masterNode.gain.value = 0.0;
            masterNode.connect(this.gainNodeVolume);
            this.gainNodeMaster = masterNode;
        }

        this.setMasterVolume(this.masterVolume);
    }

    get currentTime(): number {
        return this.context ? this.context.currentTime : 0;
    }

    canUseAudioGraph(): boolean {
        this.initializeAudioGraph();
        return !!(this.context && this.gainNodeMaster && this.gainNodeVolume);
    }

    private requestContextResume(): Promise<void> {
        if (!this.context) {
            return Promise.resolve();
        }

        if (this.context.state !== 'suspended' && this.context.state !== 'interrupted') {
            return Promise.resolve();
        }

        try {
            const maybePromise = this.context.resume();
            if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
                return (maybePromise as Promise<void>).then(function() {}).catch(function() {});
            }
        } catch (_error) {
            // ignore
        }

        return Promise.resolve();
    }

    private async waitForResumeAttempt(timeoutMs: number): Promise<void> {
        const resumeAttempt = this.requestContextResume();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const timeoutPromise = new Promise<void>((resolve) => {
            timeoutId = setTimeout(resolve, timeoutMs);
        });

        await Promise.race([resumeAttempt, timeoutPromise]);

        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    }

    primeFromUserGesture(): void {
        this.initializeAudioGraph();

        void this.requestContextResume();
    }

    async prepareForPlaybackStart(): Promise<boolean> {
        this.primeFromUserGesture();

        if (!this.context || !this.gainNodeMaster || !this.gainNodeVolume) {
            return false;
        }

        await this.waitForResumeAttempt(RESUME_WAIT_TIMEOUT_MS);

        return !!(this.context && this.gainNodeMaster && this.gainNodeVolume);
    }

    getContext(): AudioContext | null {
        this.initializeAudioGraph();
        return this.context;
    }

    async unlockIOSPlayback(): Promise<void> {
        if (!this.features.iosunmute) {
            return;
        }

        this.initializeAudioGraph();

        if (!this.context) {
            return;
        }

        await this.waitForResumeAttempt(RESUME_WAIT_TIMEOUT_MS);

        try {
            const unlockAudio = document.createElement('audio');
            unlockAudio.setAttribute('playsinline', 'playsinline');
            unlockAudio.preload = 'auto';
            unlockAudio.volume = 0.0001;
            unlockAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';

            const playPromise = unlockAudio.play();
            const cleanup = function() {
                unlockAudio.pause();
                unlockAudio.removeAttribute('src');
                unlockAudio.load();
            };

            if (playPromise && typeof playPromise.then === 'function') {
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const playAttempt = (playPromise as Promise<void>).then(function() {}).catch(function() {});
                const timeoutPromise = new Promise<void>((resolve) => {
                    timeoutId = setTimeout(resolve, RESUME_WAIT_TIMEOUT_MS);
                });

                await Promise.race([playAttempt, timeoutPromise]);

                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                }

                cleanup();
            } else {
                cleanup();
            }
        } catch (_error) {
            // ignore
        }
    }

    async loadTracks(runtimes: TrackRuntime[]): Promise<void> {
        if (!this.canUseAudioGraph()) {
            runtimes.forEach(function(runtime) {
                runtime.successful = false;
                runtime.errored = true;
            });
            return;
        }

        const audioElement = document.createElement('audio');

        const results = await Promise.all(runtimes.map(async (runtime) => {
            const result = await this.loadTrack(runtime, audioElement);
            return result;
        }));

        results.forEach(function(result, index) {
            runtimes[index].errored = !result.success;
            runtimes[index].successful = result.success;
        });
    }

    private async loadTrack(runtime: TrackRuntime, audioElement: HTMLAudioElement): Promise<LoadTrackResult> {
        if (!this.context || !this.gainNodeMaster) {
            return {
                success: false,
                error: 'Web Audio API unavailable',
            };
        }

        if (!runtime.gainNode) {
            runtime.gainNode = this.context.createGain();
            runtime.gainNode.connect(this.gainNodeMaster);
        }

        const baseSelectionResult = await this.loadSourceSelection(runtime.definition.sources || [], audioElement);
        if (!baseSelectionResult.success || !baseSelectionResult.selection) {
            return {
                success: false,
                error: baseSelectionResult.error || 'No playable source found',
            };
        }

        runtime.baseSource = {
            buffer: baseSelectionResult.selection.buffer,
            timing: baseSelectionResult.selection.timing,
            sourceIndex: baseSelectionResult.selection.sourceIndex,
        };

        runtime.activeVariant = 'base';
        runtime.buffer = runtime.baseSource.buffer;
        runtime.timing = runtime.baseSource.timing;
        runtime.sourceIndex = runtime.baseSource.sourceIndex;

        const alignmentSources = runtime.definition.alignment?.synchronizedSources
            || runtime.definition.alignment?.sources;
        const shouldLoadSyncedSources = this.features.mode === 'alignment'
            && Array.isArray(alignmentSources)
            && alignmentSources.length > 0;

        if (shouldLoadSyncedSources) {
            const syncedSelectionResult = await this.loadSourceSelection(alignmentSources || [], audioElement);
            if (!syncedSelectionResult.success || !syncedSelectionResult.selection) {
                return {
                    success: false,
                    error: syncedSelectionResult.error || 'No playable synchronized source found',
                };
            }

            runtime.syncedSource = {
                buffer: syncedSelectionResult.selection.buffer,
                timing: syncedSelectionResult.selection.timing,
                sourceIndex: syncedSelectionResult.selection.sourceIndex,
            };
        } else {
            runtime.syncedSource = null;
        }

        runtime.waveformCache.clear();
        runtime.errored = false;
        runtime.successful = true;

        return {
            success: true,
            error: null,
        };
    }

    private async loadSourceSelection(
        sources: TrackSourceDefinition[],
        audioElement: HTMLAudioElement
    ): Promise<LoadSourceSelectionResult> {
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
            const source = sources[sourceIndex];
            if (!source || !source.src) {
                continue;
            }

            const mime = inferSourceMimeType(source.src, source.type, MIME_TYPE_TABLE);
            const canPlay = !!(audioElement.canPlayType && audioElement.canPlayType(mime).replace(/no/, ''));
            if (!canPlay) {
                continue;
            }

            try {
                const arrayBuffer = await this.requestArrayBuffer(source.src);
                const decodedBuffer = await this.decodeAudioData(arrayBuffer);

                return {
                    success: true,
                    selection: {
                        buffer: decodedBuffer,
                        timing: calculateTrackTiming(source, decodedBuffer.duration),
                        sourceIndex: sourceIndex,
                    },
                    error: null,
                };
            } catch (_error) {
                continue;
            }
        }

        return {
            success: false,
            selection: null,
            error: 'No playable source found',
        };
    }

    private requestArrayBuffer(url: string): Promise<ArrayBuffer> {
        return new Promise(function(resolve, reject) {
            const request = new XMLHttpRequest();
            request.open('GET', url, true);
            request.responseType = 'arraybuffer';

            request.onreadystatechange = function() {
                if (request.readyState !== 4) {
                    return;
                }

                if (request.status >= 200 && request.status < 300 && request.response) {
                    resolve(request.response);
                } else {
                    reject(new Error('Failed to request audio source: ' + url));
                }
            };

            request.onerror = function() {
                reject(new Error('Network error while requesting audio source: ' + url));
            };

            request.send();
        });
    }

    private decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
        if (!this.context) {
            return Promise.reject(new Error('AudioContext unavailable'));
        }

        return new Promise((resolve, reject) => {
            let settled = false;

            const onSuccess = function(decoded: AudioBuffer) {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(decoded);
            };

            const onFailure = function(error: unknown) {
                if (settled) {
                    return;
                }
                settled = true;
                reject(error instanceof Error ? error : new Error('decodeAudioData failed'));
            };

            try {
                const maybePromise = this.context!.decodeAudioData(arrayBuffer.slice(0), onSuccess, onFailure);
                if (maybePromise && typeof (maybePromise as Promise<AudioBuffer>).then === 'function') {
                    (maybePromise as Promise<AudioBuffer>).then(onSuccess).catch(onFailure);
                }
            } catch (error) {
                onFailure(error);
            }
        });
    }

    setMasterVolume(volume: number): void {
        if (!this.gainNodeVolume) {
            return;
        }

        const nextVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
        this.masterVolume = nextVolume;
        this.gainNodeVolume.gain.value = this.features.globalvolume ? nextVolume : 1;
    }

    applyTrackStateGains(runtimes: TrackRuntime[]): void {
        const anySolos = runtimes.some(function(runtime) {
            return runtime.state.solo;
        });

        runtimes.forEach(function(runtime) {
            if (!runtime.gainNode) {
                return;
            }

            let gain = runtime.state.mute ? 0 : 1;
            if (anySolos) {
                gain = runtime.state.solo ? 1 : 0;
            }
            runtime.gainNode.gain.value = gain;
        });
    }

    start(
        runtimes: TrackRuntime[],
        position: number,
        snippetDuration?: number
    ): { startTime: number } | null {
        if (!this.context || !this.gainNodeMaster || !this.canUseAudioGraph()) {
            return null;
        }

        const now = this.context.currentTime;
        const upwardRamp = 0.03;
        const downwardRamp = 0.03;

        if (snippetDuration !== undefined) {
            this.gainNodeMaster.gain.setValueAtTime(0.0, now + downwardRamp);
            this.gainNodeMaster.gain.linearRampToValueAtTime(1.0, now + downwardRamp + upwardRamp);

            this.gainNodeMaster.gain.setValueAtTime(1.0, now + downwardRamp + upwardRamp);
            this.gainNodeMaster.gain.linearRampToValueAtTime(0.0, now + downwardRamp + upwardRamp + snippetDuration);
        } else {
            this.gainNodeMaster.gain.cancelScheduledValues(now);
            this.gainNodeMaster.gain.setValueAtTime(0.0, now);
            this.gainNodeMaster.gain.linearRampToValueAtTime(1.0, now + upwardRamp);
        }

        runtimes.forEach((runtime) => {
            runtime.activeSource = null;

            if (!runtime.buffer || !runtime.gainNode) {
                return;
            }

            const buffer = runtime.buffer;
            const timing = runtime.timing || {
                trimStart: 0,
                padStart: 0,
                audioDuration: buffer.duration,
                effectiveDuration: buffer.duration,
            };

            if (timing.audioDuration <= 0) {
                return;
            }

            const positionInTrackTimeline = position - timing.padStart;
            let scheduleDelay = 0;
            let sourceOffset = timing.trimStart;
            let remainingAudioDuration = timing.audioDuration;

            if (positionInTrackTimeline < 0) {
                scheduleDelay = -positionInTrackTimeline;
            } else if (positionInTrackTimeline >= timing.audioDuration) {
                return;
            } else {
                sourceOffset = timing.trimStart + positionInTrackTimeline;
                remainingAudioDuration = timing.audioDuration - positionInTrackTimeline;
            }

            let startAt = now + scheduleDelay;
            let playDuration = remainingAudioDuration;

            if (snippetDuration !== undefined) {
                const snippetStart = now + downwardRamp;
                const snippetEnd = snippetStart + upwardRamp + snippetDuration;
                startAt = snippetStart + scheduleDelay;

                if (startAt >= snippetEnd) {
                    return;
                }

                playDuration = Math.min(remainingAudioDuration, snippetEnd - startAt);
            }

            if (playDuration <= 0) {
                return;
            }

            const sourceNode = this.context!.createBufferSource();
            sourceNode.buffer = buffer;
            sourceNode.connect(runtime.gainNode);
            sourceNode.start(startAt, sourceOffset, playDuration);
            runtime.activeSource = sourceNode;
        });

        return {
            startTime: now - position,
        };
    }

    stop(runtimes: TrackRuntime[]): void {
        if (!this.context || !this.gainNodeMaster || !this.canUseAudioGraph()) {
            runtimes.forEach(function(runtime) {
                runtime.activeSource = null;
            });
            return;
        }

        const now = this.context.currentTime;
        const downwardRamp = 0.03;

        this.gainNodeMaster.gain.cancelScheduledValues(now);
        this.gainNodeMaster.gain.setValueAtTime(1.0, now);
        this.gainNodeMaster.gain.linearRampToValueAtTime(0.0, now + downwardRamp);

        runtimes.forEach(function(runtime) {
            if (!runtime.activeSource) {
                return;
            }
            try {
                runtime.activeSource.stop(now + downwardRamp);
            } catch (_error) {
                // ignore
            }
            runtime.activeSource = null;
        });
    }

    disconnect(): void {
        this.gainNodeMaster?.disconnect();
        this.gainNodeVolume?.disconnect();
    }
}
