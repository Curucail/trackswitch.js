(() => {
	const main = document.querySelector(".site-main");
	if (!(main instanceof HTMLElement)) {
		return;
	}

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

	const isEligibleBlock = (node) => {
		if (!(node instanceof HTMLElement)) {
			return false;
		}

		if (node.matches("pre")) {
			return true;
		}

		return (
			node.matches("div.highlighter-rouge") &&
			node.querySelector("pre code") instanceof HTMLElement
		);
	};

	const createCopyButton = (wrapper, text) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "ts-doc-code-block__button";
		button.textContent = "Copy";
		button.setAttribute("aria-label", "Copy code snippet");
		button.setAttribute("title", "Copy code snippet");

		let resetTimer = null;
		const resetLabel = () => {
			button.textContent = "Copy";
			button.classList.remove("is-copied");
			resetTimer = null;
		};

		button.addEventListener("click", () => {
			copyTextToClipboard(text)
				.then(() => {
					button.textContent = "Copied";
					button.classList.add("is-copied");
					if (resetTimer !== null) {
						window.clearTimeout(resetTimer);
					}
					resetTimer = window.setTimeout(resetLabel, 1600);
				})
				.catch(() => {
					button.textContent = "Copy failed";
					button.classList.remove("is-copied");
					if (resetTimer !== null) {
						window.clearTimeout(resetTimer);
					}
					resetTimer = window.setTimeout(resetLabel, 1800);
				});
		});

		wrapper.appendChild(button);
	};

	const initializeCodeCopyButtons = () => {
		Array.from(main.querySelectorAll("pre, div.highlighter-rouge")).forEach(
			(block) => {
				if (!isEligibleBlock(block) || block.closest(".ts-doc-code-block")) {
					return;
				}

				const codeNode = block.matches("pre")
					? block.querySelector("code")
					: block.querySelector("pre code");

				const text =
					codeNode instanceof HTMLElement
						? codeNode.textContent
						: block.textContent;
				if (!text || !text.trim()) {
					return;
				}

				const wrapper = document.createElement("div");
				wrapper.className = "ts-doc-code-block";

				block.parentNode.insertBefore(wrapper, block);
				wrapper.appendChild(block);
				createCopyButton(wrapper, text.replace(/\n$/, ""));
			},
		);
	};

	const initializeTabs = () => {
		Array.from(main.querySelectorAll("[data-doc-tabs]")).forEach((tabsRoot) => {
			if (!(tabsRoot instanceof HTMLElement)) {
				return;
			}

			const tabs = Array.from(
				tabsRoot.querySelectorAll("[data-doc-tab]"),
			).filter((tab) => tab instanceof HTMLButtonElement);
			const panels = Array.from(
				tabsRoot.querySelectorAll("[data-doc-tab-panel]"),
			).filter((panel) => panel instanceof HTMLElement);

			const activateTab = (activeTab) => {
				const activePanelId = activeTab.getAttribute("aria-controls");
				tabs.forEach((tab) => {
					const isActive = tab === activeTab;
					tab.classList.toggle("is-active", isActive);
					tab.setAttribute("aria-selected", isActive ? "true" : "false");
					tab.tabIndex = isActive ? 0 : -1;
				});
				panels.forEach((panel) => {
					const isActive = panel.id === activePanelId;
					panel.classList.toggle("is-active", isActive);
					panel.hidden = !isActive;
				});
			};

			tabs.forEach((tab, index) => {
				tab.tabIndex = tab.classList.contains("is-active") ? 0 : -1;
				tab.addEventListener("click", () => activateTab(tab));
				tab.addEventListener("keydown", (event) => {
					let nextIndex = null;
					if (event.key === "ArrowRight") {
						nextIndex = (index + 1) % tabs.length;
					} else if (event.key === "ArrowLeft") {
						nextIndex = (index - 1 + tabs.length) % tabs.length;
					} else if (event.key === "Home") {
						nextIndex = 0;
					} else if (event.key === "End") {
						nextIndex = tabs.length - 1;
					}

					if (nextIndex === null) {
						return;
					}

					event.preventDefault();
					const nextTab = tabs[nextIndex];
					activateTab(nextTab);
					nextTab.focus();
				});
			});
		});
	};

	initializeCodeCopyButtons();
	initializeTabs();
})();
