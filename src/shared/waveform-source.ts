import type { TrackRuntime, WaveformSourceIndex } from "../domain/types";

function normalizeTrackIndex(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}

	return Math.floor(value);
}

function normalizeWaveformSource(
	value: WaveformSourceIndex | undefined,
): WaveformSourceIndex {
	if (value === "audible" || value === undefined) {
		return "audible";
	}

	if (Array.isArray(value)) {
		const normalized: number[] = [];
		const seen = new Set<number>();

		value.forEach((entry) => {
			const normalizedEntry = normalizeTrackIndex(entry);
			if (normalizedEntry === null || seen.has(normalizedEntry)) {
				return;
			}

			seen.add(normalizedEntry);
			normalized.push(normalizedEntry);
		});

		return normalized;
	}

	const normalized = normalizeTrackIndex(value);
	return normalized === null ? "audible" : normalized;
}

export function serializeWaveformSource(
	value: WaveformSourceIndex | undefined,
): string {
	const normalized = normalizeWaveformSource(value);
	return Array.isArray(normalized)
		? JSON.stringify(normalized)
		: String(normalized);
}

function resolveFixedWaveformTrackIndex(
	runtimesLength: number,
	waveformSource: WaveformSourceIndex,
): number | null {
	if (waveformSource === "audible" || Array.isArray(waveformSource)) {
		return null;
	}

	return waveformSource >= 0 && waveformSource < runtimesLength
		? waveformSource
		: null;
}

export function resolveWaveformTrackIndices(
	runtimesLength: number,
	waveformSource: WaveformSourceIndex,
): number[] {
	if (waveformSource === "audible") {
		return Array.from({ length: runtimesLength }, (_value, index) => index);
	}

	if (Array.isArray(waveformSource)) {
		return waveformSource.filter(
			(trackIndex) => trackIndex >= 0 && trackIndex < runtimesLength,
		);
	}

	return waveformSource >= 0 && waveformSource < runtimesLength
		? [waveformSource]
		: [];
}

/**
 * `isExclusiveSoloTrack` answers, per track, whether its `trackList` permits only
 * one audible track — such a track still counts as audible while nothing at all is
 * soloed, because that list always resolves to one of its rows.
 */
export function isWaveformTrackAudible(
	runtimes: TrackRuntime[],
	trackIndex: number,
	waveformSource: WaveformSourceIndex,
	isAlignmentMode: boolean,
	isExclusiveSoloTrack: (trackIndex: number) => boolean,
): boolean {
	const runtime = runtimes[trackIndex];
	if (!runtime || runtime.state.volume <= 0) {
		return false;
	}

	if (isAlignmentMode) {
		// Fixed/array sources always show their bound track(s) regardless of solo
		// (e.g. two side-by-side comparison waveforms). Only the dynamic "audible"
		// source follows solo.
		return waveformSource === "audible" ? runtime.state.solo : true;
	}

	const anySolo = runtimes.some((entry) => entry.state.solo);
	if (anySolo) {
		return runtime.state.solo;
	}

	return isExclusiveSoloTrack(trackIndex);
}

/**
 * The single track index a surface's "audible" source currently resolves to —
 * used to bind peak rendering, seeking, marker projection, and playhead
 * position to that track's own local timeline instead of the flat,
 * projector-warped reference timeline. A fixed source always resolves to its
 * own index. An "audible" source resolves to the first soloed track — under
 * alignment everything audible at once lives on that track's timeline.
 */
export function resolveAudibleWaveformTrackIndex(
	runtimes: TrackRuntime[],
	waveformSource: WaveformSourceIndex,
	isAlignmentMode: boolean,
	isExclusiveSoloTrack: (trackIndex: number) => boolean,
): number | null {
	const fixedTrackIndex = resolveFixedWaveformTrackIndex(
		runtimes.length,
		waveformSource,
	);
	if (fixedTrackIndex !== null) {
		return fixedTrackIndex;
	}
	if (waveformSource !== "audible") {
		return null;
	}

	const audibleIndex = resolveWaveformTrackIndices(
		runtimes.length,
		waveformSource,
	).find((trackIndex) =>
		isWaveformTrackAudible(
			runtimes,
			trackIndex,
			waveformSource,
			isAlignmentMode,
			isExclusiveSoloTrack,
		),
	);
	return audibleIndex ?? null;
}
