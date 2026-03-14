import assert from 'node:assert/strict';
import { buildMeasureMapFromColumns } from '../src/shared/measure-map';

const rows = [
    { ref: 1, measure: 2, same: 1 },
    { ref: 0, measure: 1, same: 0 },
    { ref: 2, measure: Number.NaN, same: 2 },
    { ref: Number.NaN, measure: 5, same: 3 },
];

assert.deepEqual(
    buildMeasureMapFromColumns(rows, ['ref', 'measure', 'same'], 'ref', 'measure'),
    [
        { start: 0, measure: 1 },
        { start: 1, measure: 2 },
    ]
);

assert.deepEqual(
    buildMeasureMapFromColumns(rows, ['ref', 'measure', 'same'], 'ref', 'same'),
    [
        { start: 0, measure: 0 },
        { start: 1, measure: 1 },
        { start: 2, measure: 2 },
    ]
);

assert.throws(
    () => buildMeasureMapFromColumns(rows, ['measure'], 'ref', 'measure'),
    /missing configured referenceTimeColumn: ref/
);

assert.throws(
    () => buildMeasureMapFromColumns(rows, ['ref'], 'ref', 'measure'),
    /missing configured measureColumn: measure/
);

assert.throws(
    () => buildMeasureMapFromColumns([{ ref: Number.NaN, measure: Number.NaN }], ['ref', 'measure'], 'ref', 'measure'),
    /does not contain valid measure-map rows/
);
