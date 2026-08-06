(() => {
	const loadWhenReady = (player) => {
		let animationFrame = 0;

		const stopWaiting = () => {
			window.cancelAnimationFrame(animationFrame);
		};

		const load = () => {
			if (!player.isConnected) {
				return;
			}

			if (!player.controller) {
				animationFrame = window.requestAnimationFrame(load);
				return;
			}

			player.removeEventListener("trackswitch-error", stopWaiting);
			player.controller.load();
		};

		player.addEventListener("trackswitch-error", stopWaiting, { once: true });
		load();
	};

	const copyTextToClipboard = (value) => {
		if (
			navigator.clipboard &&
			typeof navigator.clipboard.writeText === "function"
		) {
			return navigator.clipboard.writeText(value);
		}

		return new Promise((resolve, reject) => {
			const textarea = document.createElement("textarea");
			textarea.value = value;
			textarea.setAttribute("readonly", "");
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			textarea.style.pointerEvents = "none";
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();

			try {
				if (!document.execCommand("copy")) {
					throw new Error("Copy command was rejected.");
				}
				resolve();
			} catch (error) {
				reject(error);
			} finally {
				textarea.remove();
			}
		});
	};

	const escapeHtml = (value) => {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	};

	const highlightJson = (value) => {
		return escapeHtml(value).replace(
			/("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
			function (match, key, string, booleanValue, nullValue, number) {
				if (key) return '<span class="ts-code-key">' + key + "</span>";
				if (string) return '<span class="ts-code-string">' + string + "</span>";
				if (booleanValue) return '<span class="ts-code-bool">' + booleanValue + "</span>";
				if (nullValue) return '<span class="ts-code-null">' + nullValue + "</span>";
				return '<span class="ts-code-number">' + number + "</span>";
			},
		);
	};

	const highlightedConfig = (config) => {
		return highlightJson(JSON.stringify(config, null, 2));
	};

	const initializeUsecaseShowcase = () => {
		const showcases = document.querySelectorAll(".ts-usecase-showcase");

		showcases.forEach((showcase) => {
			const codeCallout = showcase.querySelector(".ts-usecase-showcase__code-callout");
			const copyButton = showcase.querySelector(".ts-copy-btn");
			const previewPanel = showcase.querySelector(".ts-usecase-showcase__snippet-panel");
			const previewShell = showcase.querySelector(".ts-usecase-showcase__snippet-shell");
			const previewCode = previewShell?.querySelector("code");
			const player = showcase.querySelector("trackswitch-player, trackswitch-sync-interactive");

			if (!player || !copyButton || !previewCode) return;

			const configSrc = player.getAttribute("config-src");
			if (!configSrc) return;

			// Construct the path to the config file based on the current page location
			// Remove trailing slash and add the config filename
			const currentPath = window.location.pathname.replace(/\/$/, "");
			const configPath = currentPath + "/" + configSrc;

			let previewHideTimer = null;

			const setPreviewVisible = (visible) => {
				showcase.classList.toggle("is-snippet-preview-visible", visible);
			};

			const cancelPreviewHide = () => {
				clearTimeout(previewHideTimer);
				previewHideTimer = null;
			};

			const schedulePreviewHide = () => {
				cancelPreviewHide();
				previewHideTimer = setTimeout(() => {
					setPreviewVisible(false);
				}, 120);
			};

			const bindPreviewHover = (target) => {
				if (!target) return;
				target.addEventListener("mouseenter", () => {
					cancelPreviewHide();
					setPreviewVisible(true);
				});
				target.addEventListener("mouseleave", () => {
					schedulePreviewHide();
				});
				target.addEventListener("focusin", () => {
					cancelPreviewHide();
					setPreviewVisible(true);
				});
				target.addEventListener("focusout", (event) => {
					if (!target.contains(event.relatedTarget)) {
						schedulePreviewHide();
					}
				});
			};

			if (codeCallout) {
				bindPreviewHover(codeCallout);
			}
			if (previewPanel) {
				bindPreviewHover(previewPanel);
			}

			// Fetch and display config
			fetch(configPath)
				.then((response) => {
					if (!response.ok) throw new Error(`Failed to load ${configPath}`);
					return response.json();
				})
				.then((config) => {
					if (previewCode) {
						const highlighted = highlightedConfig(config);
						previewCode.innerHTML = highlighted;
						previewCode.className = "language-json";
					}
				})
				.catch((error) => {
					console.error(`Could not load config from ${configPath}:`, error);
					if (previewCode) {
						previewCode.innerHTML = "Error loading config";
					}
				});

			// Setup copy button
			copyButton.addEventListener("click", () => {
				// Get the plain text version of the JSON (without HTML tags)
				const plainText = previewCode?.textContent || "";
				copyTextToClipboard(plainText)
					.then(() => {
						const originalText = copyButton.textContent;
						copyButton.textContent = "Copied";
						setTimeout(() => {
							copyButton.textContent = originalText;
						}, 1200);
					})
					.catch(() => {
						const originalText = copyButton.textContent;
						copyButton.textContent = "Copy failed";
						setTimeout(() => {
							copyButton.textContent = originalText;
						}, 1200);
					});
			});
		});
	};

	customElements.whenDefined("trackswitch-player").then(() => {
		document.querySelectorAll("trackswitch-player").forEach(loadWhenReady);
		initializeUsecaseShowcase();
	});

	// Also handle trackswitch-sync-interactive
	customElements.whenDefined("trackswitch-sync-interactive").then(() => {
		initializeUsecaseShowcase();
	});
})();
