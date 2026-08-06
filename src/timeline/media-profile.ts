import type {
	MediaConfig,
	MediaEntryConfig,
	TrackTiming,
} from "../domain/types";
import type { TimelineExtent, TimelineUnit } from "./timeline";

/**
 * The coordinate a medium is actually played back in. Everything downstream of
 * alignment parsing — the projection graph, extents, markers, loop points —
 * speaks native units only.
 */
export type NativeUnit = "seconds" | "measures" | "percent";

/**
 * What a medium contributes to its timeline: the unit it plays back in, how far
 * it reaches, and how to convert between a declared column unit and that native
 * coordinate.
 */
export interface MediaProfile {
	readonly nativeUnit: NativeUnit;
	readonly extent: TimelineExtent;
	toNative(value: number, declared: TimelineUnit): number;
	fromNative(value: number, declared: TimelineUnit): number;
}

/**
 * Converts a native reference position into its declared display unit while
 * keeping the playable origin at zero. Source trimming affects alignment
 * placement, but must not reappear as an offset in the player readout.
 */
export function referenceReadoutValue(
	profile: MediaProfile,
	value: number,
	declared: TimelineUnit,
): number {
	return profile.fromNative(value, declared) - profile.fromNative(0, declared);
}

/**
 * Inverse of `referenceReadoutValue`: a value authored in the unit the player
 * reads out, on that same zero-based origin, back into the native coordinate.
 */
export function referenceNativeValue(
	profile: MediaProfile,
	value: number,
	declared: TimelineUnit,
): number {
	return profile.toNative(value + profile.fromNative(0, declared), declared);
}

/** Units a column may be declared in, per media type. First entry is the default. */
const UNITS_BY_MEDIA_TYPE: Record<string, readonly TimelineUnit[]> = {
	audio: ["seconds", "samples"],
	midi: ["seconds", "ticks"],
	musicxml: ["measures"],
	image: ["percent", "pixels"],
};

/**
 * The unit a timeline speaks: the medium's declared `timelineUnit`, else the
 * native unit of its type. A timeline with no medium has neither, so its values
 * stand as they are.
 */
export function resolveTimelineUnit(
	mediaEntry: MediaEntryConfig | undefined,
): TimelineUnit {
	return mediaEntry?.timelineUnit ?? defaultUnitForMediaType(mediaEntry?.type);
}

/**
 * The unit of the single implicit timeline a player without an alignment runs
 * on. Every medium shares that timeline, so the first one that declares a
 * `timelineUnit` names it — and lends its profile for the conversion.
 */
export function resolveImplicitTimelineUnit(
	media: MediaConfig,
): { unit: TimelineUnit; mediaId: string } | null {
	for (const [mediaId, entry] of Object.entries(media)) {
		if (entry.timelineUnit !== undefined) {
			return { unit: entry.timelineUnit, mediaId };
		}
	}
	return null;
}

function defaultUnitForMediaType(type: string | undefined): TimelineUnit {
	if (!type) {
		return "seconds";
	}
	return UNITS_BY_MEDIA_TYPE[type]?.[0] ?? "seconds";
}

export function allowedUnitsForMediaType(
	type: string | undefined,
): readonly TimelineUnit[] | null {
	if (!type) {
		return null;
	}
	return UNITS_BY_MEDIA_TYPE[type] ?? null;
}

/**
 * A medium whose extent could not be probed, or a timeline with no medium at
 * all: the declared unit is taken to be the native one and the extent falls
 * back to whatever the alignment CSV covers.
 */
export function createIdentityProfile(
	nativeUnit: NativeUnit,
	extent: TimelineExtent,
): MediaProfile {
	return {
		nativeUnit,
		extent,
		toNative: (value) => value,
		fromNative: (value) => value,
	};
}

/**
 * Audio: seconds natively, with source coordinates shifted onto the trimmed or
 * padded playback timeline. Sample indices are scaled by the rate of the encoded
 * file — not by the decoded buffer's rate, which is the AudioContext's output
 * rate and unrelated to the coordinates a `samples` column is authored in.
 */
export function createAudioProfile(
	durationSeconds: number,
	sourceSampleRate: number | null,
	timing: TrackTiming,
	trackId: string,
): MediaProfile {
	const requireRate = (): number => {
		if (sourceSampleRate === null) {
			throw new Error(
				`Track "${trackId}" declares an alignment column in samples, but the ` +
					"sample rate of its audio file could not be read from the file header. " +
					"Use seconds for this column, or provide the audio in a container " +
					"whose header trackswitch reads (WAV, FLAC, Ogg, MP3, MP4).",
			);
		}
		return sourceSampleRate;
	};
	const playbackOffset = timing.padStart - timing.trimStart;
	return {
		nativeUnit: "seconds",
		extent: { start: 0, end: durationSeconds },
		toNative: (value, declared) =>
			(declared === "samples" ? value / requireRate() : value) + playbackOffset,
		fromNative: (value, declared) =>
			declared === "samples"
				? (value - playbackOffset) * requireRate()
				: value - playbackOffset,
	};
}

/**
 * MIDI: seconds natively. Tick conversion goes through the file's header rather
 * than a plain division by PPQ, so files with tempo changes convert correctly.
 */
export function createMidiProfile(
	durationSeconds: number,
	header: {
		ticksToSeconds(ticks: number): number;
		secondsToTicks(seconds: number): number;
	} | null,
): MediaProfile {
	return {
		nativeUnit: "seconds",
		extent: { start: 0, end: durationSeconds },
		toNative: (value, declared) =>
			declared === "ticks" && header ? header.ticksToSeconds(value) : value,
		fromNative: (value, declared) =>
			declared === "ticks" && header ? header.secondsToTicks(value) : value,
	};
}

/** A score: measure numbers natively, spanning the measures OSMD found. */
export function createScoreProfile(availableMeasures: number[]): MediaProfile {
	const start = availableMeasures.length > 0 ? availableMeasures[0] : 0;
	const end =
		availableMeasures.length > 0
			? availableMeasures[availableMeasures.length - 1]
			: 0;
	return createIdentityProfile("measures", { start, end });
}

/**
 * An image: percent of its width natively, because that is the coordinate the
 * seek geometry already works in. Pixel columns scale by the decoded width.
 */
function createImageProfile(naturalWidth: number): MediaProfile {
	const usableWidth =
		Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : 0;
	return {
		nativeUnit: "percent",
		extent: { start: 0, end: 100 },
		toNative: (value, declared) =>
			declared === "pixels" && usableWidth > 0
				? (value * 100) / usableWidth
				: value,
		fromNative: (value, declared) =>
			declared === "pixels" && usableWidth > 0
				? (value * usableWidth) / 100
				: value,
	};
}

/** Decodes an image just far enough to read its natural width. */
export async function probeImageProfile(src: string): Promise<MediaProfile> {
	const image = new Image();
	image.src = src;
	try {
		await image.decode();
	} catch (error) {
		console.warn(
			"[trackswitch] Failed to decode image media source:",
			src,
			error,
		);
	}
	return createImageProfile(image.naturalWidth);
}

export function nativeUnitForMediaEntry(
	entry: MediaEntryConfig | undefined,
): NativeUnit {
	if (entry?.type === "musicxml") {
		return "measures";
	}
	if (entry?.type === "image") {
		return "percent";
	}
	return "seconds";
}
