import type {
	AudioDownloadSizeInfo,
	TrackPanAlgorithm,
	TrackRuntime,
	TrackSourceDefinition,
	TrackSwitchFeatures,
	TrackTiming,
} from "../domain/types";
import { calculateTrackTiming, inferSourceMimeType } from "../shared/audio";
import { getAudioContext } from "./audio-context";
import { readSourceSampleRate } from "./source-sample-rate";

const MIME_TYPE_TABLE: Record<string, string> = {
	".aac": "audio/aac;",
	".aif": "audio/aiff;",
	".aiff": "audio/aiff;",
	".au": "audio/basic;",
	".flac": "audio/flac;",
	".mp1": "audio/mpeg;",
	".mp2": "audio/mpeg;",
	".mp3": "audio/mpeg;",
	".mpg": "audio/mpeg;",
	".mpeg": "audio/mpeg;",
	".m4a": "audio/mp4;",
	".mp4": "audio/mp4;",
	".oga": "audio/ogg;",
	".ogg": "audio/ogg;",
	".wav": "audio/wav;",
	".webm": "audio/webm;",
};

/**
 * Whether a source is worth attempting to load.
 *
 * `canPlayType` is only a pre-filter for picking among fallback sources, so an
 * unknown media type must not disqualify a source: object URLs and
 * extension-less paths carry no type to infer, and rejecting them here would
 * fail the track before it is ever decoded. Sources that turn out to be
 * undecodable are skipped by the decode step instead.
 */
function isPlayableSource(
	source: TrackSourceDefinition,
	audioElement: HTMLAudioElement,
): boolean {
	const mime = inferSourceMimeType(source.src, source.type, MIME_TYPE_TABLE);
	if (!mime) {
		return true;
	}

	return !!audioElement.canPlayType?.(mime).replace(/no/, "");
}

interface LoadTrackResult {
	success: boolean;
	error: string | null;
}

interface LoadedSourceSelection {
	buffer: AudioBuffer;
	timing: TrackTiming;
	sourceIndex: number;
	sourceSampleRate: number | null;
}

interface LoadSourceSelectionResult {
	success: boolean;
	selection: LoadedSourceSelection | null;
	error: string | null;
}

interface AudioSourceSizeProbeResult {
	bytes: number | null;
}

const RESUME_WAIT_TIMEOUT_MS = 250;

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.min(1, value));
}

function clampPan(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.max(-1, Math.min(1, value));
}

/**
 * True balance control: each channel's gain is scaled independently, so a
 * hard-left position silences the right channel instead of summing it into
 * the left one (which is what StereoPannerNode does for stereo sources).
 */
function computeBalanceGains(pan: number): { gainL: number; gainR: number } {
	const x = clampPan(pan);
	return {
		gainL: x <= 0 ? 1 : 1 - x,
		gainR: x >= 0 ? 1 : 1 + x,
	};
}

export class AudioEngine {
	private context: AudioContext | null;
	private readonly alignmentEnabled: boolean;
	private globalVolumeEnabled: boolean;
	private globalPanEnabled: boolean;
	private globalPanAlgorithm: TrackPanAlgorithm;
	private gainNodeMaster: GainNode | null;
	private gainNodeVolume: GainNode | null;
	private masterVolume: number;
	private masterPan: number;
	private masterPannerNode: StereoPannerNode | null;
	private masterPanUpmixNode: GainNode | null;
	private masterPanSplitterNode: ChannelSplitterNode | null;
	private masterPanGainLeftNode: GainNode | null;
	private masterPanGainRightNode: GainNode | null;
	private masterPanMergerNode: ChannelMergerNode | null;

	constructor(
		_features: TrackSwitchFeatures,
		initialVolume: number,
		alignmentEnabled = false,
		globalVolumeEnabled = false,
		globalPanEnabled = false,
		globalPanAlgorithm: TrackPanAlgorithm = "balance",
	) {
		this.alignmentEnabled = alignmentEnabled;
		this.globalVolumeEnabled = globalVolumeEnabled;
		this.globalPanEnabled = globalPanEnabled;
		this.globalPanAlgorithm = globalPanAlgorithm;
		this.context = null;
		this.gainNodeMaster = null;
		this.gainNodeVolume = null;
		this.masterVolume = Math.max(
			0,
			Math.min(1, Number.isFinite(initialVolume) ? initialVolume : 0),
		);
		this.masterPan = 0;
		this.masterPannerNode = null;
		this.masterPanUpmixNode = null;
		this.masterPanSplitterNode = null;
		this.masterPanGainLeftNode = null;
		this.masterPanGainRightNode = null;
		this.masterPanMergerNode = null;
	}

	private initializeAudioGraph(): void {
		if (this.context && this.gainNodeMaster && this.gainNodeVolume) {
			return;
		}

		const context = getAudioContext();
		if (!context) {
			this.context = null;
			this.gainNodeMaster = null;
			this.gainNodeVolume = null;
			return;
		}

		this.context = context;

		if (!this.gainNodeVolume) {
			const volumeNode = this.context.createGain();
			volumeNode.gain.value = this.globalVolumeEnabled
				? this.masterVolume
				: 1.0;
			volumeNode.connect(this.context.destination);
			this.gainNodeVolume = volumeNode;
		}

		if (!this.gainNodeMaster && this.gainNodeVolume) {
			const masterNode = this.context.createGain();
			masterNode.gain.value = 0.0;
			this.gainNodeMaster = masterNode;
			this.configureMasterPanningGraph();
		}

		this.setMasterVolume(this.masterVolume);
	}

	/**
	 * (Re)builds the gainNodeMaster -> [master panning nodes] -> gainNodeVolume
	 * chain, mirroring configurePanningGraph but for the single master bus. Only
	 * builds the extra nodes when a global pan control is actually enabled — a
	 * disabled/absent one connects the master bus straight through, same as an
	 * unconfigured track.
	 */
	private configureMasterPanningGraph(): void {
		if (!this.context || !this.gainNodeMaster || !this.gainNodeVolume) {
			return;
		}

		const previousNodes = [
			this.masterPannerNode,
			this.masterPanUpmixNode,
			this.masterPanSplitterNode,
			this.masterPanGainLeftNode,
			this.masterPanGainRightNode,
			this.masterPanMergerNode,
		];

		try {
			this.gainNodeMaster.disconnect();
		} catch (_error) {
			// ignore
		}
		previousNodes.forEach((node) => {
			try {
				node?.disconnect();
			} catch (_error) {
				// ignore
			}
		});

		this.masterPannerNode = null;
		this.masterPanUpmixNode = null;
		this.masterPanSplitterNode = null;
		this.masterPanGainLeftNode = null;
		this.masterPanGainRightNode = null;
		this.masterPanMergerNode = null;

		if (!this.globalPanEnabled) {
			this.gainNodeMaster.connect(this.gainNodeVolume);
			return;
		}

		const useBalanceAlgorithm = this.globalPanAlgorithm === "balance";
		const stereoPanningSupported = this.supportsStereoPanning();

		if (
			!useBalanceAlgorithm &&
			stereoPanningSupported &&
			typeof this.context.createStereoPanner === "function"
		) {
			this.masterPannerNode = this.context.createStereoPanner();
			this.gainNodeMaster.connect(this.masterPannerNode);
			this.masterPannerNode.connect(this.gainNodeVolume);
			return;
		}

		if (useBalanceAlgorithm) {
			this.masterPanUpmixNode = this.context.createGain();
			this.masterPanUpmixNode.channelCount = 2;
			this.masterPanUpmixNode.channelCountMode = "explicit";
			this.masterPanUpmixNode.channelInterpretation = "speakers";
			this.masterPanSplitterNode = this.context.createChannelSplitter(2);
			this.masterPanGainLeftNode = this.context.createGain();
			this.masterPanGainRightNode = this.context.createGain();
			this.masterPanMergerNode = this.context.createChannelMerger(2);

			this.gainNodeMaster.connect(this.masterPanUpmixNode);
			this.masterPanUpmixNode.connect(this.masterPanSplitterNode);
			this.masterPanSplitterNode.connect(this.masterPanGainLeftNode, 0);
			this.masterPanSplitterNode.connect(this.masterPanGainRightNode, 1);
			this.masterPanGainLeftNode.connect(this.masterPanMergerNode, 0, 0);
			this.masterPanGainRightNode.connect(this.masterPanMergerNode, 0, 1);
			this.masterPanMergerNode.connect(this.gainNodeVolume);

			const { gainL, gainR } = computeBalanceGains(
				this.globalPanEnabled ? this.masterPan : 0,
			);
			this.masterPanGainLeftNode.gain.value = gainL;
			this.masterPanGainRightNode.gain.value = gainR;
			return;
		}

		// "pan" algorithm requested but unsupported by this browser: pass through.
		this.gainNodeMaster.connect(this.gainNodeVolume);
	}

	get currentTime(): number {
		return this.context ? this.context.currentTime : 0;
	}

	canUseAudioGraph(): boolean {
		this.initializeAudioGraph();
		return !!(this.context && this.gainNodeMaster && this.gainNodeVolume);
	}

	supportsStereoPanning(): boolean {
		if (this.context) {
			return typeof this.context.createStereoPanner === "function";
		}

		if (typeof window === "undefined") {
			return false;
		}

		const audioContextHost = window as unknown as {
			AudioContext?: typeof AudioContext;
			webkitAudioContext?: typeof AudioContext;
		};
		const AudioContextConstructor =
			audioContextHost.AudioContext || audioContextHost.webkitAudioContext;

		return !!(
			AudioContextConstructor?.prototype &&
			typeof AudioContextConstructor.prototype.createStereoPanner === "function"
		);
	}

	/**
	 * (Re)builds the gainNode -> [panning nodes] -> gainNodeMaster chain for a
	 * runtime according to its current panAlgorithm, disconnecting whatever
	 * panning nodes it previously had. Safe to call on an already-connected
	 * runtime (e.g. when the pan algorithm changes without reloading audio).
	 */
	private configurePanningGraph(runtime: TrackRuntime): void {
		if (!this.context || !this.gainNodeMaster || !runtime.gainNode) {
			return;
		}

		const previousNodes = [
			runtime.pannerNode,
			runtime.panUpmixNode,
			runtime.panSplitterNode,
			runtime.panGainLeftNode,
			runtime.panGainRightNode,
			runtime.panMergerNode,
		];

		const useBalanceAlgorithm = runtime.panAlgorithm === "balance";
		const stereoPanningSupported = this.supportsStereoPanning();

		if (useBalanceAlgorithm) {
			runtime.pannerNode = null;
			runtime.panUpmixNode = this.context.createGain();
			runtime.panUpmixNode.channelCount = 2;
			runtime.panUpmixNode.channelCountMode = "explicit";
			runtime.panUpmixNode.channelInterpretation = "speakers";
			runtime.panSplitterNode = this.context.createChannelSplitter(2);
			runtime.panGainLeftNode = this.context.createGain();
			runtime.panGainRightNode = this.context.createGain();
			runtime.panMergerNode = this.context.createChannelMerger(2);
		} else {
			runtime.panUpmixNode = null;
			runtime.panSplitterNode = null;
			runtime.panGainLeftNode = null;
			runtime.panGainRightNode = null;
			runtime.panMergerNode = null;
			runtime.pannerNode =
				stereoPanningSupported &&
				typeof this.context.createStereoPanner === "function"
					? this.context.createStereoPanner()
					: null;
		}

		try {
			runtime.gainNode.disconnect();
		} catch (_error) {
			// ignore
		}
		previousNodes.forEach((node) => {
			try {
				node?.disconnect();
			} catch (_error) {
				// ignore
			}
		});

		if (runtime.pannerNode) {
			runtime.gainNode.connect(runtime.pannerNode);
			runtime.pannerNode.connect(this.gainNodeMaster);
		} else if (
			runtime.panUpmixNode &&
			runtime.panSplitterNode &&
			runtime.panGainLeftNode &&
			runtime.panGainRightNode &&
			runtime.panMergerNode
		) {
			runtime.gainNode.connect(runtime.panUpmixNode);
			runtime.panUpmixNode.connect(runtime.panSplitterNode);
			runtime.panSplitterNode.connect(runtime.panGainLeftNode, 0);
			runtime.panSplitterNode.connect(runtime.panGainRightNode, 1);
			runtime.panGainLeftNode.connect(runtime.panMergerNode, 0, 0);
			runtime.panGainRightNode.connect(runtime.panMergerNode, 0, 1);
			runtime.panMergerNode.connect(this.gainNodeMaster);

			const { gainL, gainR } = computeBalanceGains(runtime.state.pan);
			runtime.panGainLeftNode.gain.value = gainL;
			runtime.panGainRightNode.gain.value = gainR;
		} else {
			runtime.gainNode.connect(this.gainNodeMaster);
		}
	}

	/**
	 * Rebuilds the panning graph for runtimes whose panAlgorithm changed
	 * without reloading their audio buffers (used by config hot reload).
	 */
	refreshPanningGraph(runtimes: TrackRuntime[]): void {
		if (!this.context || !this.gainNodeMaster) {
			return;
		}

		runtimes.forEach((runtime) => {
			this.configurePanningGraph(runtime);
		});
	}

	private requestContextResume(): Promise<void> {
		if (!this.context) {
			return Promise.resolve();
		}

		if (
			this.context.state !== "suspended" &&
			this.context.state !== "interrupted"
		) {
			return Promise.resolve();
		}

		try {
			const maybePromise = this.context.resume();
			if (
				maybePromise &&
				typeof (maybePromise as Promise<void>).then === "function"
			) {
				return (maybePromise as Promise<void>).then(() => {}).catch(() => {});
			}
		} catch (_error) {
			// ignore
		}

		return Promise.resolve();
	}

	private async waitForResumeAttempt(timeoutMs: number): Promise<void> {
		const resumeAttempt = this.requestContextResume();
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		const timeoutPromise = new Promise<void>((resolve) => {
			timeoutId = setTimeout(resolve, timeoutMs);
		});

		await Promise.race([resumeAttempt, timeoutPromise]);

		if (timeoutId !== null) {
			clearTimeout(timeoutId);
		}
	}

	primeFromUserGesture(): void {
		this.initializeAudioGraph();

		void this.requestContextResume();
	}

	async prepareForPlaybackStart(): Promise<boolean> {
		this.primeFromUserGesture();

		if (!this.context || !this.gainNodeMaster || !this.gainNodeVolume) {
			return false;
		}

		await this.waitForResumeAttempt(RESUME_WAIT_TIMEOUT_MS);

		return !!(this.context && this.gainNodeMaster && this.gainNodeVolume);
	}

	getContext(): AudioContext | null {
		this.initializeAudioGraph();
		return this.context;
	}

	async unlockIOSPlayback(): Promise<void> {
		this.initializeAudioGraph();

		if (!this.context) {
			return;
		}

		await this.waitForResumeAttempt(RESUME_WAIT_TIMEOUT_MS);

		try {
			const unlockAudio = document.createElement("audio");
			unlockAudio.setAttribute("playsinline", "playsinline");
			unlockAudio.preload = "auto";
			unlockAudio.volume = 0.0001;
			unlockAudio.src =
				"data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";

			const playPromise = unlockAudio.play();
			const cleanup = () => {
				unlockAudio.pause();
				unlockAudio.removeAttribute("src");
				unlockAudio.load();
			};

			if (playPromise && typeof playPromise.then === "function") {
				let timeoutId: ReturnType<typeof setTimeout> | null = null;
				const playAttempt = (playPromise as Promise<void>)
					.then(() => {})
					.catch(() => {});
				const timeoutPromise = new Promise<void>((resolve) => {
					timeoutId = setTimeout(resolve, RESUME_WAIT_TIMEOUT_MS);
				});

				await Promise.race([playAttempt, timeoutPromise]);

				if (timeoutId !== null) {
					clearTimeout(timeoutId);
				}

				cleanup();
			} else {
				cleanup();
			}
		} catch (_error) {
			// ignore
		}
	}

	async loadTracks(runtimes: TrackRuntime[]): Promise<void> {
		if (!this.canUseAudioGraph()) {
			runtimes.forEach((runtime) => {
				runtime.successful = false;
				runtime.errored = true;
			});
			return;
		}

		const audioElement = document.createElement("audio");

		const results = await Promise.all(
			runtimes.map(async (runtime) => {
				const result = await this.loadTrack(runtime, audioElement);
				return result;
			}),
		);

		results.forEach((result, index) => {
			runtimes[index].errored = !result.success;
			runtimes[index].successful = result.success;
		});
	}

	async estimateAudioDownloadSize(
		runtimes: TrackRuntime[],
	): Promise<AudioDownloadSizeInfo> {
		const sources = this.collectActivationSources(runtimes);
		if (sources.length === 0) {
			return {
				status: "unavailable",
				totalBytes: null,
				resolvedSourceCount: 0,
				totalSourceCount: 0,
			};
		}

		const probeResults = await Promise.all(
			sources.map(async (source) => this.requestSourceSize(source.src)),
		);
		let totalBytes = 0;
		let resolvedSourceCount = 0;

		probeResults.forEach((result) => {
			if (
				!Number.isFinite(result.bytes) ||
				result.bytes === null ||
				result.bytes < 0
			) {
				return;
			}

			totalBytes += result.bytes;
			resolvedSourceCount += 1;
		});

		if (resolvedSourceCount === 0) {
			return {
				status: "unavailable",
				totalBytes: null,
				resolvedSourceCount: 0,
				totalSourceCount: sources.length,
			};
		}

		return {
			status: resolvedSourceCount === sources.length ? "known" : "partial",
			totalBytes: totalBytes,
			resolvedSourceCount: resolvedSourceCount,
			totalSourceCount: sources.length,
		};
	}

	private async loadTrack(
		runtime: TrackRuntime,
		audioElement: HTMLAudioElement,
	): Promise<LoadTrackResult> {
		if (!this.context || !this.gainNodeMaster) {
			return {
				success: false,
				error: "Web Audio API unavailable",
			};
		}

		if (!runtime.gainNode) {
			runtime.gainNode = this.context.createGain();
		}

		this.configurePanningGraph(runtime);

		const baseSelectionResult = await this.loadSourceSelection(
			runtime.definition.sources || [],
			audioElement,
		);
		if (!baseSelectionResult.success || !baseSelectionResult.selection) {
			return {
				success: false,
				error: baseSelectionResult.error || "No playable source found",
			};
		}

		runtime.baseSource = {
			buffer: baseSelectionResult.selection.buffer,
			timing: baseSelectionResult.selection.timing,
			sourceIndex: baseSelectionResult.selection.sourceIndex,
			sourceSampleRate: baseSelectionResult.selection.sourceSampleRate,
			waveformSummary: null,
		};

		runtime.activeVariant = "base";
		runtime.buffer = runtime.baseSource.buffer;
		runtime.timing = runtime.baseSource.timing;
		runtime.sourceSampleRate = runtime.baseSource.sourceSampleRate;
		runtime.sourceIndex = runtime.baseSource.sourceIndex;
		runtime.waveformSummary = runtime.baseSource.waveformSummary;

		const alignmentSources = runtime.definition.syncedSources;
		const shouldLoadSyncedSources =
			this.alignmentEnabled &&
			Array.isArray(alignmentSources) &&
			alignmentSources.length > 0;

		if (shouldLoadSyncedSources) {
			const syncedSelectionResult = await this.loadSourceSelection(
				alignmentSources || [],
				audioElement,
			);
			if (!syncedSelectionResult.success || !syncedSelectionResult.selection) {
				return {
					success: false,
					error:
						syncedSelectionResult.error ||
						"No playable synchronized source found",
				};
			}

			runtime.syncedSource = {
				buffer: syncedSelectionResult.selection.buffer,
				timing: syncedSelectionResult.selection.timing,
				sourceIndex: syncedSelectionResult.selection.sourceIndex,
				sourceSampleRate: syncedSelectionResult.selection.sourceSampleRate,
				waveformSummary: null,
			};
		} else {
			runtime.syncedSource = null;
		}

		runtime.errored = false;
		runtime.successful = true;

		return {
			success: true,
			error: null,
		};
	}

	private async loadSourceSelection(
		sources: TrackSourceDefinition[],
		audioElement: HTMLAudioElement,
	): Promise<LoadSourceSelectionResult> {
		for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
			const source = sources[sourceIndex];
			if (!source?.src) {
				continue;
			}

			if (!isPlayableSource(source, audioElement)) {
				continue;
			}

			try {
				const arrayBuffer = await this.requestArrayBuffer(source.src);
				const decodedBuffer = await this.decodeAudioData(arrayBuffer);

				return {
					success: true,
					selection: {
						buffer: decodedBuffer,
						timing: calculateTrackTiming(source, decodedBuffer.duration),
						sourceIndex: sourceIndex,
						sourceSampleRate: readSourceSampleRate(arrayBuffer),
					},
					error: null,
				};
			} catch (_error) {}
		}

		return {
			success: false,
			selection: null,
			error: "No playable source found",
		};
	}

	private collectActivationSources(
		runtimes: TrackRuntime[],
	): TrackSourceDefinition[] {
		const collected: TrackSourceDefinition[] = [];

		runtimes.forEach((runtime) => {
			collected.push(
				...this.filterPlayableSources(runtime.definition.sources || []),
			);

			const alignmentSources = runtime.definition.syncedSources;
			const shouldLoadSyncedSources =
				this.alignmentEnabled &&
				Array.isArray(alignmentSources) &&
				alignmentSources.length > 0;

			if (shouldLoadSyncedSources) {
				collected.push(...this.filterPlayableSources(alignmentSources || []));
			}
		});

		return collected;
	}

	private filterPlayableSources(
		sources: TrackSourceDefinition[],
	): TrackSourceDefinition[] {
		const audioElement = document.createElement("audio");
		return sources.filter((source) => {
			if (!source?.src) {
				return false;
			}

			return isPlayableSource(source, audioElement);
		});
	}

	private requestSourceSize(url: string): Promise<AudioSourceSizeProbeResult> {
		return new Promise((resolve) => {
			const request = new XMLHttpRequest();
			request.open("HEAD", url, true);

			request.onreadystatechange = () => {
				if (request.readyState !== 4) {
					return;
				}

				if (request.status >= 200 && request.status < 300) {
					const rawLength = request.getResponseHeader("Content-Length");
					const parsedLength = rawLength === null ? NaN : Number(rawLength);
					if (Number.isFinite(parsedLength) && parsedLength >= 0) {
						resolve({ bytes: parsedLength });
						return;
					}
				}

				resolve({ bytes: null });
			};

			request.onerror = () => {
				resolve({ bytes: null });
			};

			try {
				request.send();
			} catch (_error) {
				resolve({ bytes: null });
			}
		});
	}

	private requestArrayBuffer(url: string): Promise<ArrayBuffer> {
		return new Promise((resolve, reject) => {
			const request = new XMLHttpRequest();
			request.open("GET", url, true);
			request.responseType = "arraybuffer";

			request.onreadystatechange = () => {
				if (request.readyState !== 4) {
					return;
				}

				if (request.status >= 200 && request.status < 300 && request.response) {
					resolve(request.response);
				} else {
					reject(new Error(`Failed to request audio source: ${url}`));
				}
			};

			request.onerror = () => {
				reject(
					new Error(`Network error while requesting audio source: ${url}`),
				);
			};

			request.send();
		});
	}

	private decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
		const context = this.context;
		if (!context) {
			return Promise.reject(new Error("AudioContext unavailable"));
		}

		return new Promise((resolve, reject) => {
			let settled = false;

			const onSuccess = (decoded: AudioBuffer) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(decoded);
			};

			const onFailure = (error: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				reject(
					error instanceof Error ? error : new Error("decodeAudioData failed"),
				);
			};

			try {
				const maybePromise = context.decodeAudioData(
					arrayBuffer.slice(0),
					onSuccess,
					onFailure,
				);
				if (
					maybePromise &&
					typeof (maybePromise as Promise<AudioBuffer>).then === "function"
				) {
					(maybePromise as Promise<AudioBuffer>)
						.then(onSuccess)
						.catch(onFailure);
				}
			} catch (error) {
				onFailure(error);
			}
		});
	}

	setMasterVolume(volume: number): void {
		if (!this.gainNodeVolume) {
			return;
		}

		const nextVolume = clamp01(volume);
		this.masterVolume = nextVolume;
		this.gainNodeVolume.gain.value = this.globalVolumeEnabled ? nextVolume : 1;
	}

	setGlobalVolumeEnabled(enabled: boolean): void {
		this.globalVolumeEnabled = enabled;
		if (this.gainNodeVolume) {
			this.gainNodeVolume.gain.value = enabled ? this.masterVolume : 1;
		}
	}

	setMasterPan(pan: number): void {
		this.masterPan = clampPan(pan);
		const effectivePan = this.globalPanEnabled ? this.masterPan : 0;

		if (this.masterPannerNode) {
			this.masterPannerNode.pan.value = effectivePan;
		} else if (this.masterPanGainLeftNode && this.masterPanGainRightNode) {
			const { gainL, gainR } = computeBalanceGains(effectivePan);
			this.masterPanGainLeftNode.gain.value = gainL;
			this.masterPanGainRightNode.gain.value = gainR;
		}
	}

	setGlobalPanEnabled(enabled: boolean, algorithm: TrackPanAlgorithm): void {
		if (
			this.globalPanEnabled === enabled &&
			this.globalPanAlgorithm === algorithm
		) {
			return;
		}

		this.globalPanEnabled = enabled;
		this.globalPanAlgorithm = algorithm;
		this.configureMasterPanningGraph();
		this.setMasterPan(this.masterPan);
	}

	/** `noSoloFallbackGates` says, per track, how loud it is while nothing is soloed. */
	applyTrackStateGains(
		runtimes: TrackRuntime[],
		noSoloFallbackGates?: number[],
	): void {
		const anySolos = runtimes.some((runtime) => runtime.state.solo);

		runtimes.forEach((runtime, index) => {
			if (!runtime.gainNode) {
				return;
			}

			const soloGate = anySolos
				? runtime.state.solo
					? 1
					: 0
				: clamp01(noSoloFallbackGates?.[index] ?? 0);
			runtime.gainNode.gain.value = soloGate * clamp01(runtime.state.volume);

			if (runtime.pannerNode) {
				runtime.pannerNode.pan.value = clampPan(runtime.state.pan);
			} else if (runtime.panGainLeftNode && runtime.panGainRightNode) {
				const { gainL, gainR } = computeBalanceGains(runtime.state.pan);
				runtime.panGainLeftNode.gain.value = gainL;
				runtime.panGainRightNode.gain.value = gainR;
			}
		});
	}

	private stopRuntimeSource(runtime: TrackRuntime, when: number): void {
		if (!runtime.activeSource) {
			return;
		}

		try {
			runtime.activeSource.stop(when);
		} catch (_error) {
			// ignore
		}

		runtime.activeSource = null;
	}

	start(
		runtimes: TrackRuntime[],
		position: number,
		snippetDuration?: number,
	): { startTime: number } | null {
		if (!this.context || !this.gainNodeMaster || !this.canUseAudioGraph()) {
			return null;
		}

		const context = this.context;
		const now = context.currentTime;
		const upwardRamp = 0.03;
		const downwardRamp = 0.03;

		if (snippetDuration !== undefined) {
			this.gainNodeMaster.gain.setValueAtTime(0.0, now + downwardRamp);
			this.gainNodeMaster.gain.linearRampToValueAtTime(
				1.0,
				now + downwardRamp + upwardRamp,
			);

			this.gainNodeMaster.gain.setValueAtTime(
				1.0,
				now + downwardRamp + upwardRamp,
			);
			this.gainNodeMaster.gain.linearRampToValueAtTime(
				0.0,
				now + downwardRamp + upwardRamp + snippetDuration,
			);
		} else {
			this.gainNodeMaster.gain.cancelScheduledValues(now);
			this.gainNodeMaster.gain.setValueAtTime(0.0, now);
			this.gainNodeMaster.gain.linearRampToValueAtTime(1.0, now + upwardRamp);
		}

		runtimes.forEach((runtime) => {
			this.stopRuntimeSource(runtime, now);

			if (!runtime.buffer || !runtime.gainNode) {
				return;
			}

			const buffer = runtime.buffer;
			const timing = runtime.timing || {
				trimStart: 0,
				padStart: 0,
				audioDuration: buffer.duration,
				effectiveDuration: buffer.duration,
			};

			if (timing.audioDuration <= 0) {
				return;
			}

			const positionInTrackTimeline = position - timing.padStart;
			let scheduleDelay = 0;
			let sourceOffset = timing.trimStart;
			let remainingAudioDuration = timing.audioDuration;

			if (positionInTrackTimeline < 0) {
				scheduleDelay = -positionInTrackTimeline;
			} else if (positionInTrackTimeline >= timing.audioDuration) {
				return;
			} else {
				sourceOffset = timing.trimStart + positionInTrackTimeline;
				remainingAudioDuration = timing.audioDuration - positionInTrackTimeline;
			}

			let startAt = now + scheduleDelay;
			let playDuration = remainingAudioDuration;

			if (snippetDuration !== undefined) {
				const snippetStart = now + downwardRamp;
				const snippetEnd = snippetStart + upwardRamp + snippetDuration;
				startAt = snippetStart + scheduleDelay;

				if (startAt >= snippetEnd) {
					return;
				}

				playDuration = Math.min(remainingAudioDuration, snippetEnd - startAt);
			}

			if (playDuration <= 0) {
				return;
			}

			const sourceNode = context.createBufferSource();
			sourceNode.buffer = buffer;
			sourceNode.connect(runtime.gainNode);
			sourceNode.start(startAt, sourceOffset, playDuration);
			runtime.activeSource = sourceNode;
		});

		return {
			startTime: now - position,
		};
	}

	stop(runtimes: TrackRuntime[]): void {
		if (!this.context || !this.gainNodeMaster || !this.canUseAudioGraph()) {
			runtimes.forEach((runtime) => {
				runtime.activeSource = null;
			});
			return;
		}

		const now = this.context.currentTime;
		const downwardRamp = 0.03;

		this.gainNodeMaster.gain.cancelScheduledValues(now);
		this.gainNodeMaster.gain.setValueAtTime(1.0, now);
		this.gainNodeMaster.gain.linearRampToValueAtTime(0.0, now + downwardRamp);

		runtimes.forEach((runtime) => {
			this.stopRuntimeSource(runtime, now + downwardRamp);
		});
	}

	disconnectRuntimes(runtimes: TrackRuntime[]): void {
		runtimes.forEach((runtime) => {
			try {
				runtime.activeSource?.disconnect();
			} catch (_error) {
				// ignore
			}
			try {
				runtime.gainNode?.disconnect();
			} catch (_error) {
				// ignore
			}
			[
				runtime.pannerNode,
				runtime.panUpmixNode,
				runtime.panSplitterNode,
				runtime.panGainLeftNode,
				runtime.panGainRightNode,
				runtime.panMergerNode,
			].forEach((node) => {
				try {
					node?.disconnect();
				} catch (_error) {
					// ignore
				}
			});

			runtime.activeSource = null;
			runtime.gainNode = null;
			runtime.pannerNode = null;
			runtime.panUpmixNode = null;
			runtime.panSplitterNode = null;
			runtime.panGainLeftNode = null;
			runtime.panGainRightNode = null;
			runtime.panMergerNode = null;
		});
	}

	disconnect(): void {
		this.gainNodeMaster?.disconnect();
		this.gainNodeVolume?.disconnect();
	}
}
