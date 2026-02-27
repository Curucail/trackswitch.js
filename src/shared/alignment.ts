import { AlignmentOutOfRangeMode } from '../domain/types';

type AlignmentTempoInterpolationMode = 'step' | 'linear';

export interface CsvNumericRow {
    [column: string]: number;
}

export interface ParsedNumericCsv {
    headers: string[];
    rows: CsvNumericRow[];
}

export interface TimeMappingPoint {
    x: number;
    y: number;
}

export interface TimeMappingSeries {
    points: TimeMappingPoint[];
}

export function loadNumericCsv(url: string): Promise<ParsedNumericCsv> {
    return requestText(url).then(function(text) {
        return parseNumericCsv(text);
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
                reject(new Error('Failed to request CSV source: ' + url));
            }
        };

        request.onerror = function() {
            reject(new Error('Network error while requesting CSV source: ' + url));
        };

        request.send();
    });
}

export function parseNumericCsv(csvText: string): ParsedNumericCsv {
    const normalizedText = String(csvText || '').replace(/^\uFEFF/, '');
    const lines = normalizedText.split(/\r?\n/).map(function(line) {
        return line.trim();
    }).filter(function(line) {
        return line.length > 0;
    });

    if (lines.length < 2) {
        throw new Error('Alignment CSV must include a header and at least one data row.');
    }

    const headers = splitCsvLine(lines[0]).map(function(header) {
        return header.trim();
    });

    if (headers.length === 0 || headers.some(function(header) { return !header; })) {
        throw new Error('Alignment CSV contains an invalid header row.');
    }

    const duplicateHeader = headers.find(function(header, index) {
        return headers.indexOf(header) !== index;
    });
    if (duplicateHeader) {
        throw new Error('Alignment CSV contains duplicate header: ' + duplicateHeader);
    }

    const rows: CsvNumericRow[] = [];

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
        const cells = splitCsvLine(lines[lineIndex]);
        if (cells.length !== headers.length) {
            continue;
        }

        const row: CsvNumericRow = {};
        let validRow = true;

        for (let cellIndex = 0; cellIndex < headers.length; cellIndex += 1) {
            const parsed = Number(cells[cellIndex].trim());
            if (!Number.isFinite(parsed)) {
                validRow = false;
                break;
            }
            row[headers[cellIndex]] = parsed;
        }

        if (validRow) {
            rows.push(row);
        }
    }

    if (rows.length === 0) {
        throw new Error('Alignment CSV does not contain valid numeric rows.');
    }

    return {
        headers: headers,
        rows: rows,
    };
}

function splitCsvLine(line: string): string[] {
    // Alignment tables are expected to be simple numeric CSV without quoted commas.
    return line.split(',');
}

export function createTimeMappingSeries(points: TimeMappingPoint[]): TimeMappingSeries {
    if (!Array.isArray(points) || points.length === 0) {
        throw new Error('Time mapping series requires at least one point.');
    }

    const normalized = points
        .map(function(point) {
            return {
                x: Number(point.x),
                y: Number(point.y),
            };
        })
        .filter(function(point) {
            return Number.isFinite(point.x) && Number.isFinite(point.y);
        });

    if (normalized.length === 0) {
        throw new Error('Time mapping series requires finite numeric points.');
    }

    normalized.sort(function(a, b) {
        if (a.x === b.x) {
            return a.y - b.y;
        }
        return a.x - b.x;
    });

    return {
        points: normalized,
    };
}

export function buildColumnTimeMapping(
    rows: CsvNumericRow[],
    fromColumn: string,
    toColumn: string
): TimeMappingSeries {
    const points: TimeMappingPoint[] = [];

    rows.forEach(function(row) {
        const x = Number(row[fromColumn]);
        const y = Number(row[toColumn]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return;
        }

        points.push({ x: x, y: y });
    });

    if (points.length === 0) {
        throw new Error('Alignment CSV does not contain valid mapping points for columns ' + fromColumn + ' -> ' + toColumn + '.');
    }

    return createTimeMappingSeries(points);
}

export function resolveAlignmentOutOfRangeMode(mode: AlignmentOutOfRangeMode | undefined): AlignmentOutOfRangeMode {
    return mode === 'linear' ? 'linear' : 'clamp';
}

export function resolveAlignmentTempoInterpolationMode(
    mode: AlignmentTempoInterpolationMode | undefined
): AlignmentTempoInterpolationMode {
    return mode === 'linear' ? 'linear' : 'step';
}

export function mapTime(
    series: TimeMappingSeries,
    time: number,
    outOfRange: AlignmentOutOfRangeMode
): number {
    const points = series.points;
    if (points.length === 0 || !Number.isFinite(time)) {
        return 0;
    }

    if (points.length === 1) {
        return points[0].y;
    }

    const first = points[0];
    const last = points[points.length - 1];

    if (time <= first.x) {
        if (outOfRange === 'clamp') {
            return first.y;
        }
        return extrapolateFromStart(points, time);
    }

    if (time >= last.x) {
        if (outOfRange === 'clamp') {
            return last.y;
        }
        return extrapolateFromEnd(points, time);
    }

    const rightIndex = firstIndexGreaterOrEqual(points, time);
    if (rightIndex <= 0) {
        return points[0].y;
    }

    if (points[rightIndex].x === time) {
        return averageExactMatch(points, rightIndex, time);
    }

    const left = points[rightIndex - 1];
    const right = points[rightIndex];

    return interpolate(left, right, time);
}

export function mapTimeSlope(
    series: TimeMappingSeries,
    time: number,
    outOfRange: AlignmentOutOfRangeMode,
    interpolationMode: AlignmentTempoInterpolationMode = 'step'
): number {
    const points = collapsePointsByX(series.points);
    if (points.length < 2 || !Number.isFinite(time)) {
        return 1;
    }

    if (interpolationMode === 'linear') {
        return mapTimeSlopeLinear(points, time, outOfRange);
    }

    return mapTimeSlopeStep(points, time, outOfRange);
}

function mapTimeSlopeStep(
    points: TimeMappingPoint[],
    time: number,
    outOfRange: AlignmentOutOfRangeMode
): number {
    const first = points[0];
    const last = points[points.length - 1];

    if (time < first.x) {
        if (outOfRange === 'clamp') {
            return 0;
        }
        return slope(points[0], points[1]);
    }

    if (time > last.x) {
        if (outOfRange === 'clamp') {
            return 0;
        }
        return slope(points[points.length - 2], points[points.length - 1]);
    }

    const rightIndex = firstIndexGreaterOrEqual(points, time);
    if (rightIndex <= 0) {
        return slope(points[0], points[1]);
    }

    const left = points[rightIndex - 1];
    const right = points[rightIndex];
    return slope(left, right);
}

function mapTimeSlopeLinear(
    points: TimeMappingPoint[],
    time: number,
    outOfRange: AlignmentOutOfRangeMode
): number {
    const first = points[0];
    const last = points[points.length - 1];
    const segmentSlopes: number[] = [];

    for (let index = 0; index < points.length - 1; index += 1) {
        segmentSlopes.push(slope(points[index], points[index + 1]));
    }

    const knotSlopes = buildKnotSlopes(points, segmentSlopes);

    if (time < first.x) {
        return outOfRange === 'clamp' ? 0 : knotSlopes[0];
    }

    if (time > last.x) {
        return outOfRange === 'clamp' ? 0 : knotSlopes[knotSlopes.length - 1];
    }

    const rightIndex = firstIndexGreaterOrEqual(points, time);
    if (rightIndex <= 0) {
        return knotSlopes[0];
    }

    if (points[rightIndex].x === time) {
        return knotSlopes[rightIndex];
    }

    const leftIndex = rightIndex - 1;
    const leftPoint = points[leftIndex];
    const rightPoint = points[rightIndex];
    const span = rightPoint.x - leftPoint.x;

    if (span <= 0) {
        return knotSlopes[leftIndex];
    }

    const t = (time - leftPoint.x) / span;
    return knotSlopes[leftIndex] + t * (knotSlopes[rightIndex] - knotSlopes[leftIndex]);
}

function buildKnotSlopes(points: TimeMappingPoint[], segmentSlopes: number[]): number[] {
    if (segmentSlopes.length === 0) {
        return [1];
    }

    const knotSlopes: number[] = [];
    knotSlopes.push(segmentSlopes[0]);

    for (let index = 1; index < points.length - 1; index += 1) {
        const leftSlope = segmentSlopes[index - 1];
        const rightSlope = segmentSlopes[index];
        const leftSpan = points[index].x - points[index - 1].x;
        const rightSpan = points[index + 1].x - points[index].x;

        if (leftSpan > 0 && rightSpan > 0) {
            knotSlopes.push(
                (leftSlope * rightSpan + rightSlope * leftSpan) / (leftSpan + rightSpan)
            );
        } else {
            knotSlopes.push((leftSlope + rightSlope) / 2);
        }
    }

    knotSlopes.push(segmentSlopes[segmentSlopes.length - 1]);
    return knotSlopes;
}

function collapsePointsByX(points: TimeMappingPoint[]): TimeMappingPoint[] {
    if (points.length <= 1) {
        return points.slice();
    }

    const collapsed: TimeMappingPoint[] = [];
    let activeX = points[0].x;
    let sumY = points[0].y;
    let count = 1;

    for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        if (point.x === activeX) {
            sumY += point.y;
            count += 1;
            continue;
        }

        collapsed.push({
            x: activeX,
            y: sumY / count,
        });

        activeX = point.x;
        sumY = point.y;
        count = 1;
    }

    collapsed.push({
        x: activeX,
        y: sumY / count,
    });

    return collapsed;
}

function firstIndexGreaterOrEqual(points: TimeMappingPoint[], value: number): number {
    let low = 0;
    let high = points.length - 1;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (points[mid].x < value) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
}

function averageExactMatch(points: TimeMappingPoint[], index: number, x: number): number {
    let start = index;
    let end = index;

    while (start > 0 && points[start - 1].x === x) {
        start -= 1;
    }

    while (end < points.length - 1 && points[end + 1].x === x) {
        end += 1;
    }

    return (points[start].y + points[end].y) / 2;
}

function extrapolateFromStart(points: TimeMappingPoint[], time: number): number {
    const first = points[0];
    const next = findDistinct(points, 0, 1);
    if (!next) {
        return first.y;
    }

    return interpolate(first, next, time);
}

function extrapolateFromEnd(points: TimeMappingPoint[], time: number): number {
    const last = points[points.length - 1];
    const previous = findDistinct(points, points.length - 1, -1);
    if (!previous) {
        return last.y;
    }

    return interpolate(previous, last, time);
}

function findDistinct(points: TimeMappingPoint[], startIndex: number, direction: 1 | -1): TimeMappingPoint | null {
    const anchor = points[startIndex];
    let index = startIndex + direction;

    while (index >= 0 && index < points.length) {
        const candidate = points[index];
        if (candidate.x !== anchor.x) {
            return candidate;
        }
        index += direction;
    }

    return null;
}

function interpolate(a: TimeMappingPoint, b: TimeMappingPoint, x: number): number {
    const deltaX = b.x - a.x;
    if (deltaX === 0) {
        return (a.y + b.y) / 2;
    }

    const t = (x - a.x) / deltaX;
    return a.y + t * (b.y - a.y);
}

function slope(a: TimeMappingPoint, b: TimeMappingPoint): number {
    const deltaX = b.x - a.x;
    if (deltaX === 0) {
        return 1;
    }

    return (b.y - a.y) / deltaX;
}
