import type { TrackSwitchMountOptions, TrackSwitchShadowDomOptions } from '../domain/types';

const managedShadowRoots = new WeakMap<HTMLElement, ShadowRoot>();
const managedShadowModes = new WeakMap<HTMLElement, 'open' | 'closed'>();

interface NormalizedShadowDomOptions {
    mode: 'open' | 'closed';
    delegatesFocus: boolean;
    stylesheetHrefs: string[];
}

export interface PreparedTrackSwitchMount {
    mountRoot: HTMLElement;
    cleanup(): void;
}

function normalizeStylesheetHrefs(stylesheetHref: TrackSwitchShadowDomOptions['stylesheetHref']): string[] {
    if (typeof stylesheetHref === 'string') {
        const trimmedHref = stylesheetHref.trim();
        return trimmedHref ? [trimmedHref] : [];
    }

    if (!Array.isArray(stylesheetHref)) {
        return [];
    }

    return stylesheetHref
        .map(function(href) {
            return typeof href === 'string' ? href.trim() : '';
        })
        .filter(function(href) {
            return href.length > 0;
        });
}

function normalizeShadowDomOptions(
    shadowDom: TrackSwitchMountOptions['shadowDom']
): NormalizedShadowDomOptions | null {
    if (!shadowDom) {
        return null;
    }

    if (shadowDom === true) {
        return {
            mode: 'open',
            delegatesFocus: false,
            stylesheetHrefs: [],
        };
    }

    return {
        mode: shadowDom.mode === 'closed' ? 'closed' : 'open',
        delegatesFocus: shadowDom.delegatesFocus === true,
        stylesheetHrefs: normalizeStylesheetHrefs(shadowDom.stylesheetHref),
    };
}

function isTrackSwitchStylesheetLink(link: HTMLLinkElement): boolean {
    const href = link.getAttribute('href') || '';
    return /(?:^|\/)trackswitch(?:\.min)?\.css(?:[?#].*)?$/i.test(href)
        || /(?:^|\/)style\.css(?:[?#].*)?$/i.test(href)
        || href.toLowerCase().includes('trackswitch');
}

function cloneAutoDetectedStylesheets(ownerDocument: Document): HTMLLinkElement[] {
    return Array.from(ownerDocument.querySelectorAll('link[rel~="stylesheet"][href]'))
        .filter(function(link): link is HTMLLinkElement {
            return link instanceof HTMLLinkElement && isTrackSwitchStylesheetLink(link);
        })
        .map(function(link) {
            const clone = ownerDocument.createElement('link');
            clone.rel = 'stylesheet';
            clone.href = link.href;
            if (link.media) {
                clone.media = link.media;
            }
            if (link.crossOrigin) {
                clone.crossOrigin = link.crossOrigin;
            }
            if (link.referrerPolicy) {
                clone.referrerPolicy = link.referrerPolicy;
            }
            if (link.disabled) {
                clone.disabled = true;
            }
            return clone;
        });
}

function createExplicitStylesheetLinks(
    ownerDocument: Document,
    stylesheetHrefs: string[]
): HTMLLinkElement[] {
    return stylesheetHrefs.map(function(href) {
        const link = ownerDocument.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        return link;
    });
}

function resolveShadowRoot(
    hostElement: HTMLElement,
    shadowDomOptions: NormalizedShadowDomOptions
): ShadowRoot {
    const trackedShadowRoot = managedShadowRoots.get(hostElement) || null;
    const openShadowRoot = hostElement.shadowRoot;

    if (openShadowRoot && trackedShadowRoot && openShadowRoot !== trackedShadowRoot) {
        throw new Error('TrackSwitch shadow root tracking is inconsistent for this host element.');
    }

    if (openShadowRoot && !trackedShadowRoot) {
        throw new Error('Cannot mount TrackSwitch into a host with an unmanaged shadow root.');
    }

    const existingShadowRoot = trackedShadowRoot || openShadowRoot;
    if (existingShadowRoot) {
        const trackedMode = managedShadowModes.get(hostElement);
        if (trackedMode && trackedMode !== shadowDomOptions.mode) {
            throw new Error('Cannot reuse a TrackSwitch shadow root with a different mode.');
        }
        return existingShadowRoot;
    }

    try {
        const shadowRoot = hostElement.attachShadow({
            mode: shadowDomOptions.mode,
            delegatesFocus: shadowDomOptions.delegatesFocus,
        });
        managedShadowRoots.set(hostElement, shadowRoot);
        managedShadowModes.set(hostElement, shadowDomOptions.mode);
        return shadowRoot;
    } catch (error) {
        throw new Error(
            'Failed to create a TrackSwitch shadow root. The host may already own a shadow root or not support Shadow DOM.'
            + (error instanceof Error && error.message ? ' ' + error.message : '')
        );
    }
}

export function prepareTrackSwitchMount(
    hostElement: HTMLElement,
    mountOptions?: TrackSwitchMountOptions
): PreparedTrackSwitchMount {
    const shadowDomOptions = normalizeShadowDomOptions(mountOptions?.shadowDom);
    if (!shadowDomOptions) {
        return {
            mountRoot: hostElement,
            cleanup: function() {
                return;
            },
        };
    }

    const ownerDocument = hostElement.ownerDocument;
    const shadowRoot = resolveShadowRoot(hostElement, shadowDomOptions);
    shadowRoot.replaceChildren();

    const stylesheetLinks = shadowDomOptions.stylesheetHrefs.length > 0
        ? createExplicitStylesheetLinks(ownerDocument, shadowDomOptions.stylesheetHrefs)
        : cloneAutoDetectedStylesheets(ownerDocument);

    stylesheetLinks.forEach(function(link) {
        shadowRoot.appendChild(link);
    });

    if (stylesheetLinks.length === 0) {
        console.warn(
            '[trackswitch] Shadow DOM mount did not find a TrackSwitch stylesheet. '
            + 'Include a document-level TrackSwitch stylesheet link or pass mount.shadowDom.stylesheetHref.'
        );
    }

    const mountRoot = ownerDocument.createElement('div');
    shadowRoot.appendChild(mountRoot);

    return {
        mountRoot,
        cleanup: function() {
            shadowRoot.replaceChildren();
        },
    };
}
