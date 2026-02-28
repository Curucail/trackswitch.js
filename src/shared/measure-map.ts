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
    const lines = normalizedText.split(/\r?\n/).map(function(line) {
        return line.trim();
    }).filter(function(line) {
        return line.length > 0;
    });

    if (lines.length < 2) {
        throw new Error('Measure map CSV must include a header and at least one data row.');
    }

    const delimiter = detectDelimiter(lines[0]);
    const headers = splitLine(lines[0], delimiter).map(function(header) {
        return header.trim().toLowerCase();
    });

    const startIndex = headers.indexOf('start');
    const measureIndex = headers.indexOf('measure');

    if (startIndex < 0 || measureIndex < 0) {
        throw new Error('Measure map CSV header must include "start" and "measure" columns.');
    }

    const points: MeasureMapPoint[] = [];

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
        const cells = splitLine(lines[lineIndex], delimiter);
        if (cells.length !== headers.length) {
            continue;
        }

        const start = Number(cells[startIndex].trim());
        const measure = Number(cells[measureIndex].trim());
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

function detectDelimiter(headerLine: string): ';' | ',' {
    const semicolonCount = (headerLine.match(/;/g) || []).length;
    const commaCount = (headerLine.match(/,/g) || []).length;

    if (semicolonCount === 0 && commaCount === 0) {
        throw new Error('Measure map CSV header must use ";" or "," as delimiter.');
    }

    return semicolonCount >= commaCount ? ';' : ',';
}

function splitLine(line: string, delimiter: ';' | ','): string[] {
    // Measure map files are expected to be simple numeric CSV without quoted delimiters.
    return line.split(delimiter);
}
