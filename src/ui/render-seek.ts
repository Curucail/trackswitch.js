import { setDisplay } from "../shared/dom";
import { clamp, clampPercent, sanitizeDuration } from "../shared/math";

interface LoopState {
	pointA: number | null;
	pointB: number | null;
	enabled: boolean;
}

export interface SeekWrapOptions {
	/**
	 * Inline inset from each edge of the parent, in percent. Image views seek
	 * across a margin-cropped strip; timeline surfaces span their parent exactly.
	 */
	insetPercent?: { left: number; right: number };
	/** Waveform views draw reference hooks onto an extra canvas layer. */
	referenceHookCanvas?: boolean;
}

export function buildSeekWrap(options: SeekWrapOptions = {}): string {
	const inset = options.insetPercent;
	const style = inset
		? ` style="left: ${inset.left}%; right: ${inset.right}%;"`
		: "";

	return (
		`<div class="seekwrap"${style}>` +
		'<div class="loop-region"></div>' +
		'<div class="loop-marker marker-a"></div>' +
		'<div class="loop-marker marker-b"></div>' +
		'<div class="seekhead"></div>' +
		(options.referenceHookCanvas
			? '<canvas class="seekhead-ref-hooks"></canvas>'
			: "") +
		"</div>"
	);
}

function resolveSeekGeometryRoot(seekWrap: HTMLElement): HTMLElement {
	const seekbar = seekWrap.querySelector(":scope > .seekbar");
	return seekbar instanceof HTMLElement ? seekbar : seekWrap;
}

function setPercentProperty(
	element: HTMLElement,
	propertyName: string,
	value: number,
): void {
	element.style.setProperty(propertyName, `${clampPercent(value)}%`);
}

/**
 * Attribute writes are the expensive part of the playback tick, so skip them
 * whenever the value is already what the DOM holds.
 */
function setAttributeIfChanged(
	element: Element,
	name: string,
	value: string,
): void {
	if (element.getAttribute(name) !== value) {
		element.setAttribute(name, value);
	}
}

function setMainSeekbarPlayheadPosition(
	seekbar: HTMLElement,
	seekhead: HTMLElement,
	seekRatio: number,
): void {
	const seekheadWidth = seekhead.offsetWidth;
	const seekbarWidth = seekbar.clientWidth;
	const scaledSeekheadLeft = seekRatio * (seekbarWidth - seekheadWidth);

	seekbar.style.setProperty(
		"--ts-playhead-position",
		`${scaledSeekheadLeft}px`,
	);
}

export function updateSeekWrapVisuals(
	seekWrap: HTMLElement,
	position: number,
	duration: number,
	loop: LoopState,
	loopingEnabled: boolean,
	formatValue: (value: number) => string = String,
): void {
	const safeDuration = sanitizeDuration(duration);
	const safePosition = safeDuration > 0 ? clamp(position, 0, safeDuration) : 0;
	const geometryRoot = resolveSeekGeometryRoot(seekWrap);
	const seekhead = geometryRoot.querySelector(".seekhead");

	if (seekhead instanceof HTMLElement) {
		const seekRatio = safeDuration > 0 ? safePosition / safeDuration : 0;
		if (geometryRoot.classList.contains("seekbar")) {
			setMainSeekbarPlayheadPosition(geometryRoot, seekhead, seekRatio);
		} else {
			setPercentProperty(
				geometryRoot,
				"--ts-playhead-position",
				clampPercent(seekRatio * 100),
			);
		}
		const formattedPosition = formatValue(safePosition);
		setAttributeIfChanged(
			seekhead,
			"aria-label",
			`Playhead ${formattedPosition}`,
		);
		if (seekhead.title !== formattedPosition) {
			seekhead.title = formattedPosition;
		}
	}
	setAttributeIfChanged(geometryRoot, "role", "slider");
	setAttributeIfChanged(geometryRoot, "aria-valuemin", "0");
	setAttributeIfChanged(geometryRoot, "aria-valuemax", String(safeDuration));
	setAttributeIfChanged(geometryRoot, "aria-valuenow", String(safePosition));
	setAttributeIfChanged(
		geometryRoot,
		"aria-valuetext",
		formatValue(safePosition),
	);

	if (!loopingEnabled) {
		return;
	}

	const markerA = seekWrap.querySelector(".loop-marker.marker-a");
	if (markerA && loop.pointA !== null && safeDuration > 0) {
		const pointAPerc = clampPercent(
			(clamp(loop.pointA, 0, safeDuration) / safeDuration) * 100,
		);
		setPercentProperty(geometryRoot, "--ts-loop-marker-a", pointAPerc);
		setDisplay(markerA, "block");
		markerA.setAttribute("aria-label", `Loop A ${formatValue(loop.pointA)}`);
		(markerA as HTMLElement).title = formatValue(loop.pointA);
	} else if (markerA) {
		setDisplay(markerA, "none");
	}

	const markerB = seekWrap.querySelector(".loop-marker.marker-b");
	if (markerB && loop.pointB !== null && safeDuration > 0) {
		const pointBPerc = clampPercent(
			(clamp(loop.pointB, 0, safeDuration) / safeDuration) * 100,
		);
		setPercentProperty(geometryRoot, "--ts-loop-marker-b", pointBPerc);
		setDisplay(markerB, "block");
		markerB.setAttribute("aria-label", `Loop B ${formatValue(loop.pointB)}`);
		(markerB as HTMLElement).title = formatValue(loop.pointB);
	} else if (markerB) {
		setDisplay(markerB, "none");
	}

	const loopRegion = seekWrap.querySelector(".loop-region");
	if (
		loopRegion &&
		loop.pointA !== null &&
		loop.pointB !== null &&
		safeDuration > 0
	) {
		const orderedPointA = Math.min(loop.pointA, loop.pointB);
		const orderedPointB = Math.max(loop.pointA, loop.pointB);
		const pointAPerc = clampPercent(
			(clamp(orderedPointA, 0, safeDuration) / safeDuration) * 100,
		);
		const pointBPerc = clampPercent(
			(clamp(orderedPointB, 0, safeDuration) / safeDuration) * 100,
		);

		setPercentProperty(geometryRoot, "--ts-loop-region-start", pointAPerc);
		setPercentProperty(
			geometryRoot,
			"--ts-loop-region-width",
			Math.max(0, pointBPerc - pointAPerc),
		);
		setDisplay(loopRegion, "block");
		loopRegion.classList.toggle("active", loop.enabled);
	} else if (loopRegion) {
		setDisplay(loopRegion, "none");
		loopRegion.classList.remove("active");
	}
}
