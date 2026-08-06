import { Midi } from "@tonejs/midi";
import type { MediaConfig, TrackRuntime } from "../domain/types";
import {
	createAudioProfile,
	createMidiProfile,
	createScoreProfile,
	type MediaProfile,
	probeImageProfile,
} from "../timeline/media-profile";
import { type TimelineId, timelineId } from "../timeline/timeline";

export interface MediaProfileSources {
	media: MediaConfig;
	runtimes: TrackRuntime[];
	/** Already-parsed MIDI files keyed by source url, so nothing is fetched twice. */
	midiBySource?: ReadonlyMap<string, Midi>;
	/** Measure numbers OSMD found, keyed by the score's media id. */
	measuresByMediaId?: ReadonlyMap<string, number[]>;
}

/**
 * Reads each medium's natural extent and unit conversions once every medium has
 * loaded but before the alignment is resolved — the alignment needs the media's
 * own coordinates to interpret its columns and map them onto the reference.
 */
export async function probeMediaProfiles(
	sources: MediaProfileSources,
): Promise<Map<TimelineId, MediaProfile>> {
	const profiles = new Map<TimelineId, MediaProfile>();

	sources.runtimes.forEach((runtime) => {
		const timing = runtime.timing;
		if (!timing || !Number.isFinite(timing.effectiveDuration)) {
			return;
		}
		profiles.set(
			timelineId(runtime.definition.id),
			createAudioProfile(
				timing.effectiveDuration,
				runtime.sourceSampleRate,
				timing,
				runtime.definition.id,
			),
		);
	});

	sources.measuresByMediaId?.forEach((measures, mediaId) => {
		if (measures.length === 0) {
			return;
		}
		profiles.set(timelineId(mediaId), createScoreProfile(measures));
	});

	await Promise.all(
		Object.entries(sources.media).map(async ([mediaId, entry]) => {
			if (entry.type === "image") {
				profiles.set(timelineId(mediaId), await probeImageProfile(entry.src));
				return;
			}
			if (entry.type !== "midi") {
				return;
			}

			const midi =
				sources.midiBySource?.get(entry.src) ?? (await loadMidi(entry.src));
			if (!midi) {
				return;
			}
			profiles.set(
				timelineId(mediaId),
				createMidiProfile(midi.duration, midi.header),
			);
		}),
	);

	return profiles;
}

async function loadMidi(source: string): Promise<Midi | null> {
	try {
		return await Midi.fromUrl(source);
	} catch (error) {
		console.warn(
			"[trackswitch] Failed to load MIDI media source:",
			source,
			error,
		);
		return null;
	}
}
