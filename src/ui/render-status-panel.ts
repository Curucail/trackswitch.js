import { renderIconSlotHtml } from "./icons";

export interface TrackSwitchErrorPanelOptions {
	title?: string;
	message: string;
	details?: string;
}

const STATUS_PANEL_CLASS = "ts-status-panel";

function removeStatusPanel(mountRoot: HTMLElement): void {
	mountRoot
		.querySelectorAll(`:scope > .${STATUS_PANEL_CLASS}`)
		.forEach((panel) => {
			panel.remove();
		});
}

function createStatusPanel(variant: "loading" | "error"): HTMLDivElement {
	const panel = document.createElement("div");
	panel.className = `trackswitch ${STATUS_PANEL_CLASS} ${STATUS_PANEL_CLASS}-${variant}`;
	return panel;
}

/**
 * Placeholder shown while the declarative config is still being resolved so the
 * element always occupies space instead of staying invisible.
 */
export function renderTrackSwitchLoadingPanel(mountRoot: HTMLElement): void {
	removeStatusPanel(mountRoot);

	const panel = createStatusPanel("loading");
	panel.innerHTML =
		'<div class="ts-status-panel-body">' +
		renderIconSlotHtml("spinner", "ts-status-panel-icon") +
		'<p class="ts-status-panel-message">Loading player…</p>' +
		"</div>";
	mountRoot.append(panel);
}

export function renderTrackSwitchErrorPanel(
	mountRoot: HTMLElement,
	options: TrackSwitchErrorPanelOptions,
): void {
	mountRoot.replaceChildren();

	const panel = createStatusPanel("error");
	panel.setAttribute("role", "alert");

	const body = document.createElement("div");
	body.className = "ts-status-panel-body";
	body.innerHTML = renderIconSlotHtml(
		"triangle-exclamation",
		"ts-status-panel-icon",
	);

	const text = document.createElement("div");
	text.className = "ts-status-panel-text";

	const title = document.createElement("p");
	title.className = "ts-status-panel-title";
	title.textContent = options.title ?? "Trackswitch could not start";
	text.append(title);

	const message = document.createElement("p");
	message.className = "ts-status-panel-message";
	message.textContent = options.message;
	text.append(message);

	if (options.details) {
		const details = document.createElement("pre");
		details.className = "ts-status-panel-details";
		details.textContent = options.details;
		text.append(details);
	}

	body.append(text);
	panel.append(body);
	mountRoot.append(panel);
}

export function describeError(error: unknown, fallbackMessage: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	if (typeof error === "string" && error) {
		return error;
	}

	return fallbackMessage;
}
