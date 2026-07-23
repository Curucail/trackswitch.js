(function () {
	"use strict";

	var MODE_DEFAULT = "default";
	var MODE_SYNC = "sync";
	var MODE_INTERACTIVE = "interactive";

	function readControl(root, name, fallback) {
		var control = root.querySelector(
			'input[name="' + name + '"], select[name="' + name + '"]',
		);
		if (!control) return fallback;
		return control.type === "checkbox" ? control.checked : control.value;
	}

	function markerLayer(set) {
		return { set: set, color: "#ed8c01", line: "dashed" };
	}

	function buildDefaultConfig(basePath, controls) {
		var media = {
			violins: {
				type: "audio",
				title: "Violins",
				image: basePath + "/violins.png",
				src: basePath + "/violins.mp3",
			},
			synths: {
				type: "audio",
				title: "Synths",
				image: basePath + "/synth.png",
				src: basePath + "/synth.mp3",
			},
			bass: {
				type: "audio",
				title: "Bass",
				image: basePath + "/bass.png",
				src: basePath + "/bass.mp3",
			},
			drums: {
				type: "audio",
				title: "Drums",
				image: basePath + "/drums.png",
				src: basePath + "/drums.mp3",
			},
		};
		var views = [];

		if (controls.customImage) {
			views.push({
				type: "image",
				src: basePath + "/cover.png",
				seekable: controls.seekableImage,
			});
		}
		if (controls.trackImageBySolo) {
			views.push({ type: "perTrackImage", seekable: true });
		}
		if (controls.waveform) {
			var waveform = {
				type: "waveform",
				playbackFollowMode: controls.waveformPlaybackFollowMode,
			};
			views.push(waveform);
		}
		if (controls.text) {
			views.push({
				type: "text",
				text: "Choose which parts of the arrangement you want to hear.",
				bold: true,
				fontSize: 18,
			});
		}
		views.push({
			type: "trackList",
			tracks: ["violins", "synths", "bass", "drums"],
			trackVolumeControls: controls.trackVolumeControls,
			trackPanControls: controls.trackPanControls,
		});
		views.unshift(buildNavigationBar(controls));

		var config = {
			media: media,
			views: views,
			features: buildFeatures(controls, false),
		};
		if (controls.presets) {
			config.presets = {
				all: {
					label: "All Tracks",
					tracks: ["violins", "synths", "bass", "drums"],
				},
				strings: {
					label: "Violins & Synths",
					tracks: ["violins", "synths"],
				},
				rhythm: { label: "Drums & Bass", tracks: ["bass", "drums"] },
				drumsOnly: { label: "Drums Only", tracks: ["drums"] },
			};
		}
		return config;
	}

	function buildAlignedConfig(basePath, controls) {
		var media = {
			score: {
				type: "musicxml",
				src: basePath + "/Schubert_D911-03.xml",
			},
			midi: { type: "midi", src: basePath + "/Schubert_D911-03.mid" },
			hu33: {
				type: "audio",
				title: "Schubert: Winterreise, D. 911: No. 3 - HU33",
				src: basePath + "/Schubert_D911-03_HU33.wav",
				srcSynchronized: {
					src: basePath + "/Schubert_D911-03_HU33.wav",
					timeline: "reference",
				},
			},
			sc06: {
				type: "audio",
				title: "Schubert: Winterreise, D. 911: No. 3 - SC06",
				src: basePath + "/Schubert_D911-03_SC06.wav",
				srcSynchronized: {
					src: basePath + "/Schubert_D911-03_SC06_syncronized.wav",
					timeline: "reference",
				},
			},
		};
		var views = [];
		var markerLayersA = controls.markers ? [markerLayer("hu33Measures")] : [];
		var markerLayersB = controls.markers ? [markerLayer("sc06Structure")] : [];

		if (controls.sheetNotePreview) {
			views.push({
				type: "sheetMusic",
				mediaID: "score",
				maxHeight: 370,
				renderScale: 0.65,
				followPlayback: true,
				cursorColor: "#999999",
				cursorAlpha: 0.4,
			});
		}
		if (controls.midi) {
			views.push({
				type: "midi",
				mediaID: "midi",
				height: 180,
				maxZoom: 5,
				playbackFollowMode: "center",
				timer: true,
				markerLayers: markerLayersA,
			});
		}
		if (controls.text) {
			views.push({
				type: "text",
				text: "Compare aligned performances on the reference timeline.",
				bold: true,
				fontSize: 18,
			});
		}
		if (controls.waveform) {
			views.push({
				type: "waveform",
				sourceTracks: ["hu33"],
				height: 100,
				playbackFollowMode: controls.waveformPlaybackFollowMode,
				timeAxis: controls.waveformTimeAxis,
				alignedPlayhead: controls.alignedPlayhead,
				markerLayers: controls.showAlignmentPoints
					? markerLayersA.concat([
						{ set: "alignment", line: "dashed", foldToReference: true },
					])
					: markerLayersA,
			});
			views.push({
				type: "waveform",
				sourceTracks: ["sc06"],
				height: 100,
				playbackFollowMode: controls.waveformPlaybackFollowMode,
				timeAxis: controls.waveformTimeAxis,
				alignedPlayhead: controls.alignedPlayhead,
				markerLayers: controls.showAlignmentPoints
					? markerLayersB.concat([
						{ set: "alignment", line: "dashed", foldToReference: true },
					])
					: markerLayersB,
			});
		}
		if (controls.warpingMatrix) {
			views.push({ type: "warpingMatrix", x: "hu33", y: "sc06", height: 200 });
		}
		views.push({
			type: "trackList",
			tracks: ["hu33", "sc06"],
			trackVolumeControls: controls.trackVolumeControls,
			trackPanControls: controls.trackPanControls,
		});
		views.unshift(buildNavigationBar(controls));

		var config = {
			media: media,
			alignment: {
				src: basePath + "/alignment.csv",
				referenceTimeline: "reference",
				timelines: {
					reference: "time_sync_reference",
					score: "measure_Schubert_D911-03_2",
					midi: "time_Schubert_D911-03",
					hu33: "time_Schubert_D911-03_HU33",
					sc06: "time_Schubert_D911-03_SC06",
				},
				outside: "clamp",
				duplicatePlacements: "average",
			},
			views: views,
			features: buildFeatures(controls, true),
		};
		if (controls.markers) {
			config.markers = {
				hu33Measures: {
					src: basePath + "/HU33-markers.csv",
					timeline: "hu33",
					timeCol: "start",
					labelCol: "label",
				},
				sc06Structure: {
					src: basePath + "/SC06-markers.csv",
					timeline: "sc06",
					timeCol: "start",
					labelCol: "structure",
				},
			};
		}
		return config;
	}

	function buildFeatures(controls, aligned) {
		return {
			exclusiveSolo: aligned || controls.exclusiveSolo,
			muteOtherPlayerInstances: controls.muteOtherPlayerInstances,
			customizablePanelOrder: controls.customizablePanelOrder,
			tabView: controls.tabView,
			iosAudioUnlock: controls.iosAudioUnlock,
			keyboard: controls.keyboard,
		};
	}

	function buildNavigationBar(controls) {
		return {
			type: "navigationBar",
			globalVolume: controls.globalVolume,
			repeat: controls.repeatEnabled,
			looping: controls.looping,
			markerNavigation: controls.markerNavigation,
			seekBar: controls.seekBar,
			timer: controls.timer,
		};
	}

	document.addEventListener("DOMContentLoaded", function () {
		var playerRoot = document.getElementById("ts-showcase-player");
		var controlsRoot = document.getElementById("ts-showcase-controls");
		var quickstart = document.getElementById("ts-dynamic-quickstart");
		var copyButton = document.getElementById("ts-copy-quickstart");
		var note = document.getElementById("ts-showcase-note");
		var mode = MODE_DEFAULT;
		var controller = null;
		var rebuildTimer = null;

		if (!playerRoot || !controlsRoot || !window.TrackSwitch) return;

		function controls() {
			var names = [
				"looping", "markerNavigation", "globalVolume", "trackVolumeControls", "trackPanControls",
				"customizablePanelOrder", "presets", "seekBar", "timer", "keyboard",
				"waveform", "midi", "text", "alignedPlayhead", "showAlignmentPoints",
				"markers", "sheetNotePreview", "warpingMatrix", "customImage",
				"seekableImage", "trackImageBySolo", "exclusiveSolo", "tabView",
				"muteOtherPlayerInstances", "iosAudioUnlock", "repeatEnabled"
			];
			var result = {};
			names.forEach(function (name) {
				result[name] = readControl(controlsRoot, name, false);
			});
			result.waveformPlaybackFollowMode = readControl(
				controlsRoot,
				"waveformPlaybackFollowMode",
				"off",
			);
			result.waveformTimeAxis = readControl(
				controlsRoot,
				"waveformTimeAxis",
				"shared",
			);
			return result;
		}

		function configForCurrentMode() {
			var values = controls();
			var defaultBase =
				playerRoot.getAttribute("data-ts-default-base") ||
				playerRoot.getAttribute("data-ts-base") ||
				"assets/multitracks";
			var syncBase =
				playerRoot.getAttribute("data-ts-sync-base") || "assets/alignment";
			return mode === MODE_SYNC
				? buildAlignedConfig(syncBase, values)
				: buildDefaultConfig(defaultBase, values);
		}

		function updateWaveformTimeAxisAvailability() {
			var control = controlsRoot.querySelector(
				'select[name="waveformTimeAxis"]',
			);
			if (!control) return;
			var waveformEnabled = readControl(controlsRoot, "waveform", false);
			var disabled = mode !== MODE_SYNC || !waveformEnabled;
			control.disabled = disabled;
			var row = control.closest(".ts-control-row");
			if (row) row.classList.toggle("is-disabled", disabled);
		}

		function declarativeSnippet(config) {
			return (
				'<trackswitch-player>\n  <script type="application/json">\n' +
				JSON.stringify(config, null, 2)
					.split("\n")
					.map(function (line) { return "    " + line; })
					.join("\n") +
				'\n  <\/script>\n</trackswitch-player>'
			);
		}

		function render() {
			var config;
			if (controller && typeof controller.destroy === "function") controller.destroy();
			playerRoot.replaceChildren();

			if (mode === MODE_INTERACTIVE) {
				controller = window.TrackSwitch.createTrackSwitchSyncInteractive(playerRoot, {
					workerUrl:
						playerRoot.getAttribute("data-ts-interactive-worker") ||
						"js/trackswitch-interactive-worker.js",
					alignmentMethod: "mrmsdtw",
				});
				controller.initialize();
				if (quickstart) quickstart.textContent = "// Interactive alignment uses its dedicated file-drop configuration.";
				return;
			}

			config = configForCurrentMode();
			controller = window.TrackSwitch.createTrackSwitch(playerRoot, config);
			controller.load();
			if (quickstart) {
				quickstart.textContent = declarativeSnippet(config);
				quickstart.className = "language-html";
			}
			if (note) note.textContent = "";
		}

		function scheduleRender() {
			clearTimeout(rebuildTimer);
			rebuildTimer = setTimeout(render, 120);
		}

		controlsRoot.addEventListener("change", function () {
			updateWaveformTimeAxisAvailability();
			scheduleRender();
		});
		Array.prototype.forEach.call(
			controlsRoot.querySelectorAll("[data-ts-mode-button]"),
			function (button) {
				button.addEventListener("click", function () {
					mode = button.getAttribute("data-ts-mode") || MODE_DEFAULT;
					Array.prototype.forEach.call(
						controlsRoot.querySelectorAll("[data-ts-mode-button]"),
						function (entry) {
							var active = entry === button;
							entry.classList.toggle("is-active", active);
							entry.setAttribute("aria-selected", String(active));
						},
					);
					updateWaveformTimeAxisAvailability();
					render();
				});
			},
		);

		if (copyButton) {
			copyButton.addEventListener("click", function () {
				var text = quickstart ? quickstart.textContent || "" : "";
				navigator.clipboard.writeText(text).then(function () {
					copyButton.textContent = "Copied to clipboard";
					setTimeout(function () { copyButton.textContent = "Copy quickstart"; }, 1200);
				});
			});
		}

		updateWaveformTimeAxisAvailability();
		render();
	});
})();
