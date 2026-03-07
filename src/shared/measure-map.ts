import Papa from 'papaparse';

export interface MeasureMapPoint {
    start: number;
    measure: number;
}

export function loadMeasureMapCsv(url: string): Promise<MeasureMapPoint[]> {
    return requestText(url).then(function(text) {
        return parseMeasureMapCsv(text);
    });
}

function requestText(url: string): Promise<string> {
    return new Promise(function(resolve, reject) {
        const request = new XMLHttpRequest();
        request.open('GET', url, true);

        request.onreadystatechange = function() {
            if (request.readyState !== 4) {
                return;
            }

            if (request.status >= 200 && request.status < 300) {
                resolve(String(request.responseText ?? request.response ?? ''));
            } else {
                reject(new Error('Failed to request measure map CSV source: ' + url));
            }
        };

        request.onerror = function() {
            reject(new Error('Network error while requesting measure map CSV source: ' + url));
        };

        request.send();
    });
}

export function parseMeasureMapCsv(csvText: string): MeasureMapPoint[] {
    const normalizedText = String(csvText || '').replace(/^\uFEFF/, '');
    const parsed = Papa.parse<Record<string, unknown>>(normalizedText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: 'greedy',
        transformHeader: function(header) {
            return String(header ?? '').trim().toLowerCase();
        },
    });

    if (parsed.errors.length > 0) {
        const papaErrors = parsed.errors.map(function(error) {
            const rowSuffix = typeof error.row === 'number' ? ' (row ' + error.row + ')' : '';
            return error.message + rowSuffix;
        }).join('; ');
        throw new Error(papaErrors);
    }

    const headers = Array.isArray(parsed.meta.fields)
        ? parsed.meta.fields.map(function(field) {
            return String(field ?? '').trim().toLowerCase();
        }).filter(function(field) {
            return field.length > 0;
        })
        : [];

    if (headers.length === 0 || parsed.data.length === 0) {
        throw new Error('Measure map CSV must include a header and at least one data row.');
    }

    if (headers.indexOf('start') < 0 || headers.indexOf('measure') < 0) {
        throw new Error('Measure map CSV header must include "start" and "measure" columns.');
    }

    const points: MeasureMapPoint[] = [];

    for (let lineIndex = 0; lineIndex < parsed.data.length; lineIndex += 1) {
        const sourceRow = parsed.data[lineIndex] || {};
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
