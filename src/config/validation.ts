import type { TrackSwitchCssOverrides } from "../domain/types";
import { cssTokens } from "../generated/css-tokens";

const knownCssTokens = new Set<string>(cssTokens);

export function toConfigRecord(
	value: unknown,
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid ${label} configuration.`);
	}

	return value as Record<string, unknown>;
}

/**
 * Ties a runtime key list to the interface it guards: a key the interface does
 * not declare, or a declared key the list omits, is a compile error. Without
 * this the two drift silently, which is how `sheetMusic.markerLayers` ended up
 * type-checking and then throwing at load.
 */
export function keysOf<T>() {
	return <K extends readonly (keyof T & string)[]>(
		keys: K & ([keyof T] extends [K[number]] ? unknown : never),
	): K => keys;
}

export function assertAllowedKeys(
	target: Record<string, unknown>,
	allowedKeys: readonly string[],
	label: string,
): void {
	const allowed = new Set(allowedKeys);
	Object.keys(target).forEach((key) => {
		if (!allowed.has(key)) {
			throw new Error(
				"Invalid " +
					label +
					" key: " +
					key +
					". Allowed keys: " +
					allowedKeys.join(", "),
			);
		}
	});
}

/**
 * Validates a `css` block: names must be public `--ts-*` tokens, so a typo
 * fails at load rather than silently setting a property nothing reads.
 */
export function normalizeCssOverrides(
	value: unknown,
	label: string,
): TrackSwitchCssOverrides | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = toConfigRecord(value, `${label}.css`);
	Object.entries(record).forEach(([token, tokenValue]) => {
		if (!knownCssTokens.has(token)) {
			throw new Error(
				`Invalid ${label}.css configuration: "${token}" is not a known --ts-* token.`,
			);
		}

		if (typeof tokenValue !== "string" || tokenValue.trim().length === 0) {
			throw new Error(
				`Invalid ${label}.css configuration: "${token}" must be a non-empty string.`,
			);
		}
	});

	return record as TrackSwitchCssOverrides;
}

export function normalizePositiveInteger(
	value: number | undefined,
	label: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		throw new Error(
			`Invalid ${label} configuration: must be a finite number of at least 1.`,
		);
	}

	return Math.round(value);
}

export function normalizePositiveFiniteNumber(
	value: number | undefined,
	label: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(
			`Invalid ${label} configuration: must be a positive finite number.`,
		);
	}

	return value;
}

export function normalizeOptionalBoolean(
	value: boolean | undefined,
	label: string,
): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new Error(`Invalid ${label} configuration: must be true or false.`);
	}

	return value;
}

/** Rejects anything outside the given set, naming the offending value. */
export function normalizeEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	label: string,
	fallback: T,
): T {
	if (value === undefined) {
		return fallback;
	}

	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(
			`Invalid ${label} configuration: must be one of ${allowed
				.map((option) => `'${option}'`)
				.join(", ")}.`,
		);
	}

	return value as T;
}

export function normalizeNumberInRange(
	value: number | undefined,
	minimum: number,
	maximum: number,
	label: string,
	fallback: number,
): number {
	if (value === undefined) {
		return fallback;
	}

	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < minimum ||
		value > maximum
	) {
		throw new Error(
			`Invalid ${label} configuration: must be a number between ${minimum} and ${maximum}.`,
		);
	}

	return value;
}
