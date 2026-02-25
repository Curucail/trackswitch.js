export function requireJQuery(): JQueryStatic {
    const maybeJQuery = (globalThis as unknown as { jQuery?: JQueryStatic; $?: JQueryStatic }).jQuery
        || (globalThis as unknown as { $?: JQueryStatic }).$;

    if (!maybeJQuery) {
        throw new Error('trackswitch.js requires jQuery to be present on globalThis.$ or globalThis.jQuery');
    }

    return maybeJQuery;
}
