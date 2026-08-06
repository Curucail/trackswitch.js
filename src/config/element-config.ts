export type ElementConfigParser<TConfig> = (rawConfig: unknown) => TConfig;

export interface ElementConfigErrorOptions {
	details?: string;
	title?: string;
}

export class ElementConfigError extends Error {
	readonly details: string | undefined;
	readonly title: string | undefined;

	constructor(message: string, options: ElementConfigErrorOptions = {}) {
		super(message);
		this.name = "ElementConfigError";
		this.details = options.details;
		this.title = options.title;
	}
}

function detailsOf(error: unknown): string | undefined {
	if (error instanceof Error && error.message) {
		return `${error.name}: ${error.message}`;
	}

	return undefined;
}

const MALFORMED_JSON_TITLE = "Trackswitch config is not valid JSON";
const MALFORMED_JSON_HINT =
	"Common causes: a trailing comma, a missing comma or quote, single quotes instead of double quotes, comments, or an unclosed bracket.";
const JSON_SNIPPET_CONTEXT = 60;

/**
 * Turns a JSON.parse SyntaxError into a snippet of the offending source with a
 * caret under the reported position, so the panel points at the actual typo.
 */
function describeJsonSyntaxError(source: string, error: unknown): string {
	const parseMessage =
		error instanceof Error ? error.message : "Unknown JSON syntax error.";
	const positionMatch = /position (\d+)/.exec(parseMessage);
	if (!positionMatch) {
		return parseMessage;
	}

	const position = Math.min(Number(positionMatch[1]), source.length);
	const lineStart = source.lastIndexOf("\n", position - 1) + 1;
	const lineEndIndex = source.indexOf("\n", position);
	const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
	const line = source.slice(lineStart, lineEnd);
	const columnIndex = position - lineStart;

	const sliceStart = Math.max(0, columnIndex - JSON_SNIPPET_CONTEXT);
	const sliceEnd = Math.min(line.length, columnIndex + JSON_SNIPPET_CONTEXT);
	const snippet =
		(sliceStart > 0 ? "…" : "") +
		line.slice(sliceStart, sliceEnd) +
		(sliceEnd < line.length ? "…" : "");
	const caretOffset = columnIndex - sliceStart + (sliceStart > 0 ? 1 : 0);

	return `${parseMessage}\n\n${snippet}\n${" ".repeat(caretOffset)}^`;
}

function parseJsonConfig(source: string, sourceLabel: string): unknown {
	if (!source.trim()) {
		throw new ElementConfigError(`Empty JSON in ${sourceLabel}.`, {
			title: MALFORMED_JSON_TITLE,
		});
	}

	try {
		return JSON.parse(source);
	} catch (error) {
		throw new ElementConfigError(`Malformed JSON in ${sourceLabel}.`, {
			title: MALFORMED_JSON_TITLE,
			details: `${describeJsonSyntaxError(source, error)}\n\n${MALFORMED_JSON_HINT}`,
		});
	}
}

const INLINE_CONFIG_SCRIPT_TYPE = "application/json";
const DECLARATIVE_CONFIG_WAIT_TIMEOUT_MS = 500;

function getInlineConfigScripts(element: HTMLElement): HTMLScriptElement[] {
	return Array.from(element.children).filter(
		(child): child is HTMLScriptElement =>
			child instanceof HTMLScriptElement &&
			child.type.trim().toLowerCase() === INLINE_CONFIG_SCRIPT_TYPE,
	);
}

function hasDeclarativeConfigSource(element: HTMLElement): boolean {
	return (
		element.hasAttribute("config-src") ||
		getInlineConfigScripts(element).length > 0
	);
}

function waitForAnimationFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve());
	});
}

async function waitForDeclarativeConfigSource(
	element: HTMLElement,
): Promise<void> {
	if (hasDeclarativeConfigSource(element)) {
		return;
	}

	await waitForAnimationFrame();
	if (hasDeclarativeConfigSource(element)) {
		return;
	}

	await new Promise<void>((resolve) => {
		let timeoutId = 0;
		let observer: MutationObserver | null = null;

		const cleanup = (): void => {
			window.clearTimeout(timeoutId);
			observer?.disconnect();
			resolve();
		};

		observer = new MutationObserver(() => {
			if (!hasDeclarativeConfigSource(element)) {
				return;
			}

			cleanup();
		});
		timeoutId = window.setTimeout(
			() => cleanup(),
			DECLARATIVE_CONFIG_WAIT_TIMEOUT_MS,
		);

		observer.observe(element, {
			childList: true,
			attributes: true,
			attributeFilter: ["config-src"],
		});
	});
}

export async function loadElementConfig<TConfig>(
	element: HTMLElement,
	parseConfig: ElementConfigParser<TConfig>,
): Promise<TConfig | undefined> {
	await waitForDeclarativeConfigSource(element);

	const configSrc = element.getAttribute("config-src");
	const inlineConfigScripts = getInlineConfigScripts(element);

	if (configSrc && inlineConfigScripts.length > 0) {
		throw new ElementConfigError(
			"Use either config-src or inline JSON, not both.",
		);
	}

	if (inlineConfigScripts.length > 1) {
		throw new ElementConfigError(
			"Expected exactly one inline JSON config script, found " +
				inlineConfigScripts.length +
				".",
		);
	}

	if (configSrc) {
		let response: Response;
		try {
			response = await fetch(configSrc);
		} catch (error) {
			throw new ElementConfigError(
				`Failed to load config-src "${configSrc}".`,
				{ details: detailsOf(error) },
			);
		}

		if (!response.ok) {
			throw new ElementConfigError(
				`Failed to load config-src "${configSrc}".`,
				{ details: `HTTP ${response.status} ${response.statusText}` },
			);
		}

		const responseText = await response.text();
		const rawConfig = parseJsonConfig(
			responseText,
			`config-src "${configSrc}"`,
		);

		try {
			return parseConfig(rawConfig);
		} catch (error) {
			throw new ElementConfigError(
				`Invalid config from config-src "${configSrc}".`,
				{ details: detailsOf(error) },
			);
		}
	}

	if (inlineConfigScripts.length === 1) {
		const rawConfig = parseJsonConfig(
			inlineConfigScripts[0].textContent || "",
			"the inline JSON config script",
		);

		try {
			return parseConfig(rawConfig);
		} catch (error) {
			throw new ElementConfigError("Invalid inline config.", {
				details: detailsOf(error),
			});
		}
	}

	throw new ElementConfigError(
		'No config found. Provide a config-src attribute or one inline <script type="application/json"> config.',
	);
}
