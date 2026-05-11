export type ElementConfigParser<TConfig> = (rawConfig: unknown) => TConfig;

const INLINE_CONFIG_SCRIPT_TYPE = "application/json";

export function getInlineConfigScripts(
	element: HTMLElement,
): HTMLScriptElement[] {
	return Array.from(element.children).filter(
		function (child): child is HTMLScriptElement {
			return (
				child instanceof HTMLScriptElement &&
				child.type.trim().toLowerCase() === INLINE_CONFIG_SCRIPT_TYPE
			);
		},
	);
}

export async function loadElementConfig<TConfig>(
	element: HTMLElement,
	parseConfig: ElementConfigParser<TConfig>,
): Promise<TConfig | undefined> {
	const configSrc = element.getAttribute("config-src");
	const inlineConfigScripts = getInlineConfigScripts(element);

	if (configSrc && inlineConfigScripts.length > 0) {
		throw new Error(
			"TrackSwitch config error: use either config-src or inline JSON, not both.",
		);
	}

	if (inlineConfigScripts.length > 1) {
		throw new Error(
			"TrackSwitch config error: expected exactly one inline JSON config script.",
		);
	}

	if (configSrc) {
		let response: Response;
		try {
			response = await fetch(configSrc);
		} catch (_error) {
			throw new Error(
				'TrackSwitch config error: failed to load config-src "' +
					configSrc +
					'".',
			);
		}

		if (!response.ok) {
			throw new Error(
				'TrackSwitch config error: failed to load config-src "' +
					configSrc +
					'".',
			);
		}

		try {
			return parseConfig(await response.json());
		} catch (_error) {
			throw new Error(
				'TrackSwitch config error: invalid JSON from config-src "' +
					configSrc +
					'".',
			);
		}
	}

	if (inlineConfigScripts.length === 1) {
		try {
			return parseConfig(JSON.parse(inlineConfigScripts[0].textContent || ""));
		} catch (_error) {
			throw new Error("TrackSwitch config error: invalid inline JSON config.");
		}
	}

	return undefined;
}
