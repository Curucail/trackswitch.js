import assert from 'node:assert/strict';
import {
    applyGlobalSyncState,
    buildAlignmentContext,
    collectUniqueAlignmentColumns,
    getActiveAlignmentAxisKey,
    isGlobalSyncAvailable,
    mapAlignmentAxisTime,
    resolveReferenceDuration,
    resolveReferenceTimeColumn,
    resolveReferenceTimeColumnSync,
} from '../src/player/alignment-actions';
import { initializeSheetMusic } from '../src/player/playback-actions';

function createRuntime(column: string, options?: { synced?: boolean; solo?: boolean; duration?: number }) {
    const duration = options?.duration ?? 20;

    return {
        definition: {
            title: column,
            sources: [{ src: column + '.wav' }],
            alignment: {
                column: column,
                synchronizedSources: options?.synced ? [{ src: column + '_synced.wav' }] : undefined,
            },
        },
        state: {
            solo: Boolean(options?.solo),
            volume: 1,
            pan: 0,
        },
        gainNode: null,
        pannerNode: null,
        buffer: null,
        timing: null,
        activeSource: null,
        sourceIndex: 0,
        activeVariant: 'base',
        baseSource: {
            buffer: null,
            timing: {
                trimStart: 0,
                padStart: 0,
                audioDuration: duration,
                effectiveDuration: duration,
            },
            sourceIndex: 0,
        },
        syncedSource: options?.synced
            ? {
                buffer: { duration: duration } as any,
                timing: {
                    trimStart: 0,
                    padStart: 0,
                    audioDuration: duration,
                    effectiveDuration: duration,
                },
                sourceIndex: 1,
            }
            : null,
        successful: true,
        errored: false,
        waveformCache: new Map<string, Float32Array>(),
    } as any;
}

function createParsedCsv(includeSyncColumn = true) {
    const headers = includeSyncColumn
        ? ['score', 'sync', 'track_a', 'track_b', 'measure']
        : ['score', 'track_a', 'track_b', 'measure'];

    const rows = includeSyncColumn
        ? [
            { score: 0, sync: 0, track_a: 0, track_b: 0, measure: 1 },
            { score: 10, sync: 20, track_a: 8, track_b: 10, measure: 2 },
            { score: 20, sync: 40, track_a: 16, track_b: 20, measure: 3 },
        ]
        : [
            { score: 0, track_a: 0, track_b: 0, measure: 1 },
            { score: 10, track_a: 8, track_b: 10, measure: 2 },
            { score: 20, track_a: 16, track_b: 20, measure: 3 },
        ];

    return { headers, rows };
}

function createAlignmentController(parsedCsv: ReturnType<typeof createParsedCsv>, includeSyncConfig = true) {
    const controller: any = {
        alignmentConfig: {
            csv: 'alignment.csv',
            referenceTimeColumn: 'score',
            referenceTimeColumnSync: includeSyncConfig ? 'sync' : undefined,
            outOfRange: 'clamp',
        },
        runtimes: [
            createRuntime('track_a', { synced: true, solo: true, duration: 16 }),
            createRuntime('track_b', { synced: false, solo: false, duration: 20 }),
        ],
        globalSyncEnabled: false,
        effectiveSingleSoloMode: true,
        syncLockedTrackIndexes: new Set<number>(),
        preSyncSoloTrackIndex: null,
        longestDuration: 20,
        state: {
            playing: false,
            repeat: false,
            position: 10,
            startTime: 0,
            currentlySeeking: false,
            loop: {
                pointA: 5,
                pointB: 15,
                enabled: true,
            },
            volume: 1,
        },
        alignmentContext: null,
        resolveAlignmentMappingsByTrack() {
            return new Map<number, string>([
                [0, 'track_a'],
                [1, 'track_b'],
            ]);
        },
        resolveReferenceTimeColumn(config: any) {
            return resolveReferenceTimeColumn(this, config);
        },
        resolveReferenceTimeColumnSync(config: any) {
            return resolveReferenceTimeColumnSync(this, config);
        },
        resolveReferenceDuration(rows: Array<Record<string, number>>, referenceTimeColumn: string) {
            return resolveReferenceDuration(this, rows, referenceTimeColumn);
        },
        collectUniqueAlignmentColumns(mappingByTrack: Map<number, string>) {
            return collectUniqueAlignmentColumns(this, mappingByTrack);
        },
        async loadAlignmentCsv() {
            return parsedCsv;
        },
        isAlignmentMode() {
            return true;
        },
        hasSyncedVariant(runtime: any) {
            return Boolean(runtime.syncedSource && runtime.syncedSource.buffer);
        },
        getActiveSoloTrackIndex() {
            return this.runtimes.findIndex((runtime: any) => runtime.state.solo);
        },
        getActiveAlignmentAxisKey() {
            return getActiveAlignmentAxisKey(this);
        },
        isGlobalSyncAvailable() {
            return isGlobalSyncAvailable(this);
        },
        mapAlignmentAxisTime(time: number, fromAxisKey: 'base' | 'sync', toAxisKey: 'base' | 'sync') {
            return mapAlignmentAxisTime(this, time, fromAxisKey, toAxisKey);
        },
        currentPlaybackReferencePosition() {
            return this.state.position;
        },
        setRuntimeActiveVariant(runtime: any, variant: 'base' | 'synced') {
            runtime.activeVariant = variant;
            const source = variant === 'synced' ? runtime.syncedSource : runtime.baseSource;
            runtime.buffer = source?.buffer || null;
            runtime.timing = source?.timing || null;
            runtime.sourceIndex = source?.sourceIndex ?? -1;
            return true;
        },
        setEffectiveSoloMode(singleSoloMode: boolean) {
            this.effectiveSingleSoloMode = singleSoloMode;
        },
        applyTrackProperties() {
            this.applyTrackPropertiesCalls = (this.applyTrackPropertiesCalls || 0) + 1;
        },
        dispatch(action: any) {
            if (action.type === 'set-position') {
                this.state.position = action.position;
            }
            if (action.type === 'set-playing') {
                this.state.playing = action.playing;
            }
        },
        stopAudio() {
            this.stopAudioCalls = (this.stopAudioCalls || 0) + 1;
        },
        startAudio(position: number) {
            this.startAudioCalls = (this.startAudioCalls || 0) + 1;
            this.lastStartedPosition = position;
        },
        updateMainControls() {
            this.updateMainControlsCalls = (this.updateMainControlsCalls || 0) + 1;
        },
    };

    return controller;
}

const parsedCsv = createParsedCsv(true);
const controller = createAlignmentController(parsedCsv, true);
const alignmentContext = await buildAlignmentContext(controller);

assert.notEqual(typeof alignmentContext, 'string');
assert.ok(alignmentContext.baseAxis);
assert.ok(alignmentContext.syncAxis);
assert.equal(alignmentContext.baseAxis.referenceDuration, 20);
assert.equal(alignmentContext.syncAxis?.referenceDuration, 40);
assert.equal(mapAlignmentAxisTime({ ...controller, alignmentContext }, 10, 'base', 'sync'), 20);
assert.equal(mapAlignmentAxisTime({ ...controller, alignmentContext }, 20, 'sync', 'base'), 10);

controller.alignmentContext = alignmentContext;
assert.equal(controller.isGlobalSyncAvailable(), true);

applyGlobalSyncState(controller, true);
assert.equal(controller.globalSyncEnabled, true);
assert.equal(controller.state.position, 20);
assert.equal(controller.state.loop.pointA, 10);
assert.equal(controller.state.loop.pointB, 30);
assert.equal(controller.longestDuration, 40);
assert.equal(controller.runtimes[0].activeVariant, 'synced');
assert.equal(controller.runtimes[0].state.solo, true);
assert.equal(controller.runtimes[1].activeVariant, 'base');
assert.equal(controller.runtimes[1].state.solo, false);
assert.deepEqual(Array.from(controller.syncLockedTrackIndexes), [1]);

applyGlobalSyncState(controller, false);
assert.equal(controller.globalSyncEnabled, false);
assert.equal(controller.state.position, 10);
assert.equal(controller.state.loop.pointA, 5);
assert.equal(controller.state.loop.pointB, 15);
assert.equal(controller.longestDuration, 20);
assert.equal(controller.runtimes[0].activeVariant, 'base');
assert.equal(controller.runtimes[0].state.solo, true);
assert.equal(controller.runtimes[1].state.solo, false);
assert.deepEqual(Array.from(controller.syncLockedTrackIndexes), []);

const parsedCsvWithoutSync = createParsedCsv(false);
const controllerWithoutSync = createAlignmentController(parsedCsvWithoutSync, true);
const alignmentContextWithoutSync = await buildAlignmentContext(controllerWithoutSync);

assert.notEqual(typeof alignmentContextWithoutSync, 'string');
assert.equal(alignmentContextWithoutSync.syncAxis, null);
controllerWithoutSync.alignmentContext = alignmentContextWithoutSync;
assert.equal(controllerWithoutSync.isGlobalSyncAvailable(), false);

let capturedHosts: any[] | null = null;
let lastSheetMusicUpdate: { position: number; syncReferenceTimeEnabled: boolean } | null = null;
const sheetMusicController: any = {
    renderer: {
        getPreparedSheetMusicHosts() {
            return [{
                host: {} as HTMLElement,
                scrollContainer: null,
                source: 'score.musicxml',
                measureColumn: 'measure',
                renderScale: null,
                followPlayback: true,
                cursorColor: '#999999',
                cursorAlpha: 0.1,
            }];
        },
    },
    alignmentConfig: controller.alignmentConfig,
    async loadAlignmentCsv() {
        return parsedCsv;
    },
    resolveReferenceTimeColumn(config: any) {
        return resolveReferenceTimeColumn(this, config);
    },
    resolveReferenceTimeColumnSync(config: any) {
        return resolveReferenceTimeColumnSync(this, config);
    },
    isSyncReferenceAxisActive() {
        return true;
    },
    state: {
        position: 20,
    },
    sheetMusicEngine: {
        async initialize(hosts: any[]) {
            capturedHosts = hosts;
        },
        updatePosition(position: number, syncReferenceTimeEnabled: boolean) {
            lastSheetMusicUpdate = {
                position,
                syncReferenceTimeEnabled,
            };
        },
        destroy() {
            capturedHosts = [];
        },
    },
};

await initializeSheetMusic(sheetMusicController);

assert.ok(capturedHosts);
assert.equal(capturedHosts?.length, 1);
const builtMeasureMaps = await capturedHosts?.[0].measureMapsPromise;
assert.deepEqual(builtMeasureMaps?.base, [
    { start: 0, measure: 1 },
    { start: 10, measure: 2 },
    { start: 20, measure: 3 },
]);
assert.deepEqual(builtMeasureMaps?.sync, [
    { start: 0, measure: 1 },
    { start: 20, measure: 2 },
    { start: 40, measure: 3 },
]);
assert.deepEqual(lastSheetMusicUpdate, {
    position: 20,
    syncReferenceTimeEnabled: true,
});
