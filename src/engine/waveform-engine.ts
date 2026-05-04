import { TrackRuntime, TrackTiming, WaveformSummary, WaveformSummaryLevel } from '../domain/types';

export type TrackTimelineProjector = (runtime: TrackRuntime, trackTimelineTimeSeconds: number) => number;

const SUMMARY_WINDOW_SAMPLES = 256;
const RMS_BLEND = 0.18;

export class WaveformEngine {
    createSummary(buffer: AudioBuffer): WaveformSummary {
        const sampleRate = WaveformEngine.resolveSampleRate(buffer);
        const sampleCount = buffer.length;
        const duration = Number.isFinite(buffer.duration) && buffer.duration > 0
            ? buffer.duration
            : sampleCount / sampleRate;
        const levels: WaveformSummaryLevel[] = [];

        if (sampleCount <= 0) {
            return {
                duration: Math.max(0, duration),
                sampleRate,
                sampleCount: 0,
                levels: [{
                    samplesPerEntry: SUMMARY_WINDOW_SAMPLES,
                    peaks: new Float32Array(0),
                    rms: new Float32Array(0),
                }],
            };
        }

        levels.push(this.createBaseSummaryLevel(buffer));
        while (levels[levels.length - 1].peaks.length > 1) {
            levels.push(this.createCoarserSummaryLevel(levels[levels.length - 1]));
        }

        return {
            duration,
            sampleRate,
            sampleCount,
            levels,
        };
    }

    getTrackPeaks(
        runtime: TrackRuntime,
        peakCount: number,
        startSeconds = 0,
        durationSeconds?: number
    ): Float32Array | null {
        if (!runtime.waveformSummary) {
            return null;
        }

        return this.querySummary(
            runtime.waveformSummary,
            peakCount,
            startSeconds,
            durationSeconds
        );
    }

    calculateMixedWaveform(
        runtimes: TrackRuntime[],
        peakCount: number,
        _barWidth: number,
        timelineDuration?: number,
        trackTimelineProjector?: TrackTimelineProjector
    ): Float32Array | null {
        if (!runtimes.length || peakCount <= 0) {
            return null;
        }

        const count = Math.max(1, Math.floor(peakCount));
        const audible = runtimes.filter(function(runtime) {
            return runtime.state.volume > 0;
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
            .map((runtime) => {
                const peaks = this.getTrackTimelinePeaks(
                    runtime,
                    count,
                    safeTimelineDuration,
                    trackTimelineProjector
                );
                if (!peaks) {
                    return null;
                }

                const weight = Math.max(0, Math.min(1, runtime.state.volume));
                if (weight >= 0.999999) {
                    return peaks;
                }

                const scaled = new Float32Array(peaks.length);
                for (let index = 0; index < peaks.length; index += 1) {
                    scaled[index] = peaks[index] * weight;
                }
                return scaled;
            })
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

    private createBaseSummaryLevel(buffer: AudioBuffer): WaveformSummaryLevel {
        const sampleCount = buffer.length;
        const entryCount = Math.max(1, Math.ceil(sampleCount / SUMMARY_WINDOW_SAMPLES));
        const peaks = new Float32Array(entryCount);
        const rms = new Float32Array(entryCount);
        const channelCount = Math.max(1, buffer.numberOfChannels);
        const channels: Float32Array[] = [];

        for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
            channels.push(buffer.getChannelData(channelIndex));
        }

        for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
            const start = entryIndex * SUMMARY_WINDOW_SAMPLES;
            const end = Math.min(sampleCount, start + SUMMARY_WINDOW_SAMPLES);
            let peak = 0;
            let squareSum = 0;
            let count = 0;

            for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
                let sample = 0;
                for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
                    const channelSample = Math.abs(channels[channelIndex][sampleIndex]);
                    if (channelSample > sample) {
                        sample = channelSample;
                    }
                }

                if (sample > peak) {
                    peak = sample;
                }
                squareSum += sample * sample;
                count += 1;
            }

            peaks[entryIndex] = peak;
            rms[entryIndex] = count > 0 ? Math.sqrt(squareSum / count) : 0;
        }

        return {
            samplesPerEntry: SUMMARY_WINDOW_SAMPLES,
            peaks,
            rms,
        };
    }

    private createCoarserSummaryLevel(previous: WaveformSummaryLevel): WaveformSummaryLevel {
        const entryCount = Math.max(1, Math.ceil(previous.peaks.length / 2));
        const peaks = new Float32Array(entryCount);
        const rms = new Float32Array(entryCount);

        for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
            const sourceIndex = entryIndex * 2;
            const peakA = previous.peaks[sourceIndex] || 0;
            const peakB = previous.peaks[sourceIndex + 1] || 0;
            const rmsA = previous.rms[sourceIndex] || 0;
            const rmsB = previous.rms[sourceIndex + 1] || 0;
            const hasB = sourceIndex + 1 < previous.rms.length;

            peaks[entryIndex] = Math.max(peakA, peakB);
            rms[entryIndex] = hasB
                ? Math.sqrt(((rmsA * rmsA) + (rmsB * rmsB)) / 2)
                : rmsA;
        }

        return {
            samplesPerEntry: previous.samplesPerEntry * 2,
            peaks,
            rms,
        };
    }

    private querySummary(
        summary: WaveformSummary,
        peakCount: number,
        startSeconds = 0,
        durationSeconds?: number
    ): Float32Array {
        const count = Math.max(1, Math.floor(peakCount));
        const peaks = new Float32Array(count);
        if (!summary.levels.length || summary.sampleCount <= 0) {
            return peaks;
        }

        const safeStartSeconds = Number.isFinite(startSeconds) && startSeconds > 0
            ? startSeconds
            : 0;
        const maxDurationSeconds = Math.max(0, summary.duration - safeStartSeconds);
        const safeDurationSeconds = durationSeconds !== undefined && Number.isFinite(durationSeconds)
            ? Math.max(0, Math.min(durationSeconds, maxDurationSeconds))
            : maxDurationSeconds;

        if (safeDurationSeconds <= 0) {
            return peaks;
        }

        const startSample = Math.min(summary.sampleCount, Math.floor(safeStartSeconds * summary.sampleRate));
        const endSample = Math.min(
            summary.sampleCount,
            Math.max(startSample, Math.ceil((safeStartSeconds + safeDurationSeconds) * summary.sampleRate))
        );
        const samplesPerPeak = Math.max(1, (endSample - startSample) / count);
        const level = this.selectSummaryLevel(summary, samplesPerPeak);

        for (let peakIndex = 0; peakIndex < count; peakIndex += 1) {
            const rangeStartSample = startSample + Math.floor(peakIndex * samplesPerPeak);
            const rangeEndSample = peakIndex === count - 1
                ? endSample
                : startSample + Math.ceil((peakIndex + 1) * samplesPerPeak);
            const startEntry = Math.max(0, Math.floor(rangeStartSample / level.samplesPerEntry));
            const endEntry = Math.min(
                level.peaks.length,
                Math.max(startEntry + 1, Math.ceil(rangeEndSample / level.samplesPerEntry))
            );
            let peak = 0;
            let squareSum = 0;
            let entryCount = 0;

            for (let entryIndex = startEntry; entryIndex < endEntry; entryIndex += 1) {
                const entryPeak = level.peaks[entryIndex];
                const entryRms = level.rms[entryIndex];
                if (entryPeak > peak) {
                    peak = entryPeak;
                }
                squareSum += entryRms * entryRms;
                entryCount += 1;
            }

            const rms = entryCount > 0 ? Math.sqrt(squareSum / entryCount) : 0;
            peaks[peakIndex] = (peak * (1 - RMS_BLEND)) + (rms * RMS_BLEND);
        }

        return peaks;
    }

    private selectSummaryLevel(summary: WaveformSummary, samplesPerPeak: number): WaveformSummaryLevel {
        let selected = summary.levels[0];
        for (let index = 1; index < summary.levels.length; index += 1) {
            const candidate = summary.levels[index];
            if (candidate.samplesPerEntry > samplesPerPeak) {
                break;
            }
            selected = candidate;
        }
        return selected;
    }

    private getTrackTimelinePeaks(
        runtime: TrackRuntime,
        peakCount: number,
        timelineDuration: number,
        trackTimelineProjector?: TrackTimelineProjector
    ): Float32Array | null {
        if (!runtime.waveformSummary) {
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

        const waveformLength = Math.max(1, Math.round((audioDuration / timelineDuration) * safePeakCount));
        const trackPeaks = this.getTrackPeaks(runtime, waveformLength, trimStart, audioDuration);

        if (!trackPeaks) {
            return null;
        }

        if (!trackTimelineProjector) {
            const waveformStart = Math.round((padStart / timelineDuration) * safePeakCount);

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

        let previousTargetIndex: number | null = null;
        let previousPeak = 0;

        for (let x = 0; x < trackPeaks.length; x += 1) {
            const peak = trackPeaks[x];
            if (peak <= 0) {
                previousTargetIndex = null;
                previousPeak = 0;
                continue;
            }

            const fraction = trackPeaks.length <= 1 ? 0 : (x / (trackPeaks.length - 1));
            const trackTimelineTime = padStart + (fraction * audioDuration);
            const mappedTimelineTime = trackTimelineProjector(runtime, trackTimelineTime);

            if (!Number.isFinite(mappedTimelineTime) || mappedTimelineTime < 0 || mappedTimelineTime > timelineDuration) {
                previousTargetIndex = null;
                continue;
            }

            const targetIndex = Math.min(
                safePeakCount - 1,
                Math.floor((mappedTimelineTime / timelineDuration) * safePeakCount)
            );
            this.mergeTimelinePeak(timelinePeaks, targetIndex, peak);

            if (previousTargetIndex !== null && previousTargetIndex !== targetIndex) {
                const distance = targetIndex - previousTargetIndex;
                const step = distance > 0 ? 1 : -1;
                for (let cursor: number = previousTargetIndex + step; cursor !== targetIndex; cursor += step) {
                    const t = Math.abs((cursor - previousTargetIndex) / distance);
                    const interpolatedPeak = previousPeak + ((peak - previousPeak) * t);
                    this.mergeTimelinePeak(timelinePeaks, cursor, interpolatedPeak);
                }
            }

            previousTargetIndex = targetIndex;
            previousPeak = peak;
        }

        return timelinePeaks;
    }

    private mergeTimelinePeak(target: Float32Array, index: number, peak: number): void {
        if (index < 0 || index >= target.length || !Number.isFinite(peak)) {
            return;
        }
        if (peak > target[index]) {
            target[index] = peak;
        }
    }

    private static normalizeTiming(runtime: TrackRuntime): TrackTiming | null {
        if (!runtime.waveformSummary && !runtime.buffer) {
            return null;
        }

        const rawTiming = runtime.timing;
        if (!rawTiming) {
            const summaryDuration = runtime.waveformSummary ? runtime.waveformSummary.duration : 0;
            const bufferDuration = runtime.buffer ? Number(runtime.buffer.duration) : 0;
            const safeDuration = Number.isFinite(summaryDuration) && summaryDuration > 0
                ? summaryDuration
                : (Number.isFinite(bufferDuration) && bufferDuration > 0 ? bufferDuration : 1);
            return {
                trimStart: 0,
                padStart: 0,
                audioDuration: safeDuration,
                effectiveDuration: safeDuration,
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

    private static resolveSampleRate(buffer: AudioBuffer): number {
        const rawSampleRate = Number(buffer.sampleRate);
        if (Number.isFinite(rawSampleRate) && rawSampleRate > 0) {
            return rawSampleRate;
        }

        const rawDuration = Number(buffer.duration);
        return rawDuration > 0 ? Math.max(1, buffer.length / rawDuration) : Math.max(1, buffer.length);
    }

    drawWaveform(
        canvas: HTMLCanvasElement,
        context: CanvasRenderingContext2D,
        peaks: Float32Array | null,
        barWidth: number,
        normalizationPeak?: number,
        waveformColor?: string
    ): void {
        const width = canvas.width;
        const height = canvas.height;

        context.clearRect(0, 0, width, height);

        if (!peaks || peaks.length === 0) {
            return;
        }

        let maxPeak = Number.isFinite(normalizationPeak) && (normalizationPeak as number) > 0
            ? (normalizationPeak as number)
            : 0;
        if (maxPeak <= 0) {
            for (let i = 0; i < peaks.length; i += 1) {
                if (peaks[i] > maxPeak) {
                    maxPeak = peaks[i];
                }
            }
        }

        if (maxPeak <= 0) {
            maxPeak = 1;
        }

        context.fillStyle = waveformColor || getComputedStyle(canvas).getPropertyValue('--waveform-color').trim() || '#ED8C01';

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
        alpha: number,
        waveformColor?: string
    ): void {
        const width = canvas.width;
        const height = canvas.height;

        context.clearRect(0, 0, width, height);

        context.fillStyle = waveformColor || getComputedStyle(canvas).getPropertyValue('--waveform-color').trim() || '#ED8C01';
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
