import { TrackRuntime, TrackTiming } from '../domain/types';

export class WaveformEngine {
    calculateWaveformPeaks(
        buffer: AudioBuffer,
        width: number,
        startOffsetSeconds = 0,
        durationSeconds?: number
    ): Float32Array {
        if (!buffer || width <= 0 || !Number.isFinite(width)) {
            return new Float32Array(0);
        }

        const channelData = buffer.getChannelData(0);
        const safeWidth = Math.max(1, Math.floor(width));
        if (channelData.length === 0) {
            return new Float32Array(safeWidth);
        }

        const rawSampleRate = Number(buffer.sampleRate);
        const rawDuration = Number(buffer.duration);
        const fallbackSampleRate = rawDuration > 0 ? channelData.length / rawDuration : channelData.length;
        const sampleRate = Number.isFinite(rawSampleRate) && rawSampleRate > 0
            ? rawSampleRate
            : Math.max(1, fallbackSampleRate);

        const safeStartOffsetSeconds = Number.isFinite(startOffsetSeconds) && startOffsetSeconds > 0
            ? startOffsetSeconds
            : 0;
        const startSample = Math.min(channelData.length, Math.floor(safeStartOffsetSeconds * sampleRate));
        const maxSampleLength = channelData.length - startSample;
        const safeDurationSeconds = durationSeconds !== undefined && Number.isFinite(durationSeconds)
            ? Math.max(0, durationSeconds)
            : (maxSampleLength / sampleRate);
        const segmentSampleLength = Math.min(maxSampleLength, Math.floor(safeDurationSeconds * sampleRate));
        const endSample = startSample + segmentSampleLength;

        if (segmentSampleLength <= 0) {
            return new Float32Array(safeWidth);
        }

        const samplesPerPixel = Math.max(1, Math.floor(segmentSampleLength / safeWidth));
        const peaks = new Float32Array(safeWidth);

        for (let x = 0; x < safeWidth; x += 1) {
            const start = startSample + (x * samplesPerPixel);
            if (start >= endSample) {
                break;
            }
            const end = Math.min(endSample, start + samplesPerPixel);
            let max = 0;

            for (let i = start; i < end; i += 1) {
                const sample = Math.abs(channelData[i]);
                if (sample > max) {
                    max = sample;
                }
            }

            peaks[x] = max;
        }

        return peaks;
    }

    getTrackPeaks(
        runtime: TrackRuntime,
        peakCount: number,
        barWidth: number,
        trimStartSeconds = 0,
        audioDurationSeconds?: number
    ): Float32Array | null {
        if (!runtime.buffer) {
            return null;
        }

        const count = Math.max(1, Math.floor(peakCount));
        const safeTrimStartSeconds = Number.isFinite(trimStartSeconds) && trimStartSeconds > 0
            ? trimStartSeconds
            : 0;
        const safeAudioDuration = audioDurationSeconds !== undefined && Number.isFinite(audioDurationSeconds)
            ? Math.max(0, audioDurationSeconds)
            : null;
        const key = [
            count,
            Math.max(1, Math.floor(barWidth)),
            safeTrimStartSeconds.toFixed(6),
            safeAudioDuration === null ? 'all' : safeAudioDuration.toFixed(6),
        ].join(':');

        const cached = runtime.waveformCache.get(key);
        if (cached) {
            return cached;
        }

        const peaks = this.calculateWaveformPeaks(
            runtime.buffer,
            count,
            safeTrimStartSeconds,
            safeAudioDuration === null ? undefined : safeAudioDuration
        );
        runtime.waveformCache.set(key, peaks);
        return peaks;
    }

    calculateMixedWaveform(
        runtimes: TrackRuntime[],
        peakCount: number,
        barWidth: number,
        timelineDuration?: number
    ): Float32Array | null {
        if (!runtimes.length || peakCount <= 0) {
            return null;
        }

        const count = Math.max(1, Math.floor(peakCount));
        const anySolo = runtimes.some(function(runtime) {
            return runtime.state.solo;
        });

        const audible = runtimes.filter(function(runtime) {
            return anySolo ? runtime.state.solo : !runtime.state.mute;
        });

        if (!audible.length) {
            return null;
        }

        const safeTimelineDuration = Number.isFinite(timelineDuration) && (timelineDuration as number) > 0
            ? (timelineDuration as number)
            : runtimes.reduce(function(longest, runtime) {
                return Math.max(longest, WaveformEngine.getRuntimeDuration(runtime));
            }, 0);

        if (safeTimelineDuration <= 0) {
            return null;
        }

        const mappedPeaks = audible
            .map((runtime) => this.getTrackTimelinePeaks(runtime, count, barWidth, safeTimelineDuration))
            .filter(function(peaks): peaks is Float32Array {
                return !!peaks;
            });

        if (!mappedPeaks.length) {
            return null;
        }

        if (mappedPeaks.length === 1) {
            return mappedPeaks[0];
        }

        const mixed = new Float32Array(count);
        for (let x = 0; x < count; x += 1) {
            let sum = 0;
            for (let i = 0; i < mappedPeaks.length; i += 1) {
                sum += mappedPeaks[i][x];
            }
            mixed[x] = sum / Math.sqrt(mappedPeaks.length);
        }

        return mixed;
    }

    private getTrackTimelinePeaks(
        runtime: TrackRuntime,
        peakCount: number,
        barWidth: number,
        timelineDuration: number
    ): Float32Array | null {
        if (!runtime.buffer) {
            return null;
        }

        const safePeakCount = Math.max(1, Math.floor(peakCount));
        const timelinePeaks = new Float32Array(safePeakCount);

        const timing = WaveformEngine.normalizeTiming(runtime);
        const trimStart = timing ? timing.trimStart : 0;
        const padStart = timing ? timing.padStart : 0;
        const audioDuration = timing ? timing.audioDuration : WaveformEngine.getRuntimeDuration(runtime);

        if (audioDuration <= 0 || timelineDuration <= 0) {
            return timelinePeaks;
        }

        const waveformStart = Math.round((padStart / timelineDuration) * safePeakCount);
        const waveformLength = Math.max(1, Math.round((audioDuration / timelineDuration) * safePeakCount));
        const trackPeaks = this.getTrackPeaks(runtime, waveformLength, barWidth, trimStart, audioDuration);

        if (!trackPeaks) {
            return null;
        }

        for (let x = 0; x < trackPeaks.length; x += 1) {
            const targetIndex = waveformStart + x;
            if (targetIndex < 0) {
                continue;
            }
            if (targetIndex >= safePeakCount) {
                break;
            }
            timelinePeaks[targetIndex] = trackPeaks[x];
        }

        return timelinePeaks;
    }

    private static normalizeTiming(runtime: TrackRuntime): TrackTiming | null {
        if (!runtime.buffer) {
            return null;
        }

        const rawTiming = runtime.timing;
        if (!rawTiming) {
            const bufferDuration = Number(runtime.buffer.duration);
            const safeBufferDuration = Number.isFinite(bufferDuration) && bufferDuration > 0 ? bufferDuration : 1;
            return {
                trimStart: 0,
                padStart: 0,
                audioDuration: safeBufferDuration,
                effectiveDuration: safeBufferDuration,
            };
        }

        const trimStart = Number.isFinite(rawTiming.trimStart) && rawTiming.trimStart > 0 ? rawTiming.trimStart : 0;
        const padStart = Number.isFinite(rawTiming.padStart) && rawTiming.padStart > 0 ? rawTiming.padStart : 0;
        const audioDuration = Number.isFinite(rawTiming.audioDuration) && rawTiming.audioDuration > 0
            ? rawTiming.audioDuration
            : 0;
        const effectiveDuration = Number.isFinite(rawTiming.effectiveDuration) && rawTiming.effectiveDuration > 0
            ? rawTiming.effectiveDuration
            : (padStart + audioDuration);

        return {
            trimStart: trimStart,
            padStart: padStart,
            audioDuration: audioDuration,
            effectiveDuration: effectiveDuration,
        };
    }

    private static getRuntimeDuration(runtime: TrackRuntime): number {
        const timing = WaveformEngine.normalizeTiming(runtime);
        if (timing && timing.effectiveDuration > 0) {
            return timing.effectiveDuration;
        }
        return 1;
    }

    drawWaveform(
        canvas: HTMLCanvasElement,
        context: CanvasRenderingContext2D,
        peaks: Float32Array | null,
        barWidth: number
    ): void {
        const width = canvas.width;
        const height = canvas.height;

        context.clearRect(0, 0, width, height);

        if (!peaks || peaks.length === 0) {
            return;
        }

        let maxPeak = 0;
        for (let i = 0; i < peaks.length; i += 1) {
            if (peaks[i] > maxPeak) {
                maxPeak = peaks[i];
            }
        }

        if (maxPeak <= 0) {
            maxPeak = 1;
        }

        const waveformColor = getComputedStyle(canvas).getPropertyValue('--waveform-color').trim() || '#ED8C01';
        context.fillStyle = waveformColor;

        for (let x = 0; x < peaks.length && x < width; x += 1) {
            const normalized = peaks[x] / maxPeak;
            const barHeight = normalized * height * 0.95;
            const y = (height - barHeight) / 2;
            context.fillRect(x * barWidth, y, barWidth, barHeight);
        }
    }

    drawPlaceholder(
        canvas: HTMLCanvasElement,
        context: CanvasRenderingContext2D,
        barWidth: number,
        alpha: number
    ): void {
        const width = canvas.width;
        const height = canvas.height;

        context.clearRect(0, 0, width, height);

        const waveformColor = getComputedStyle(canvas).getPropertyValue('--waveform-color').trim() || '#ED8C01';
        context.fillStyle = waveformColor;
        context.globalAlpha = alpha;

        const bars = Math.max(1, Math.floor(width / barWidth));
        for (let x = 0; x < bars; x += 1) {
            const waveA = Math.sin(x * 0.21);
            const waveB = Math.sin(x * 0.051 + 0.8);
            const amplitude = 0.25 + 0.75 * (Math.abs(waveA + waveB) / 2);
            const barHeight = amplitude * height * 0.7;
            const y = (height - barHeight) / 2;
            context.fillRect(x * barWidth, y, barWidth, barHeight);
        }

        context.globalAlpha = 1;
    }
}
