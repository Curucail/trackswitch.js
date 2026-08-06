import type { OpenSheetMusicDisplayType } from "./osmd";

/**
 * A score carries two measure numberings, and they only coincide when the score
 * happens to start at bar 1:
 *
 * - the **internal** number, OSMD's own counter, which always runs 1..N;
 * - the **printed** number, which is the MusicXML `<measure number>` whenever it
 *   is an integer — the number a reader sees engraved on the page. This is what
 *   `SourceMeasure.getPrintedMeasureNumber()` returns under OSMD's default
 *   `UseXMLMeasureNumbers` rule, and it is what OSMD renders.
 *
 * Everything facing the outside world — the `measure` column of an alignment
 * CSV, marker positions, the score timeline's extent — speaks printed numbers,
 * so an excerpt starting at bar 231 is annotated as 231 rather than renumbered
 * down to 1. Cursor stepping speaks internal numbers, because only those are
 * guaranteed unique and gapless: printed numbers may repeat or jump.
 *
 * This table is the single crossing point between the two.
 */
export interface ScoreMeasureNumbering {
	/** Printed numbers the score covers, ascending and unique. */
	printed: number[];
	printedSet: Set<number>;
	internalByPrinted: Map<number, number>;
	printedByInternal: Map<number, number>;
}

export function createEmptyMeasureNumbering(): ScoreMeasureNumbering {
	return {
		printed: [],
		printedSet: new Set<number>(),
		internalByPrinted: new Map<number, number>(),
		printedByInternal: new Map<number, number>(),
	};
}

export function buildMeasureNumbering(
	osmd: OpenSheetMusicDisplayType,
): ScoreMeasureNumbering {
	const sourceMeasures = osmd.Sheet?.SourceMeasures;
	if (!Array.isArray(sourceMeasures)) {
		return createEmptyMeasureNumbering();
	}

	const numbering = createEmptyMeasureNumbering();

	sourceMeasures.forEach((measure) => {
		const internal = Math.floor(Number(measure?.MeasureNumber));
		if (!Number.isFinite(internal)) {
			return;
		}

		const printed = Math.floor(Number(measure.getPrintedMeasureNumber()));
		if (!Number.isFinite(printed)) {
			return;
		}

		numbering.printedByInternal.set(internal, printed);
		// A printed number repeated across measures (a written-out repeat, say)
		// resolves to its first occurrence, so seeking to it always lands on the
		// same bar.
		if (!numbering.internalByPrinted.has(printed)) {
			numbering.internalByPrinted.set(printed, internal);
			numbering.printedSet.add(printed);
		}
	});

	numbering.printed = Array.from(numbering.printedSet).sort((a, b) => a - b);

	return numbering;
}
