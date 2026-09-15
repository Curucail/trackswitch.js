import { normalizeTrackSwitchConfig } from "../config/config";
import { parseCsvRecords } from "../shared/csv";
import type {
	MediaEntryConfig,
	TrackSwitchInit,
	TrackSwitchViewConfig,
} from "../types";
import {
	type ArchiveVariant,
	buildArchiveEntries,
	createArchiveBlob,
	type StandaloneAssets,
} from "./archive";
import { type FormTarget, renderSchemaForm, schemaForFeatures } from "./form";
import {
	addFilesToProject,
	type BuilderProject,
	type BuilderResource,
	buildPlayerConfig,
	buildRuntimePreviewConfig,
	createBuilderProject,
	findMarkerReferences,
	findMediaReferences,
	renameMarkerId,
	renameMediaId,
	slugifyId,
} from "./model";
import {
	assertBuilderSchemaCoverage,
	BUILDER_VIEW_TYPES,
	getDefinition,
	getDiscriminatedSchema,
	type JsonSchema,
} from "./schema";
import { appendViewIfValid, validateBuilderProject } from "./validation";

interface BuilderAssetUrls {
	playerScript: string;
	license: string;
	thirdPartyNotices: string;
}

interface TrackswitchPreviewElement extends HTMLElement {
	config: TrackSwitchInit | undefined;
}

const VIEW_LABELS: Record<(typeof BUILDER_VIEW_TYPES)[number], string> = {
	image: "Image",
	perTrackImage: "Per-track image",
	waveform: "Waveform",
	pianoRoll: "Piano roll",
	sheetMusic: "Sheet music",
	warpingMatrix: "Warping matrix",
	text: "Text",
	separator: "Separator",
	trackList: "Track list",
	navigationBar: "Navigation bar",
};

function button(
	label: string,
	className = "ts-builder-secondary-button",
): HTMLButtonElement {
	const element = document.createElement("button");
	element.type = "button";
	element.className = className;
	element.textContent = label;
	return element;
}

function uniqueId(base: string, existing: readonly string[]): string {
	if (!existing.includes(base)) return base;
	let suffix = 2;
	while (existing.includes(`${base}-${String(suffix)}`)) suffix += 1;
	return `${base}-${String(suffix)}`;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function resourceLabel(resource: BuilderResource): string {
	const megabytes = resource.file.size / (1024 * 1024);
	return `${resource.file.name} · ${megabytes < 0.1 ? "<0.1" : megabytes.toFixed(1)} MB`;
}

function firstMediaId(
	project: BuilderProject,
	type: MediaEntryConfig["type"],
): string {
	return (
		Object.entries(project.media).find(
			([, media]) => media.config.type === type,
		)?.[0] ?? ""
	);
}

function defaultView(
	project: BuilderProject,
	type: TrackSwitchViewConfig["type"],
): TrackSwitchViewConfig {
	const audio = Object.entries(project.media)
		.filter(([, media]) => media.config.type === "audio")
		.map(([id]) => id);
	switch (type) {
		case "image":
			return { type, mediaID: firstMediaId(project, "image") };
		case "perTrackImage":
			return { type };
		case "waveform":
			return { type, tracks: "audible" };
		case "pianoRoll":
			return { type, mediaID: firstMediaId(project, "midi") };
		case "sheetMusic":
			return { type, mediaID: firstMediaId(project, "musicxml") };
		case "warpingMatrix":
			return { type, x: audio[0] ?? "", y: audio[1] ?? "" };
		case "text":
			return { type, text: "Add your text" };
		case "separator":
			return { type };
		case "trackList":
			return { type, tracks: audio };
		case "navigationBar":
			return {
				type,
				controls: ["playback", "globalVolume", "timer", "seekBar"],
			};
	}
}

export class BuilderApp {
	private readonly project = createBuilderProject();
	private readonly rootSchema: JsonSchema;
	private readonly assetUrls: BuilderAssetUrls;
	private readonly root: HTMLElement;
	private readonly fileInput: HTMLInputElement;
	private readonly csvInput: HTMLInputElement;
	private readonly sidebar: HTMLElement;
	private readonly status: HTMLElement;
	private readonly previewHost: HTMLElement;
	private readonly panelRail: HTMLElement;
	private readonly addPanelMenu: HTMLElement;
	private readonly dialog: HTMLDialogElement;
	private readonly dialogTitle: HTMLElement;
	private readonly dialogBody: HTMLElement;
	private activeTarget: FormTarget | null = null;
	private previewTimer: number | undefined;
	private preview: TrackswitchPreviewElement | null = null;
	private runtimeFailed = false;
	private draggedViewId: string | null = null;
	private csvIntakeTarget: "alignment" | "marker" | null = null;
	private pendingViewId: string | null = null;

	constructor(
		root: HTMLElement,
		rootSchema: JsonSchema,
		assetUrls: BuilderAssetUrls,
	) {
		assertBuilderSchemaCoverage(rootSchema);
		this.root = root;
		this.rootSchema = rootSchema;
		this.assetUrls = assetUrls;
		this.root.innerHTML = `
			<div class="ts-builder-mobile-message" role="note">
				<strong>The Builder needs a larger screen.</strong>
				<span>Open this page in a desktop browser wider than 900 pixels.</span>
			</div>
			<div class="ts-builder-app">
				<header class="ts-builder-header">
					<h1>Build your own player</h1>
				</header>
				<div class="ts-builder-workspace">
					<aside class="ts-builder-sidebar" aria-label="Project settings"><p class="ts-builder-status" role="status" aria-live="polite"></p></aside>
					<main class="ts-builder-main">
						<input data-input="media" type="file" multiple accept="audio/*,.mid,.midi,.xml,.musicxml,image/*,.csv" hidden>
						<input data-input="csv" type="file" accept=".csv,text/csv" hidden>
						<div class="ts-builder-preview-stage" aria-label="Player builder canvas">
							<div class="ts-builder-preview-shell">
								<div class="ts-builder-preview"><button type="button" class="ts-builder-drop-prompt" data-action="empty-choose-files"><strong>Drop files here</strong><span>Audio, MIDI (.mid/.midi), MusicXML (.xml/.musicxml), images, and CSV files are supported.</span></button></div>
								<div class="ts-builder-panel-rail" aria-label="Panel order"></div>
								<div class="ts-builder-drop-overlay" aria-hidden="true">Drop files to add them</div>
							</div>
						</div>
						<div class="ts-builder-add-view">
							<button type="button" class="ts-builder-secondary-button" data-action="toggle-panel-menu" aria-expanded="false" aria-haspopup="menu">Add panel</button>
							<div class="ts-builder-panel-menu" role="menu" hidden></div>
						</div>
					</main>
				</div>
			</div>
			<dialog class="ts-builder-dialog" aria-labelledby="ts-builder-dialog-title">
				<div class="ts-builder-dialog__header"><h2 id="ts-builder-dialog-title"></h2><button type="button" class="ts-builder-icon-button" data-action="close" aria-label="Close settings">×</button></div>
				<div class="ts-builder-dialog__body"></div>
			</dialog>`;

		this.fileInput = this.required('[data-input="media"]');
		this.csvInput = this.required('[data-input="csv"]');
		this.sidebar = this.required(".ts-builder-sidebar");
		this.status = this.required(".ts-builder-status");
		this.previewHost = this.required(".ts-builder-preview");
		this.panelRail = this.required(".ts-builder-panel-rail");
		this.addPanelMenu = this.required(".ts-builder-panel-menu");
		this.dialog = this.required(".ts-builder-dialog");
		this.dialogTitle = this.required("#ts-builder-dialog-title");
		this.dialogBody = this.required(".ts-builder-dialog__body");
		this.bindStaticEvents();
		this.renderPanelMenu();
		this.render();
		window.addEventListener("beforeunload", (event) => {
			if (Object.keys(this.project.resources).length === 0) return;
			event.preventDefault();
		});
		window.addEventListener("unload", () => this.revokeAllUrls());
	}

	private required<T extends Element>(selector: string): T {
		const element =
			this.root.querySelector<T>(selector) ??
			document.querySelector<T>(selector);
		if (!element) throw new Error(`Builder element not found: ${selector}`);
		return element;
	}

	private bindStaticEvents(): void {
		const dropzone = this.required<HTMLElement>(".ts-builder-preview-shell");
		this.required<HTMLButtonElement>(
			'[data-action="empty-choose-files"]',
		).addEventListener("click", () => this.fileInput.click());
		for (const eventName of ["dragenter", "dragover"]) {
			dropzone.addEventListener(eventName, (event) => {
				event.preventDefault();
				dropzone.classList.add("is-dragging");
			});
		}
		dropzone.addEventListener("dragleave", (event) => {
			if (
				event.relatedTarget instanceof Node &&
				dropzone.contains(event.relatedTarget)
			)
				return;
			dropzone.classList.remove("is-dragging");
		});
		dropzone.addEventListener("drop", (event) => {
			event.preventDefault();
			dropzone.classList.remove("is-dragging");
			void this.addFiles(event.dataTransfer?.files ?? []);
		});
		this.fileInput.addEventListener("change", () => {
			void this.addFiles(this.fileInput.files ?? []);
			this.fileInput.value = "";
		});
		this.csvInput.addEventListener("change", () => {
			void this.finishCsvIntake();
		});
		this.required<HTMLButtonElement>('[data-action="close"]').addEventListener(
			"click",
			() => this.dialog.close(),
		);
		this.dialog.addEventListener("close", () => {
			this.activeTarget = null;
			this.render();
		});
		const menuButton = this.required<HTMLButtonElement>(
			'[data-action="toggle-panel-menu"]',
		);
		menuButton.addEventListener("click", () => {
			const open = this.addPanelMenu.hidden;
			this.addPanelMenu.hidden = !open;
			menuButton.setAttribute("aria-expanded", String(open));
			if (open)
				this.addPanelMenu.querySelector<HTMLButtonElement>("button")?.focus();
		});
		this.addPanelMenu.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			this.closePanelMenu();
			menuButton.focus();
		});
		document.addEventListener("click", (event) => {
			const addView = this.required<HTMLElement>(".ts-builder-add-view");
			if (event.target instanceof Node && addView.contains(event.target))
				return;
			this.closePanelMenu();
		});
		window.addEventListener("resize", () => this.decoratePreviewPanels());
	}

	private renderPanelMenu(): void {
		for (const type of BUILDER_VIEW_TYPES) {
			const option = button(VIEW_LABELS[type], "ts-builder-panel-menu__item");
			option.setAttribute("role", "menuitem");
			option.addEventListener("click", () => {
				this.closePanelMenu();
				this.addView(type);
			});
			this.addPanelMenu.append(option);
		}
	}

	private closePanelMenu(): void {
		this.addPanelMenu.hidden = true;
		this.required<HTMLButtonElement>(
			'[data-action="toggle-panel-menu"]',
		).setAttribute("aria-expanded", "false");
	}

	private async addFiles(
		files: FileList | readonly File[],
	): Promise<BuilderResource[]> {
		const result = addFilesToProject(this.project, Array.from(files));
		for (const resource of [...result.added]) {
			if (resource.kind !== "csv") continue;
			try {
				const parsed = parseCsvRecords(await resource.file.text(), {
					emptyDataError:
						"CSV must contain a header row and at least one data row.",
				});
				resource.csvHeaders = parsed.headers;
			} catch (error) {
				const message = describeError(error);
				result.errors.push(`${resource.file.name}: ${message}`);
				this.removeResourceNow(resource.id);
				result.added.splice(result.added.indexOf(resource), 1);
			}
		}
		this.render();
		this.setStatus(
			result.errors.length
				? result.errors.join(" ")
				: `${String(result.added.length)} file(s) added.`,
			result.errors.length > 0,
		);
		return result.added;
	}

	private pickCsvFor(target: "alignment" | "marker"): void {
		this.csvIntakeTarget = target;
		this.csvInput.click();
	}

	private async finishCsvIntake(): Promise<void> {
		const target = this.csvIntakeTarget;
		this.csvIntakeTarget = null;
		const files = Array.from(this.csvInput.files ?? []);
		this.csvInput.value = "";
		if (!target || files.length === 0) return;
		const added = await this.addFiles(files);
		const csv = added.find((resource) => resource.kind === "csv");
		if (!csv) return;
		if (target === "alignment") this.addAlignment(csv);
		else this.addMarker(csv);
	}

	private render(): void {
		this.renderSidebar();
		const errors = this.validationErrors();
		this.setExportDisabled(errors.length > 0 || this.runtimeFailed);
		if (errors.length && Object.keys(this.project.resources).length > 0)
			this.setStatus(errors.join(" "), true);
		else if (Object.keys(this.project.resources).length === 0)
			this.setStatus("");
		this.schedulePreview(errors);
		if (this.activeTarget && this.dialog.open)
			this.renderInspector(this.activeTarget);
	}

	private setExportDisabled(disabled: boolean): void {
		for (const selector of [
			'[data-action="copy"]',
			'[data-action="project-zip"]',
			'[data-action="standalone-zip"]',
		]) {
			this.required<HTMLButtonElement>(selector).disabled = disabled;
		}
	}

	private renderSidebar(): void {
		this.sidebar.replaceChildren();
		const mediaSection = this.sidebarSection("Media");
		const mediaEntries = Object.entries(this.project.media);
		const addFiles = button("Add media");
		addFiles.addEventListener("click", () => this.fileInput.click());
		mediaSection.append(addFiles);
		for (const [id, media] of mediaEntries) {
			const resource = this.project.resources[media.resourceId];
			mediaSection.append(
				this.sidebarItem(
					id,
					`${media.config.type} · ${resourceLabel(resource)}`,
					() =>
						this.openInspector({ kind: "media", id, resourceId: resource.id }),
					() => this.removeMedia(id),
				),
			);
		}
		const csvResources = Object.values(this.project.resources).filter(
			(resource) => resource.kind === "csv",
		);
		if (csvResources.length) {
			for (const resource of csvResources) {
				mediaSection.append(
					this.sidebarItem(
						resource.file.name,
						resource.csvError ??
							`${String(resource.csvHeaders?.length ?? 0)} columns`,
						undefined,
						() => this.removeResource(resource.id),
					),
				);
			}
		}
		this.sidebar.append(mediaSection);

		const alignment = this.sidebarSection("Alignment");
		if (this.project.alignment) {
			alignment.append(
				this.sidebarItem(
					"Alignment mapping",
					this.project.resources[this.project.alignment.resourceId]?.file
						.name ?? "Missing CSV",
					() =>
						this.openInspector({
							kind: "alignment",
							resourceId: this.project.alignment?.resourceId,
						}),
					() => {
						this.project.alignment = undefined;
						this.render();
					},
				),
			);
		} else {
			const add = button("Add alignment");
			add.addEventListener("click", () => this.pickCsvFor("alignment"));
			alignment.append(add);
		}
		this.sidebar.append(alignment);

		const markers = this.sidebarSection("Markers");
		for (const [id, marker] of Object.entries(this.project.markers)) {
			markers.append(
				this.sidebarItem(
					id,
					marker.config.type,
					() =>
						this.openInspector({
							kind: "marker",
							id,
							resourceId: marker.resourceId,
						}),
					() => this.removeMarker(id),
				),
			);
		}
		const addMarker = button("Add marker sequence");
		addMarker.addEventListener("click", () => this.pickCsvFor("marker"));
		markers.append(addMarker);
		this.sidebar.append(markers);

		const presets = this.sidebarSection("Presets");
		for (const id of Object.keys(this.project.presets)) {
			presets.append(
				this.sidebarItem(
					id,
					`${String(this.project.presets[id].tracks.length)} tracks`,
					() => this.openInspector({ kind: "preset", id }),
					() => {
						delete this.project.presets[id];
						this.render();
					},
				),
			);
		}
		const addPreset = button("Add preset");
		addPreset.addEventListener("click", () => this.addPreset());
		presets.append(addPreset);
		this.sidebar.append(presets);

		const global = this.sidebarSection("Player");
		const features = button("Feature settings");
		features.addEventListener("click", () =>
			this.openInspector({ kind: "features" }),
		);
		global.append(features);
		this.sidebar.append(global);

		const exportSection = this.sidebarSection("Export");
		const exportActions = document.createElement("div");
		exportActions.className = "ts-builder-sidebar-actions";
		const copy = button("Copy config");
		copy.dataset.action = "copy";
		copy.addEventListener("click", () => void this.copyConfig());
		const projectZip = button("Config + media ZIP");
		projectZip.dataset.action = "project-zip";
		projectZip.addEventListener(
			"click",
			() => void this.downloadArchive("project"),
		);
		const standaloneZip = button("Standalone ZIP", "ts-builder-primary-button");
		standaloneZip.dataset.action = "standalone-zip";
		standaloneZip.addEventListener(
			"click",
			() => void this.downloadArchive("standalone"),
		);
		exportActions.append(copy, projectZip, standaloneZip);
		exportSection.append(exportActions);
		this.sidebar.append(exportSection);
		this.sidebar.append(this.status);
	}

	private sidebarSection(label: string): HTMLElement {
		const section = document.createElement("section");
		section.className = "ts-builder-sidebar__section";
		section.setAttribute("aria-label", label);
		return section;
	}

	private sidebarItem(
		title: string,
		meta: string,
		edit?: () => void,
		remove?: () => void,
	): HTMLElement {
		const item = document.createElement("div");
		item.className = "ts-builder-sidebar-item";
		const copy = document.createElement("div");
		const strong = document.createElement("strong");
		strong.textContent = title;
		const small = document.createElement("span");
		small.textContent = meta;
		copy.append(strong, small);
		const actions = document.createElement("div");
		if (edit) {
			const gear = button("⚙", "ts-builder-icon-button");
			gear.setAttribute("aria-label", `Configure ${title}`);
			gear.addEventListener("click", edit);
			actions.append(gear);
		}
		if (remove) {
			const removeButton = button("×", "ts-builder-icon-button");
			removeButton.setAttribute("aria-label", `Remove ${title}`);
			removeButton.addEventListener("click", remove);
			actions.append(removeButton);
		}
		item.append(copy, actions);
		return item;
	}

	private moveView(from: number, to: number): void {
		if (to < 0 || to >= this.project.views.length) return;
		const [view] = this.project.views.splice(from, 1);
		this.project.views.splice(to, 0, view);
		this.render();
	}

	private dropViewAt(index: number): void {
		if (!this.draggedViewId) return;
		const from = this.project.views.findIndex(
			(view) => view.id === this.draggedViewId,
		);
		if (from >= 0) this.moveView(from, index);
	}

	private addView(type: TrackSwitchViewConfig["type"]): void {
		if (
			type === "navigationBar" &&
			this.project.views.some((view) => view.config.type === type)
		) {
			this.setStatus("Only one navigation bar is allowed.", true);
			return;
		}
		const config = defaultView(this.project, type);
		const id = uniqueId(
			type,
			this.project.views.map((view) => view.id),
		);
		const result = appendViewIfValid(
			this.project,
			{ id, config },
			normalizeTrackSwitchConfig,
		);
		if (!result.added) {
			this.setStatus(
				`Could not add ${VIEW_LABELS[type]}: ${result.errors.join(" ")}`,
				true,
			);
			this.render();
			return;
		}
		this.pendingViewId = id;
		this.render();
		this.openInspector({ kind: "view", id });
	}

	private addAlignment(csv: BuilderResource): void {
		const timelines: Record<string, string> = {};
		Object.keys(this.project.media).forEach((id, index) => {
			timelines[id] = csv.csvHeaders?.[index] ?? "";
		});
		this.project.alignment = {
			resourceId: csv.id,
			config: { referenceTimeline: Object.keys(timelines)[0] ?? "", timelines },
		};
		const errors = this.validationErrors();
		if (errors.length) {
			this.project.alignment = undefined;
			this.render();
			this.setStatus(`Could not add alignment: ${errors.join(" ")}`, true);
			return;
		}
		this.render();
		this.openInspector({ kind: "alignment", resourceId: csv.id });
	}

	private addMarker(csv: BuilderResource): void {
		const id = uniqueId("markers", Object.keys(this.project.markers));
		this.project.markers[id] = {
			resourceId: csv.id,
			config: { type: "points", timeCol: csv.csvHeaders?.[0] ?? "" },
		};
		const errors = this.validationErrors();
		if (errors.length) {
			delete this.project.markers[id];
			this.render();
			this.setStatus(
				`Could not add marker sequence: ${errors.join(" ")}`,
				true,
			);
			return;
		}
		this.render();
		this.openInspector({ kind: "marker", id, resourceId: csv.id });
	}

	private addPreset(): void {
		const tracks = Object.entries(this.project.media)
			.filter(([, media]) => media.config.type === "audio")
			.map(([id]) => id);
		if (!tracks.length) {
			this.setStatus("Add audio before creating a preset.", true);
			return;
		}
		const id = uniqueId("preset", Object.keys(this.project.presets));
		this.project.presets[id] = { tracks };
		this.render();
		this.openInspector({ kind: "preset", id });
	}

	private openInspector(target: FormTarget): void {
		this.activeTarget = target;
		this.renderInspector(target);
		if (!this.dialog.open) this.dialog.showModal();
		this.dialogBody
			.querySelector<HTMLElement>("input, select, button")
			?.focus();
	}

	private renderInspector(target: FormTarget): void {
		this.dialogBody.replaceChildren();
		let title = "Settings";
		let value: Record<string, unknown>;
		let schema: JsonSchema;
		let skip = new Set(["type", "src", "css"]);
		if (target.kind === "media" && target.id) {
			const binding = this.project.media[target.id];
			if (!binding) return;
			title = `${target.id} media`;
			value = binding.config as unknown as Record<string, unknown>;
			schema = getDiscriminatedSchema(
				this.rootSchema,
				"MediaEntryConfig",
				binding.config.type,
			);
			this.dialogBody.append(
				this.idEditor("Media ID", target.id, (oldId, nextId) => {
					const renamed = renameMediaId(this.project, oldId, nextId);
					this.activeTarget = { ...target, id: renamed };
				}),
			);
			if (binding.config.type === "audio") {
				skip = new Set(["type", "src", "srcTimeScaled", "css"]);
				this.dialogBody.append(this.synchronizedSourceEditor(target.id));
			}
		} else if (target.kind === "view" && target.id) {
			const view = this.project.views.find((entry) => entry.id === target.id);
			if (!view) return;
			title = `${VIEW_LABELS[view.config.type]} settings`;
			value = view.config as unknown as Record<string, unknown>;
			schema = getDiscriminatedSchema(
				this.rootSchema,
				"TrackSwitchViewConfig",
				view.config.type,
			);
		} else if (target.kind === "alignment" && this.project.alignment) {
			title = "Alignment settings";
			value = this.project.alignment.config as unknown as Record<
				string,
				unknown
			>;
			schema = getDefinition(this.rootSchema, "AlignmentConfig");
			this.dialogBody.append(
				this.csvSourceEditor(target, this.project.alignment),
			);
		} else if (target.kind === "marker" && target.id) {
			const marker = this.project.markers[target.id];
			if (!marker) return;
			title = `${target.id} marker settings`;
			value = marker.config as unknown as Record<string, unknown>;
			schema = getDefinition(this.rootSchema, "MarkerSequenceSourceConfig");
			this.dialogBody.append(
				this.idEditor("Sequence ID", target.id, (oldId, nextId) => {
					const renamed = renameMarkerId(this.project, oldId, nextId);
					this.activeTarget = { ...target, id: renamed };
				}),
			);
			this.dialogBody.append(this.csvSourceEditor(target, marker));
		} else if (target.kind === "preset" && target.id) {
			const preset = this.project.presets[target.id];
			if (!preset) return;
			title = `${target.id} preset`;
			value = preset as unknown as Record<string, unknown>;
			schema = getDefinition(this.rootSchema, "PresetConfig");
			this.dialogBody.append(
				this.idEditor("Preset ID", target.id, (oldId, nextId) => {
					const clean = slugifyId(nextId);
					if (clean !== oldId && this.project.presets[clean])
						throw new Error(`Preset ID already exists: ${clean}`);
					delete this.project.presets[oldId];
					this.project.presets[clean] = preset;
					this.activeTarget = { ...target, id: clean };
				}),
			);
		} else if (target.kind === "features") {
			title = "Feature settings";
			value = this.project.features as Record<string, unknown>;
			schema = schemaForFeatures(this.rootSchema);
		} else return;

		this.dialogTitle.textContent = title;
		const form = document.createElement("div");
		form.className = "ts-builder-form";
		this.dialogBody.append(form);
		renderSchemaForm(
			form,
			value,
			schema,
			{
				rootSchema: this.rootSchema,
				project: this.project,
				target: this.activeTarget ?? target,
				onChange: () => this.renderAfterFieldChange(),
				onStructureChange: () => {
					if (this.activeTarget) this.renderInspector(this.activeTarget);
					this.renderAfterFieldChange();
				},
			},
			skip,
		);
	}

	private idEditor(
		labelText: string,
		currentId: string,
		rename: (oldId: string, nextId: string) => void,
	): HTMLElement {
		const field = document.createElement("label");
		field.className = "ts-builder-special-field";
		field.append(document.createTextNode(labelText));
		const input = document.createElement("input");
		input.className = "ts-builder-input";
		input.value = currentId;
		input.addEventListener("change", () => {
			try {
				rename(currentId, input.value);
				this.render();
			} catch (error) {
				input.value = currentId;
				this.setStatus(describeError(error), true);
			}
		});
		field.append(input);
		return field;
	}

	private csvSourceEditor(
		_target: FormTarget,
		owner: { resourceId: string },
	): HTMLElement {
		const field = document.createElement("label");
		field.className = "ts-builder-special-field";
		field.append(document.createTextNode("CSV source"));
		const select = document.createElement("select");
		select.className = "ts-builder-input";
		for (const resource of Object.values(this.project.resources).filter(
			(entry) => entry.kind === "csv",
		)) {
			const option = document.createElement("option");
			option.value = resource.id;
			option.textContent = resource.file.name;
			option.selected = resource.id === owner.resourceId;
			select.append(option);
		}
		select.addEventListener("change", () => {
			owner.resourceId = select.value;
			if (this.activeTarget) this.activeTarget.resourceId = select.value;
			this.render();
		});
		field.append(select);
		return field;
	}

	private synchronizedSourceEditor(mediaId: string): HTMLElement {
		const binding = this.project.media[mediaId];
		const wrapper = document.createElement("div");
		wrapper.className = "ts-builder-special-field";
		const label = document.createElement("strong");
		label.textContent = "Time-scaled audio source";
		const resource = binding.synchronizedResourceId
			? this.project.resources[binding.synchronizedResourceId]
			: undefined;
		const copy = document.createElement("span");
		copy.textContent = resource ? resource.file.name : "Not included";
		const choose = button(resource ? "Replace source" : "Choose audio file");
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "audio/*";
		input.hidden = true;
		choose.addEventListener("click", () => input.click());
		input.addEventListener("change", () => {
			const selected = input.files?.[0];
			if (!selected) return;
			const result = addFilesToProject(
				this.project,
				[selected],
				undefined,
				false,
			);
			if (result.added[0]?.kind !== "audio") {
				for (const added of result.added) this.removeResourceNow(added.id);
				this.setStatus(
					result.errors[0] ?? "Select a supported audio file.",
					true,
				);
				return;
			}
			if (resource) this.removeResourceNow(resource.id);
			binding.synchronizedResourceId = result.added[0].id;
			if (binding.config.type === "audio")
				binding.config.srcTimeScaled = { src: result.added[0].exportPath };
			this.render();
		});
		wrapper.append(label, copy, choose, input);
		if (
			resource &&
			binding.config.type === "audio" &&
			binding.config.srcTimeScaled
		) {
			const settings = document.createElement("div");
			settings.className = "ts-builder-form";
			renderSchemaForm(
				settings,
				binding.config.srcTimeScaled as unknown as Record<string, unknown>,
				getDefinition(this.rootSchema, "SynchronizedAudioSourceConfig"),
				{
					rootSchema: this.rootSchema,
					project: this.project,
					target: this.activeTarget ?? { kind: "media", id: mediaId },
					onChange: () => this.renderAfterFieldChange(),
					onStructureChange: () => {
						if (this.activeTarget) this.renderInspector(this.activeTarget);
						this.renderAfterFieldChange();
					},
				},
				new Set(["src"]),
			);
			wrapper.append(settings);
			const remove = button("Remove source", "ts-builder-text-button");
			remove.addEventListener("click", () => {
				this.removeResourceNow(resource.id);
				delete binding.synchronizedResourceId;
				if (binding.config.type === "audio")
					delete binding.config.srcTimeScaled;
				this.render();
			});
			wrapper.append(remove);
		}
		return wrapper;
	}

	private renderAfterFieldChange(): void {
		const errors = this.validationErrors();
		this.setExportDisabled(errors.length > 0 || this.runtimeFailed);
		if (errors.length) this.setStatus(errors.join(" "), true);
		this.schedulePreview(errors);
	}

	private validationErrors(): string[] {
		return validateBuilderProject(this.project, normalizeTrackSwitchConfig);
	}

	private schedulePreview(errors: string[]): void {
		if (this.previewTimer !== undefined) window.clearTimeout(this.previewTimer);
		if (errors.length) return;
		this.runtimeFailed = false;
		this.setExportDisabled(false);
		this.previewTimer = window.setTimeout(() => {
			this.updatePreview(buildRuntimePreviewConfig(this.project));
		}, 250);
	}

	private updatePreview(config: TrackSwitchInit): void {
		if (!this.preview) {
			this.preview = document.createElement(
				"trackswitch-player",
			) as TrackswitchPreviewElement;
			this.preview.addEventListener("trackswitch-loaded", () => {
				this.runtimeFailed = false;
				this.pendingViewId = null;
				this.setExportDisabled(this.validationErrors().length > 0);
				this.decoratePreviewPanels();
			});
			this.preview.addEventListener("trackswitch-error", (event) => {
				const detail = (event as CustomEvent<{ message?: string }>).detail;
				const message = detail?.message ?? "Unknown runtime error.";
				if (this.pendingViewId) {
					const failedViewId = this.pendingViewId;
					this.pendingViewId = null;
					const index = this.project.views.findIndex(
						(view) => view.id === failedViewId,
					);
					if (index >= 0) this.project.views.splice(index, 1);
					if (
						this.activeTarget?.kind === "view" &&
						this.activeTarget.id === failedViewId &&
						this.dialog.open
					) {
						this.activeTarget = null;
						this.dialog.close();
					} else {
						this.render();
					}
					this.setStatus(
						`Could not add panel, so it was removed: ${message}`,
						true,
					);
					return;
				}
				this.runtimeFailed = true;
				this.setExportDisabled(true);
				this.setStatus(`Player could not load: ${message}`, true);
			});
			this.previewHost.replaceChildren(this.preview);
		}
		this.preview.config = config;
		window.requestAnimationFrame(() => this.decoratePreviewPanels());
	}

	private decoratePreviewPanels(): void {
		const shadowRoot = this.preview?.shadowRoot;
		const mount = shadowRoot?.querySelector<HTMLElement>(
			".trackswitch-element-mount",
		);
		this.panelRail.replaceChildren();
		if (!shadowRoot || !mount) return;
		shadowRoot
			.querySelectorAll(".ts-builder-preview-toolbar")
			.forEach((toolbar) => {
				toolbar.remove();
			});
		mount
			.querySelectorAll<HTMLElement>("[data-builder-panel]")
			.forEach((host) => {
				delete host.dataset.builderPanel;
				host.draggable = false;
			});
		const mountChildren = Array.from(mount.children).filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement &&
				!child.classList.contains("ts-builder-preview-toolbar"),
		);
		const hosts = mountChildren.slice(-this.project.views.length);
		const previewRect = this.previewHost.getBoundingClientRect();
		let previousBottom = -8;
		this.project.views.forEach((view, index) => {
			const host = hosts[index];
			if (!host) return;
			const hostRect = host.getBoundingClientRect();
			const row = document.createElement("div");
			row.className = "ts-builder-panel-rail__item";
			row.draggable = true;
			row.dataset.viewId = view.id;
			row.setAttribute(
				"aria-label",
				`${VIEW_LABELS[view.config.type]} panel controls`,
			);
			const naturalTop = hostRect.top - previewRect.top;
			const top = Math.max(naturalTop, previousBottom + 4);
			row.style.top = `${String(Math.max(0, Math.round(top)))}px`;
			previousBottom = top + 64;
			const heading = document.createElement("div");
			heading.className = "ts-builder-panel-rail__heading";
			const grip = document.createElement("span");
			grip.className = "ts-builder-panel-rail__grip";
			grip.textContent = "⠿";
			grip.setAttribute("aria-hidden", "true");
			const name = document.createElement("span");
			name.textContent = `${String(index + 1).padStart(2, "0")} ${VIEW_LABELS[view.config.type]}`;
			heading.append(grip, name);
			const actions = document.createElement("span");
			actions.className = "ts-builder-panel-rail__actions";
			const control = (
				text: string,
				accessibleLabel: string,
				onClick: () => void,
			) => {
				const element = document.createElement("button");
				element.type = "button";
				element.className = "ts-builder-icon-button";
				element.textContent = text;
				element.setAttribute("aria-label", accessibleLabel);
				element.addEventListener("click", (event) => {
					event.stopPropagation();
					onClick();
				});
				return element;
			};
			const up = control("↑", `Move ${name.textContent} up`, () =>
				this.moveView(index, index - 1),
			);
			up.disabled = index === 0;
			const down = control("↓", `Move ${name.textContent} down`, () =>
				this.moveView(index, index + 1),
			);
			down.disabled = index === this.project.views.length - 1;
			const gear = control("⚙", `Configure ${name.textContent}`, () =>
				this.openInspector({ kind: "view", id: view.id }),
			);
			const remove = control("×", `Remove ${name.textContent}`, () => {
				this.project.views.splice(index, 1);
				this.render();
			});
			actions.append(up, down, gear, remove);
			row.append(heading, actions);
			row.addEventListener("dragstart", (event) => {
				this.draggedViewId = view.id;
				event.dataTransfer?.setData("text/plain", view.id);
				row.classList.add("is-dragging");
			});
			row.addEventListener("dragend", () => {
				this.draggedViewId = null;
				row.classList.remove("is-dragging");
			});
			row.addEventListener("dragover", (event) => event.preventDefault());
			row.addEventListener("drop", (event) => {
				event.preventDefault();
				this.dropViewAt(index);
			});
			this.panelRail.append(row);
		});
	}

	private removeMedia(id: string): void {
		const references = findMediaReferences(this.project, id);
		if (references.length) {
			this.setStatus(
				`Remove references before deleting ${id}: ${references.join(", ")}.`,
				true,
			);
			return;
		}
		const binding = this.project.media[id];
		if (!binding) return;
		this.removeResourceNow(binding.resourceId);
		if (binding.synchronizedResourceId)
			this.removeResourceNow(binding.synchronizedResourceId);
		delete this.project.media[id];
		this.render();
	}

	private removeMarker(id: string): void {
		const references = findMarkerReferences(this.project, id);
		if (references.length) {
			this.setStatus(
				`Remove marker layers before deleting ${id}: ${references.join(", ")}.`,
				true,
			);
			return;
		}
		delete this.project.markers[id];
		this.render();
	}

	private removeResource(id: string): void {
		const usedBy = [
			...(this.project.alignment?.resourceId === id ? ["alignment"] : []),
			...Object.entries(this.project.markers)
				.filter(([, marker]) => marker.resourceId === id)
				.map(([markerId]) => `markers.${markerId}`),
		];
		if (usedBy.length) {
			this.setStatus(
				`Remove references before deleting this file: ${usedBy.join(", ")}.`,
				true,
			);
			return;
		}
		this.removeResourceNow(id);
		this.render();
	}

	private removeResourceNow(id: string): void {
		const resource = this.project.resources[id];
		if (resource) URL.revokeObjectURL(resource.previewUrl);
		delete this.project.resources[id];
	}

	private async copyConfig(): Promise<void> {
		try {
			await navigator.clipboard.writeText(
				`${JSON.stringify(buildPlayerConfig(this.project, "export"), null, "\t")}\n`,
			);
			this.setStatus("Player config copied.");
		} catch (error) {
			this.setStatus(
				`Could not copy the config: ${describeError(error)}`,
				true,
			);
		}
	}

	private async downloadArchive(variant: ArchiveVariant): Promise<void> {
		const errors = this.validationErrors();
		if (errors.length) {
			this.setStatus(errors.join(" "), true);
			return;
		}
		try {
			this.setStatus("Building ZIP…");
			let assets: StandaloneAssets | undefined;
			if (variant === "standalone") {
				const [playerScript, license, thirdPartyNotices] = await Promise.all([
					this.fetchText(this.assetUrls.playerScript),
					this.fetchText(this.assetUrls.license),
					this.fetchText(this.assetUrls.thirdPartyNotices),
				]);
				assets = { playerScript, license, thirdPartyNotices };
			}
			const blob = await createArchiveBlob(
				buildArchiveEntries(this.project, variant, assets),
			);
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download =
				variant === "standalone"
					? "trackswitch-standalone.zip"
					: "trackswitch-project.zip";
			link.click();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
			this.setStatus(`${link.download} downloaded.`);
		} catch (error) {
			this.setStatus(`Could not build the ZIP: ${describeError(error)}`, true);
		}
	}

	private async fetchText(url: string): Promise<string> {
		const response = await fetch(url);
		if (!response.ok)
			throw new Error(`${url} returned ${String(response.status)}.`);
		return response.text();
	}

	private setStatus(message: string, error = false): void {
		this.status.textContent = message;
		this.status.classList.toggle("is-error", error);
	}

	private revokeAllUrls(): void {
		for (const resource of Object.values(this.project.resources))
			URL.revokeObjectURL(resource.previewUrl);
	}
}
