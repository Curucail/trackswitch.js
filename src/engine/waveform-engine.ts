import { TrackRuntime } from '../domain/types';

export class WaveformEngine {
    calculateWaveformPeaks(buffer: AudioBuffer, width: number): Float32Array {
        if (!buffer || width <= 0 || !Number.isFinite(width)) {
            return new Float32Array(0);
        }

        const channelData = buffer.getChannelData(0);
        const safeWidth = Math.max(1, Math.floor(width));
        const samplesPerPixel = Math.max(1, Math.floor(channelData.length / safeWidth));
        const peaks = new Float32Array(safeWidth);

        for (let x = 0; x < safeWidth; x += 1) {
            const start = x * samplesPerPixel;
            const end = Math.min(channelData.length, start + samplesPerPixel);
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

    getTrackPeaks(runtime: TrackRuntime, peakCount: number, barWidth: number): Float32Array | null {
        if (!runtime.buffer) {
            return null;
        }

        const count = Math.max(1, Math.floor(peakCount));
        const key = count + ':' + Math.max(1, Math.floor(barWidth));

        const cached = runtime.waveformCache.get(key);
        if (cached) {
            return cached;
        }

        const peaks = this.calculateWaveformPeaks(runtime.buffer, count);
        runtime.waveformCache.set(key, peaks);
        return peaks;
    }

    calculateMixedWaveform(runtimes: TrackRuntime[], peakCount: number, barWidth: number): Float32Array | null {
        if (!runtimes.length || peakCount <= 0) {
            return null;
        }

        const anySolo = runtimes.some(function(runtime) {
            return runtime.state.solo;
        });

        const audible = runtimes.filter(function(runtime) {
            return anySolo ? runtime.state.solo : !runtime.state.mute;
        });

        if (!audible.length) {
            return null;
        }

        if (audible.length === 1) {
            return this.getTrackPeaks(audible[0], peakCount, barWidth);
        }

        const base = this.getTrackPeaks(audible[0], peakCount, barWidth);
        if (!base) {
            return null;
        }

        const mixed = new Float32Array(base.length);
        for (let x = 0; x < base.length; x += 1) {
            let sum = 0;
            for (let i = 0; i < audible.length; i += 1) {
                const peaks = this.getTrackPeaks(audible[i], peakCount, barWidth);
                if (peaks && x < peaks.length) {
                    sum += peaks[x];
                }
            }
            mixed[x] = sum / Math.sqrt(audible.length);
        }

        return mixed;
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
