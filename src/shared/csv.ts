import Papa from 'papaparse';

export interface ParsedCsvRecords {
    headers: string[];
    rows: Record<string, unknown>[];
}

interface ParseCsvRecordsOptions {
    emptyDataError: string;
    transformHeader?(header: string): string;
}

export function requestText(url: string, sourceLabel: string): Promise<string> {
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
                reject(new Error('Failed to request ' + sourceLabel + ': ' + url));
            }
        };

        request.onerror = function() {
            reject(new Error('Network error while requesting ' + sourceLabel + ': ' + url));
        };

        request.send();
    });
}

export function parseCsvRecords(csvText: string, options: ParseCsvRecordsOptions): ParsedCsvRecords {
    const normalizedText = String(csvText || '').replace(/^\uFEFF/, '');
    const parsed = Papa.parse<Record<string, unknown>>(normalizedText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: 'greedy',
        transformHeader: options.transformHeader,
    });

    if (parsed.errors.length > 0) {
        throw new Error(formatPapaErrors(parsed.errors));
    }

    const headers = Array.isArray(parsed.meta.fields)
        ? parsed.meta.fields.map(function(field) {
            return String(field ?? '').trim();
        }).filter(function(field) {
            return field.length > 0;
        })
        : [];

    if (headers.length === 0 || parsed.data.length === 0) {
        throw new Error(options.emptyDataError);
    }

    return {
        headers: headers,
        rows: parsed.data,
    };
}

function formatPapaErrors(errors: Array<{ message: string; row?: number }>): string {
    return errors.map(function(error) {
        const rowSuffix = typeof error.row === 'number' ? ' (row ' + error.row + ')' : '';
        return error.message + rowSuffix;
    }).join('; ');
}
