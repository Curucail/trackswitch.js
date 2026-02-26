export function sanitizeInlineStyle(styleValue: unknown): string {
    const style = typeof styleValue === 'string' ? styleValue.trim() : '';
    if (!style) {
        return '';
    }

    return style
        .replace(/url\s*\(/gi, '')
        .replace(/[<>]/g, '');
}

export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function eventTargetAsElement(target: EventTarget | null | undefined): Element | null {
    if (!target || typeof target !== 'object') {
        return null;
    }

    const candidate = target as { nodeType?: unknown };
    return candidate.nodeType === 1 ? target as Element : null;
}
