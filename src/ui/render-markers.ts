import type { MarkerLayerConfig, ResolvedMarkerSet } from "../domain/types";
import type {
	MarkerNavigationDialogValues,
	MarkerNavigationMarkerOption,
	MarkerNavigationSelection,
	MarkerNavigationSetOption,
} from "../player/marker-actions";
import { getDeepActiveElement } from "../shared/dom";
import type { Marker, MarkerSet } from "../timeline/marker";
import type { ProjectionService } from "../timeline/projection";
import type { TimelineId } from "../timeline/timeline";
import type { MidiSeekSurfaceMetadata } from "./render-midi";

export type {
	MarkerNavigationDialogValues,
	MarkerNavigationMarkerOption,
	MarkerNavigationSelection,
	MarkerNavigationSetOption,
} from "../player/marker-actions";

export interface MarkerPlacement {
	referenceTime: number;
	surfaceTime: number;
	duration: number;
}

export type SeekTimelineContextResolver = (seekWrap: HTMLElement) => {
	duration: number;
	fromReferenceTime(referenceTime: number): number;
};

export interface MarkerRenderData {
	markerSets: ReadonlyMap<string, ResolvedMarkerSet>;
	alignmentMarkerSet: MarkerSet | null;
	referenceTimeline: TimelineId;
	projection: ProjectionService | null;
	getSeekTimelineContext: SeekTimelineContextResolver;
	formatReferenceValue(value: number): string;
}

interface MarkerRendererContext {
	root: HTMLElement;
	waveformSeekSurfaces: Array<{ seekWrap: HTMLElement }>;
	midiSeekSurfaces: MidiSeekSurfaceMetadata[];
	getSeekMarkerLayers(seekWrap: HTMLElement): MarkerLayerConfig[];
}

function resolveMarkerReferenceTime(
	marker: Marker,
	data: MarkerRenderData,
): number | null {
	if (!data.projection) {
		// No alignment block: exactly one timeline exists, so whatever single
		// value the marker carries — regardless of the timeline id it's keyed
		// under — already is the reference-equivalent position.
		const values = Array.from(marker.placements.values());
		return values.length > 0 ? values[0] : null;
	}

	return data.projection.projectMarker(marker, data.referenceTimeline);
}

function resolvePlacement(
	referenceTime: number | null,
	timeline: {
		duration: number;
		fromReferenceTime(referenceTime: number): number;
	},
): MarkerPlacement | null {
	if (
		referenceTime === null ||
		!Number.isFinite(referenceTime) ||
		timeline.duration <= 0
	) {
		return null;
	}

	const surfaceTime = timeline.fromReferenceTime(referenceTime);
	if (surfaceTime < 0 || surfaceTime > timeline.duration) {
		return null;
	}

	return { referenceTime, surfaceTime, duration: timeline.duration };
}

function createMarkerAriaLabel(marker: Marker, referenceTime: string): string {
	const label = marker.label ? `, ${marker.label}` : "";
	return `Marker ${marker.id}${label}, ${referenceTime}`;
}

function renderMarkerLayer(
	seekWrap: HTMLElement,
	layer: MarkerLayerConfig,
	markers: Marker[],
	data: MarkerRenderData,
): void {
	const timeline = data.getSeekTimelineContext(seekWrap);

	const entries: Array<{ marker: Marker; placement: MarkerPlacement }> = [];
	markers
		.filter((marker) => !marker.hidden)
		.forEach((marker) => {
			const referenceTime = resolveMarkerReferenceTime(marker, data);
			const placement = resolvePlacement(referenceTime, timeline);
			if (placement) {
				entries.push({ marker, placement });
			}
		});

	if (entries.length === 0) {
		return;
	}

	entries.sort(
		(left, right) => left.placement.surfaceTime - right.placement.surfaceTime,
	);

	const layerElement = seekWrap.ownerDocument.createElement("div");
	layerElement.className = "timeline-marker-layer";
	layerElement.setAttribute("role", "group");
	layerElement.setAttribute("aria-label", "Timeline markers");
	layerElement.setAttribute("data-marker-set", layer.set);

	entries.forEach((entry, index) => {
		const button = seekWrap.ownerDocument.createElement("button");
		button.type = "button";
		button.className = `timeline-marker timeline-marker-${layer.line ?? "dashed"}`;
		button.tabIndex = index === 0 ? 0 : -1;
		const ariaLabel = createMarkerAriaLabel(
			entry.marker,
			data.formatReferenceValue(entry.placement.referenceTime),
		);
		button.setAttribute("aria-label", ariaLabel);
		button.title = ariaLabel;
		button.setAttribute("data-marker-id", entry.marker.id);
		button.setAttribute(
			"data-marker-reference-time",
			String(entry.placement.referenceTime),
		);
		button.setAttribute(
			"data-marker-surface-time",
			String(entry.placement.surfaceTime),
		);
		button.style.setProperty(
			"--ts-marker-position",
			`${(entry.placement.surfaceTime / entry.placement.duration) * 100}%`,
		);
		button.style.setProperty(
			"--ts-marker-line-width",
			`${layer.lineWidth ?? 1}px`,
		);
		if (entry.placement.surfaceTime / entry.placement.duration >= 0.75) {
			button.classList.add("timeline-marker-label-before");
		}
		if (layer.color) {
			button.style.setProperty("--ts-marker-highlight-color", layer.color);
		}

		if (entry.marker.label) {
			const labelNode = seekWrap.ownerDocument.createElement("span");
			labelNode.className = "timeline-marker-label";
			labelNode.textContent = entry.marker.label;
			button.appendChild(labelNode);
		}

		layerElement.appendChild(button);
	});

	seekWrap.appendChild(layerElement);
}

function renderConfiguredLayers(
	ctx: MarkerRendererContext,
	seekWrap: HTMLElement,
	data: MarkerRenderData,
): void {
	seekWrap
		.querySelectorAll(":scope > .timeline-marker-layer")
		.forEach((existing) => {
			existing.remove();
		});

	const layers = ctx.getSeekMarkerLayers(seekWrap);
	layers.forEach((layer) => {
		if (layer.set === "alignment") {
			// Alignment sets never generate DOM — drawn on canvas via foldToReference.
			return;
		}

		const resolvedSet = data.markerSets.get(layer.set);
		if (!resolvedSet) {
			return;
		}

		renderMarkerLayer(seekWrap, layer, resolvedSet.markerSet.markers, data);
	});
}

export function renderTimelineMarkers(
	ctx: MarkerRendererContext,
	data: MarkerRenderData,
): void {
	ctx.waveformSeekSurfaces.forEach((surface) => {
		renderConfiguredLayers(ctx, surface.seekWrap, data);
	});

	ctx.midiSeekSurfaces.forEach((surface) => {
		renderConfiguredLayers(ctx, surface.seekWrap, data);
	});

	ctx.root
		.querySelectorAll(".seekable-img-wrap > .seekwrap")
		.forEach((candidate) => {
			if (candidate instanceof HTMLElement) {
				renderConfiguredLayers(ctx, candidate, data);
			}
		});
}

export function updateMarkerNavigationControls(
	root: HTMLElement,
	canGoPrevious: boolean,
	canGoNext: boolean,
	canOpenDialog: boolean,
): void {
	const updateButton = (selector: string, enabled: boolean): void => {
		const button = root.querySelector(selector);
		if (!(button instanceof HTMLButtonElement)) {
			return;
		}
		button.disabled = !enabled;
		button.setAttribute("aria-disabled", String(!enabled));
	};

	updateButton(".marker-previous", canGoPrevious);
	updateButton(".marker-jump", canOpenDialog);
	updateButton(".marker-next", canGoNext);
}

function getDialogInput(
	root: HTMLElement,
	selector: string,
): HTMLInputElement | null {
	const input = root.querySelector(selector);
	return input instanceof HTMLInputElement ? input : null;
}

const MARKER_NAVIGATION_INITIAL_RESULT_LIMIT = 10;
const MARKER_NAVIGATION_RESULT_INCREMENT = 10;
const markerNavigationSetsByRoot = new WeakMap<
	HTMLElement,
	MarkerNavigationSetOption[]
>();
const markerComboboxPositionCleanupByInput = new WeakMap<
	HTMLInputElement,
	() => void
>();

interface MarkerNavigationCandidate extends MarkerNavigationMarkerOption {
	setId: string;
	setOrder: number;
}

function getMarkerCandidates(root: HTMLElement): MarkerNavigationCandidate[] {
	const candidates: MarkerNavigationCandidate[] = [];
	(markerNavigationSetsByRoot.get(root) ?? []).forEach((set, setOrder) => {
		set.markers.forEach((marker) => {
			candidates.push({ ...marker, setId: set.id, setOrder });
		});
	});
	return candidates;
}

function markerInputDisplayValue(marker: MarkerNavigationCandidate): string {
	const identity = `${marker.setId} · ID ${marker.id}`;
	return marker.label ? `${marker.label} · ${identity}` : identity;
}

function markerMatchRank(
	marker: MarkerNavigationCandidate,
	query: string,
): number | null {
	if (!query) {
		return 7;
	}
	const id = marker.id.toLowerCase();
	const label = marker.label?.toLowerCase() ?? "";
	const setId = marker.setId.toLowerCase();
	const numericLabelTokens: string[] = label.match(/\d+/g) ?? [];
	if (/^\d+$/.test(query) && numericLabelTokens.includes(query)) {
		return 0;
	}
	if (id === query) {
		return 1;
	}
	if (label === query) {
		return 2;
	}
	if (setId === query) {
		return 3;
	}
	if (id.startsWith(query)) {
		return 4;
	}
	if (label.startsWith(query)) {
		return 5;
	}
	if (setId.startsWith(query)) {
		return 6;
	}
	if (id.includes(query) || label.includes(query) || setId.includes(query)) {
		return 7;
	}
	return null;
}

function getMatchingMarkers(
	root: HTMLElement,
	input: HTMLInputElement,
): MarkerNavigationCandidate[] {
	const query =
		input.dataset.selectedMarkerId && input.dataset.selectedMarkerSetId
			? ""
			: input.value.trim().toLowerCase();
	const matches = getMarkerCandidates(root)
		.map((marker) => ({
			marker: marker,
			rank: markerMatchRank(marker, query),
		}))
		.filter(
			(entry): entry is { marker: MarkerNavigationCandidate; rank: number } =>
				entry.rank !== null,
		);
	const bestRankBySet = new Map<string, number>();
	matches.forEach(({ marker, rank }) => {
		bestRankBySet.set(
			marker.setId,
			Math.min(bestRankBySet.get(marker.setId) ?? rank, rank),
		);
	});
	return matches
		.sort(
			(left, right) =>
				(bestRankBySet.get(left.marker.setId) ?? left.rank) -
					(bestRankBySet.get(right.marker.setId) ?? right.rank) ||
				left.marker.setOrder - right.marker.setOrder ||
				left.rank - right.rank ||
				left.marker.referenceTime - right.marker.referenceTime ||
				left.marker.id.localeCompare(right.marker.id, undefined, {
					numeric: true,
				}),
		)
		.map((entry) => entry.marker);
}

function getComboboxListbox(input: HTMLInputElement): HTMLElement | null {
	const listbox = input
		.closest(".marker-navigation-combobox")
		?.querySelector(".marker-navigation-options");
	return listbox instanceof HTMLElement ? listbox : null;
}

function closeMarkerCombobox(input: HTMLInputElement): void {
	const listbox = getComboboxListbox(input);
	markerComboboxPositionCleanupByInput.get(input)?.();
	if (listbox?.matches(":popover-open")) {
		listbox.hidePopover();
	}
	input.setAttribute("aria-expanded", "false");
	input.removeAttribute("aria-activedescendant");
	delete input.dataset.activeIndex;
}

function positionMarkerCombobox(
	input: HTMLInputElement,
	listbox: HTMLElement,
): void {
	const inputRect = input.getBoundingClientRect();
	const ownerWindow = input.ownerDocument.defaultView;
	if (!ownerWindow) {
		return;
	}
	const viewportPadding = 8;
	const left = Math.max(
		viewportPadding,
		Math.min(
			inputRect.left,
			ownerWindow.innerWidth - inputRect.width - viewportPadding,
		),
	);
	listbox.style.width = `${inputRect.width}px`;
	listbox.style.left = `${left}px`;
	listbox.style.top = `${inputRect.bottom + 4}px`;
	if (!listbox.matches(":popover-open")) {
		listbox.showPopover();
	}
	const listboxRect = listbox.getBoundingClientRect();
	const spaceBelow = ownerWindow.innerHeight - inputRect.bottom;
	const spaceAbove = inputRect.top;
	if (
		listboxRect.bottom > ownerWindow.innerHeight - viewportPadding &&
		spaceAbove > spaceBelow
	) {
		listbox.style.top = `${Math.max(
			viewportPadding,
			inputRect.top - listboxRect.height - 4,
		)}px`;
	}
}

function trackMarkerComboboxPosition(
	input: HTMLInputElement,
	listbox: HTMLElement,
): void {
	if (markerComboboxPositionCleanupByInput.has(input)) {
		return;
	}
	const ownerWindow = input.ownerDocument.defaultView;
	if (!ownerWindow) {
		return;
	}
	let animationFrame: number | null = null;
	const updatePosition = (): void => {
		animationFrame = null;
		if (listbox.matches(":popover-open")) {
			positionMarkerCombobox(input, listbox);
		}
	};
	const schedulePositionUpdate = (): void => {
		if (animationFrame === null) {
			animationFrame = ownerWindow.requestAnimationFrame(updatePosition);
		}
	};
	const cleanup = (): void => {
		ownerWindow.removeEventListener("scroll", schedulePositionUpdate, true);
		ownerWindow.removeEventListener("resize", schedulePositionUpdate);
		if (animationFrame !== null) {
			ownerWindow.cancelAnimationFrame(animationFrame);
		}
		markerComboboxPositionCleanupByInput.delete(input);
	};
	markerComboboxPositionCleanupByInput.set(input, cleanup);
	ownerWindow.addEventListener("scroll", schedulePositionUpdate, {
		capture: true,
		passive: true,
	});
	ownerWindow.addEventListener("resize", schedulePositionUpdate);
}

function closeOtherMarkerComboboxes(
	root: HTMLElement,
	currentInput?: HTMLInputElement,
): void {
	root
		.querySelectorAll<HTMLInputElement>(".marker-navigation-input")
		.forEach((input) => {
			if (input !== currentInput) {
				closeMarkerCombobox(input);
			}
		});
}

function getMarkerComboboxOptions(listbox: HTMLElement): HTMLElement[] {
	return Array.from(
		listbox.querySelectorAll<HTMLElement>(
			".marker-navigation-option, .marker-navigation-options-more",
		),
	);
}

function setActiveMarkerOption(input: HTMLInputElement, index: number): void {
	const listbox = getComboboxListbox(input);
	if (!listbox) {
		return;
	}
	const options = getMarkerComboboxOptions(listbox);
	if (options.length === 0) {
		input.removeAttribute("aria-activedescendant");
		delete input.dataset.activeIndex;
		return;
	}
	const nextIndex = Math.max(0, Math.min(options.length - 1, index));
	input.dataset.activeIndex = String(nextIndex);
	options.forEach((option, optionIndex) => {
		const isActive = optionIndex === nextIndex;
		option.classList.toggle("is-active", isActive);
		option.setAttribute("aria-selected", String(isActive));
	});
	const activeOption = options[nextIndex];
	if (activeOption) {
		input.setAttribute("aria-activedescendant", activeOption.id);
		activeOption.scrollIntoView({ block: "nearest" });
	}
}

function renderMarkerComboboxOptions(
	root: HTMLElement,
	input: HTMLInputElement,
	preferredActiveIndex?: number,
): void {
	const listbox = getComboboxListbox(input);
	if (!listbox) {
		return;
	}
	closeOtherMarkerComboboxes(root, input);
	const matchingMarkers = getMatchingMarkers(root, input);
	const resultLimit = Number(
		input.dataset.resultLimit ?? MARKER_NAVIGATION_INITIAL_RESULT_LIMIT,
	);
	const markers = matchingMarkers.slice(0, resultLimit);
	listbox.replaceChildren();
	if (markers.length === 0) {
		const empty = listbox.ownerDocument.createElement("div");
		empty.className = "marker-navigation-options-empty";
		empty.setAttribute("role", "status");
		empty.textContent = "No matching markers";
		listbox.appendChild(empty);
	} else {
		markers.forEach((marker, index) => {
			const option = listbox.ownerDocument.createElement("div");
			option.id = `${listbox.id}-option-${index}`;
			option.className = "marker-navigation-option";
			option.setAttribute("role", "option");
			option.setAttribute("aria-selected", "false");
			option.dataset.markerId = marker.id;
			option.dataset.markerSetId = marker.setId;
			const heading = listbox.ownerDocument.createElement("div");
			heading.className = "marker-navigation-option-heading";
			const label = listbox.ownerDocument.createElement("span");
			label.className = "marker-navigation-option-label";
			label.textContent = marker.label ?? `Marker ${marker.id}`;
			const set = listbox.ownerDocument.createElement("span");
			set.className = "marker-navigation-option-set";
			set.textContent = marker.setId;
			heading.append(label, set);
			const metadata = listbox.ownerDocument.createElement("div");
			metadata.className = "marker-navigation-option-metadata";
			const id = listbox.ownerDocument.createElement("span");
			id.textContent = `ID ${marker.id}`;
			const time = listbox.ownerDocument.createElement("span");
			time.textContent = marker.formattedTime;
			metadata.append(id, time);
			option.append(heading, metadata);
			listbox.appendChild(option);
		});
		if (markers.length < matchingMarkers.length) {
			const remainingCount = matchingMarkers.length - markers.length;
			const nextCount = Math.min(
				MARKER_NAVIGATION_RESULT_INCREMENT,
				remainingCount,
			);
			const more = listbox.ownerDocument.createElement("div");
			more.id = `${listbox.id}-option-${markers.length}`;
			more.className = "marker-navigation-options-more";
			more.setAttribute("role", "option");
			more.setAttribute("aria-selected", "false");
			more.setAttribute("aria-label", `Show ${nextCount} more markers`);
			more.dataset.loadMore = "true";
			more.textContent = "…";
			listbox.appendChild(more);
		}
	}
	input.setAttribute("aria-expanded", "true");
	const selectedId = input.dataset.selectedMarkerId;
	const selectedSetId = input.dataset.selectedMarkerSetId;
	const selectedIndex = markers.findIndex(
		(marker) => marker.id === selectedId && marker.setId === selectedSetId,
	);
	positionMarkerCombobox(input, listbox);
	trackMarkerComboboxPosition(input, listbox);
	setActiveMarkerOption(
		input,
		preferredActiveIndex ?? (selectedIndex >= 0 ? selectedIndex : 0),
	);
}

function expandMarkerCombobox(
	root: HTMLElement,
	input: HTMLInputElement,
): void {
	const previousLimit = Number(
		input.dataset.resultLimit ?? MARKER_NAVIGATION_INITIAL_RESULT_LIMIT,
	);
	input.dataset.resultLimit = String(
		previousLimit + MARKER_NAVIGATION_RESULT_INCREMENT,
	);
	renderMarkerComboboxOptions(root, input, previousLimit);
}

function selectMarkerOption(
	root: HTMLElement,
	input: HTMLInputElement,
	setId: string,
	markerId: string,
): boolean {
	const marker = getMarkerCandidates(root).find(
		(candidate) => candidate.setId === setId && candidate.id === markerId,
	);
	if (!marker) {
		return false;
	}
	input.dataset.selectedMarkerId = marker.id;
	input.dataset.selectedMarkerSetId = marker.setId;
	input.value = markerInputDisplayValue(marker);
	closeMarkerCombobox(input);
	setMarkerNavigationDialogError(root, "");
	return true;
}

export function handleMarkerNavigationInteraction(
	root: HTMLElement,
	eventType: string,
	target: Element | null,
): void {
	const more = target?.closest(".marker-navigation-options-more");
	if (more) {
		const input = more
			.closest(".marker-navigation-combobox")
			?.querySelector(".marker-navigation-input");
		if (input instanceof HTMLInputElement) {
			expandMarkerCombobox(root, input);
		}
		return;
	}
	const option = target?.closest(".marker-navigation-option");
	if (option) {
		const input = option
			.closest(".marker-navigation-combobox")
			?.querySelector(".marker-navigation-input");
		if (
			input instanceof HTMLInputElement &&
			option instanceof HTMLElement &&
			option.dataset.markerSetId &&
			option.dataset.markerId
		) {
			selectMarkerOption(
				root,
				input,
				option.dataset.markerSetId,
				option.dataset.markerId,
			);
			if (getDeepActiveElement(root) !== input) {
				input.dataset.skipNextFocusOpen = "true";
				input.focus();
			}
		}
		return;
	}
	if (!(target instanceof HTMLInputElement)) {
		return;
	}
	if (eventType === "focusin" && target.dataset.skipNextFocusOpen) {
		delete target.dataset.skipNextFocusOpen;
		return;
	}
	if (
		eventType === "click" &&
		target.getAttribute("aria-expanded") === "true"
	) {
		return;
	}
	if (eventType === "input") {
		delete target.dataset.selectedMarkerId;
		delete target.dataset.selectedMarkerSetId;
		target.dataset.resultLimit = String(MARKER_NAVIGATION_INITIAL_RESULT_LIMIT);
		setMarkerNavigationDialogError(root, "");
	}
	renderMarkerComboboxOptions(root, target);
}

export function handleMarkerNavigationComboboxKeydown(
	root: HTMLElement,
	key: string,
	target: Element | null,
): boolean {
	if (!(target instanceof HTMLInputElement)) {
		return false;
	}
	if (key === "Tab") {
		closeMarkerCombobox(target);
		return false;
	}
	if (key === "Escape") {
		if (target.getAttribute("aria-expanded") !== "true") {
			return false;
		}
		closeMarkerCombobox(target);
		return true;
	}
	if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Enter") {
		return false;
	}
	const wasExpanded = target.getAttribute("aria-expanded") === "true";
	if (
		key === "Enter" &&
		!wasExpanded &&
		target.dataset.selectedMarkerId &&
		target.dataset.selectedMarkerSetId
	) {
		return false;
	}
	if (!wasExpanded) {
		renderMarkerComboboxOptions(root, target);
		if (key === "ArrowDown" || key === "ArrowUp") {
			return true;
		}
	}
	const listbox = getComboboxListbox(target);
	const options = listbox ? getMarkerComboboxOptions(listbox) : [];
	if (key === "Enter") {
		const activeIndex = Number(target.dataset.activeIndex ?? "0");
		const activeOption = options[activeIndex];
		if (activeOption?.dataset.loadMore) {
			expandMarkerCombobox(root, target);
		} else if (
			activeOption?.dataset.markerSetId &&
			activeOption.dataset.markerId
		) {
			selectMarkerOption(
				root,
				target,
				activeOption.dataset.markerSetId,
				activeOption.dataset.markerId,
			);
		} else {
			setMarkerNavigationDialogError(root, "No matching markers.");
		}
		return true;
	}
	const activeIndex = Number(target.dataset.activeIndex ?? "0");
	const offset = key === "ArrowDown" ? 1 : -1;
	const nextIndex =
		options.length === 0
			? 0
			: (activeIndex + offset + options.length) % options.length;
	setActiveMarkerOption(target, nextIndex);
	return true;
}

export function resetMarkerNavigationDialogComboboxes(root: HTMLElement): void {
	root
		.querySelectorAll<HTMLInputElement>(".marker-navigation-input")
		.forEach((input) => {
			input.value = "";
			delete input.dataset.selectedMarkerId;
			delete input.dataset.selectedMarkerSetId;
			input.dataset.resultLimit = String(
				MARKER_NAVIGATION_INITIAL_RESULT_LIMIT,
			);
			closeMarkerCombobox(input);
		});
}

export function validateMarkerNavigationDialogSelections(
	root: HTMLElement,
): boolean {
	const unresolvedInput = Array.from(
		root.querySelectorAll<HTMLInputElement>(".marker-navigation-input"),
	).find(
		(input) =>
			input.value.trim().length > 0 &&
			(!input.dataset.selectedMarkerId || !input.dataset.selectedMarkerSetId),
	);
	if (!unresolvedInput) {
		return true;
	}
	setMarkerNavigationDialogError(root, "Choose a marker from the suggestions.");
	unresolvedInput.focus();
	renderMarkerComboboxOptions(root, unresolvedInput);
	return false;
}

export function updateMarkerNavigationDialogSets(
	root: HTMLElement,
	sets: MarkerNavigationSetOption[],
): void {
	const dialog = root.querySelector(".marker-navigation-dialog");
	if (!(dialog instanceof HTMLElement)) {
		return;
	}
	markerNavigationSetsByRoot.set(root, sets);
	const signature = JSON.stringify(sets);
	if (dialog.dataset.markerSignature === signature) {
		return;
	}
	dialog.dataset.markerSignature = signature;
	resetMarkerNavigationDialogComboboxes(root);
}

export function setMarkerNavigationDialogError(
	root: HTMLElement,
	message: string,
): void {
	const error = root.querySelector(".marker-navigation-error");
	if (!(error instanceof HTMLElement)) {
		return;
	}
	error.textContent = message;
	error.classList.toggle("is-visible", message.length > 0);
}

export function openMarkerNavigationDialog(
	root: HTMLElement,
	sets: MarkerNavigationSetOption[],
): void {
	const overlay = root.querySelector(".marker-navigation-overlay");
	if (!(overlay instanceof HTMLElement)) {
		return;
	}
	setMarkerNavigationDialogError(root, "");
	updateMarkerNavigationDialogSets(root, sets);
	resetMarkerNavigationDialogComboboxes(root);
	overlay.classList.remove("is-hidden");
	overlay.setAttribute("aria-hidden", "false");
	root.ownerDocument.defaultView?.requestAnimationFrame(() => {
		const dialog = root.querySelector(".marker-navigation-dialog");
		if (dialog instanceof HTMLElement) {
			dialog.focus();
		}
	});
}

export function closeMarkerNavigationDialog(root: HTMLElement): void {
	const overlay = root.querySelector(".marker-navigation-overlay");
	if (!(overlay instanceof HTMLElement)) {
		return;
	}
	overlay.classList.add("is-hidden");
	overlay.setAttribute("aria-hidden", "true");
	closeOtherMarkerComboboxes(root);
	setMarkerNavigationDialogError(root, "");
	const trigger = root.querySelector(".marker-jump");
	if (trigger instanceof HTMLButtonElement && !trigger.disabled) {
		trigger.focus();
	}
}

export function readMarkerNavigationDialogValues(
	root: HTMLElement,
): MarkerNavigationDialogValues {
	const selection = (selector: string): MarkerNavigationSelection | null => {
		const input = getDialogInput(root, selector);
		const setId = input?.dataset.selectedMarkerSetId;
		const markerId = input?.dataset.selectedMarkerId;
		return setId && markerId ? { setId, markerId } : null;
	};
	return {
		jumpMarker: selection(".marker-jump-target"),
		loopAMarker: selection(".marker-loop-a"),
		loopBMarker: selection(".marker-loop-b"),
	};
}

export function trapMarkerNavigationDialogFocus(
	root: HTMLElement,
	shiftKey: boolean,
): void {
	const dialog = root.querySelector(".marker-navigation-dialog");
	if (!(dialog instanceof HTMLElement)) {
		return;
	}
	const focusable = Array.from(
		dialog.querySelectorAll<HTMLElement>(
			'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
		),
	).filter((element) => !element.closest(".is-hidden"));
	if (focusable.length === 0) {
		return;
	}
	const active = getDeepActiveElement(root);
	const currentIndex = focusable.indexOf(active as HTMLElement);
	const nextIndex = shiftKey
		? currentIndex <= 0
			? focusable.length - 1
			: currentIndex - 1
		: currentIndex < 0 || currentIndex === focusable.length - 1
			? 0
			: currentIndex + 1;
	focusable[nextIndex]?.focus();
}
