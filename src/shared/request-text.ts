export function requestText(
	url: string,
	sourceLabel: string,
	signal?: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		let settled = false;

		const finish = (callback: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			signal?.removeEventListener("abort", handleAbort);
			callback();
		};
		const handleAbort = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			signal?.removeEventListener("abort", handleAbort);
			request.abort();
			reject(new DOMException("Request aborted.", "AbortError"));
		};

		if (signal?.aborted) {
			handleAbort();
			return;
		}
		signal?.addEventListener("abort", handleAbort, { once: true });
		request.open("GET", url, true);

		request.onreadystatechange = () => {
			if (request.readyState !== 4) {
				return;
			}

			if (request.status >= 200 && request.status < 300) {
				finish(() =>
					resolve(String(request.responseText ?? request.response ?? "")),
				);
			} else {
				finish(() =>
					reject(new Error(`Failed to request ${sourceLabel}: ${url}`)),
				);
			}
		};

		request.onerror = () => {
			finish(() =>
				reject(
					new Error(`Network error while requesting ${sourceLabel}: ${url}`),
				),
			);
		};

		request.send();
	});
}
