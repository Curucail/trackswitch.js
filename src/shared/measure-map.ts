import { parseCsvRecords, requestText } from './csv';

export interface MeasureMapPoint {
    start: number;
    measure: number;
}

export function loadMeasureMapCsv(url: string): Promise<MeasureMapPoint[]> {
    return requestText(url, 'measure map CSV source').then(function(text) {
        return parseMeasureMapCsv(text);
    });
}

export function parseMeasureMapCsv(csvText: string): MeasureMapPoint[] {
    const parsed = parseCsvRecords(csvText, {
        emptyDataError: 'Measure map CSV must include a header and at least one data row.',
        transformHeader: function(header) {
            return String(header ?? '').trim().toLowerCase();
        },
    });

    if (parsed.headers.indexOf('start') < 0 || parsed.headers.indexOf('measure') < 0) {
        throw new Error('Measure map CSV header must include "start" and "measure" columns.');
    }

    const points: MeasureMapPoint[] = [];

    for (let lineIndex = 0; lineIndex < parsed.rows.length; lineIndex += 1) {
        const sourceRow = parsed.rows[lineIndex] || {};
        const start = Number(sourceRow.start);
        const measure = Number(sourceRow.measure);
        if (!Number.isFinite(start) || !Number.isFinite(measure)) {
            continue;
        }

        points.push({
            start: start,
            measure: measure,
        });
    }

    if (points.length === 0) {
        throw new Error('Measure map CSV does not contain valid numeric rows.');
    }

    points.sort(function(a, b) {
        if (a.start === b.start) {
            return a.measure - b.measure;
        }
        return a.start - b.start;
    });

    return points;
}
