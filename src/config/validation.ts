export function toConfigRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid ' + label + ' configuration.');
    }

    return value as Record<string, unknown>;
}

export function assertAllowedKeys(
    target: Record<string, unknown>,
    allowedKeys: readonly string[],
    label: string
): void {
    const allowed = new Set(allowedKeys);
    Object.keys(target).forEach(function(key) {
        if (!allowed.has(key)) {
            throw new Error(
                'Invalid '
                + label
                + ' key: '
                + key
                + '. Allowed keys: '
                + allowedKeys.join(', ')
            );
        }
    });
}
