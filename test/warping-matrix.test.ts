import assert from 'node:assert/strict';
import { buildWarpingTempoData, interpolateWarpingTrackTime } from '../src/ui/render-warping-matrix';

function createTempoData(referenceDuration: number, trackDuration: number) {
    const points = [
        { referenceTime: 0, trackTime: 0 },
        { referenceTime: referenceDuration, trackTime: trackDuration },
    ];

    return buildWarpingTempoData(
        {
            interpolateWarpingTrackTime(innerPoints: typeof points, referenceTime: number): number {
                return interpolateWarpingTrackTime(this, innerPoints, referenceTime);
            },
        },
        {
            byColumn: new Map([
                [
                    'performance',
                    {
                        pointsByReferenceTime: points,
                        pointsByTrackTime: points,
                        trackDuration: trackDuration,
                    },
                ],
            ]),
        },
        5
    );
}

const fasterThanReference = createTempoData(2, 1).byColumn.get('performance');
assert.ok(fasterThanReference);
assert.equal(fasterThanReference.isStrictlyMonotonic, true);
assert.equal(fasterThanReference.points.length, 2);
assert.ok(fasterThanReference.points.every((point) => point.tempoPercent === 200));

const slowerThanReference = createTempoData(1, 2).byColumn.get('performance');
assert.ok(slowerThanReference);
assert.equal(slowerThanReference.isStrictlyMonotonic, true);
assert.equal(slowerThanReference.points.length, 2);
assert.ok(slowerThanReference.points.every((point) => point.tempoPercent === 50));

function createQuantizedTempoData(): ReturnType<typeof buildWarpingTempoData> {
    const points: Array<{ referenceTime: number; trackTime: number }> = [];
    for (let index = 0; index <= 250; index += 1) {
        const referenceTime = index * 0.08;
        const exactTrackTime = referenceTime / 1.6;
        const quantizedTrackTime = Math.round(exactTrackTime / 0.02) * 0.02;
        points.push({
            referenceTime: referenceTime,
            trackTime: quantizedTrackTime,
        });
    }

    return buildWarpingTempoData(
        {
            interpolateWarpingTrackTime(innerPoints: typeof points, referenceTime: number): number {
                return interpolateWarpingTrackTime(this, innerPoints, referenceTime);
            },
        },
        {
            byColumn: new Map([
                [
                    'performance',
                    {
                        pointsByReferenceTime: points,
                        pointsByTrackTime: points,
                        trackDuration: points[points.length - 1].trackTime,
                    },
                ],
            ]),
        },
        5
    );
}

const quantizedPerformance = createQuantizedTempoData().byColumn.get('performance');
assert.ok(quantizedPerformance);
assert.equal(quantizedPerformance.isStrictlyMonotonic, true);
assert.ok(quantizedPerformance.points.length > 0);

const quantizedTempoValues = quantizedPerformance.points.map((point) => point.tempoPercent);
const quantizedTempoMean = quantizedTempoValues.reduce((sum, value) => sum + value, 0) / quantizedTempoValues.length;
const quantizedTempoMax = Math.max(...quantizedTempoValues);

assert.ok(Math.abs(quantizedTempoMean - 160) < 2);
assert.ok(quantizedTempoMax < 165);
