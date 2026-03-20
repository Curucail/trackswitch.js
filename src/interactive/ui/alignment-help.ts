import type { AlignmentHelpTooltipId } from './alignment-help-types';

interface AlignmentHelpTooltipItem {
    title: string;
    description: string;
}

interface AlignmentHelpTooltipContent {
    heading: string;
    items: AlignmentHelpTooltipItem[];
}

interface TooltipRootElement extends HTMLElement {
    __tsHelpButton?: HTMLButtonElement | null;
}

interface TooltipContainerElement extends HTMLElement {
    __tsAlignmentHelpCleanup__?: (() => void) | undefined;
}

export interface AlignmentHelpLabelHtmlOptions {
    label: string;
    selectId: string;
    tooltipId: AlignmentHelpTooltipId;
    idPrefix: string;
    align?: 'start' | 'end';
}

const ALIGNMENT_HELP_TOOLTIP_CONTENT: Record<AlignmentHelpTooltipId, AlignmentHelpTooltipContent> = {
    features: {
        heading: 'Features computed from audio files for synchronization.',
        items: [
            {
                title: 'Chroma + DLNCO (synctoolbox) (recommended)',
                description: 'Like "Chroma + DLNCO", but DLNCO features are only used on the finest level. Only available with MrMsDTW algorithm.',
            },
            {
                title: 'Chroma + DLNCO',
                description: 'Combine chroma and DLNCO features in a cost matrix with equal weighting. Chroma cost via cosine distance, DLNCO cost via L1 distance.'
            },
            {
                title: 'Chroma',
                description: 'Simple Chroma features.',
            },
            {
                title: 'Basic Pitch',
                description: 'Use Spotifys "Basic Pitch" transcription model outputs as features.',
            },
        ],
    },
    algorithm: {
        heading: 'The algorithm matches the computed features of two sequences (source and reference).',
        items: [
            {
                title: 'MrMsDTW (recommended)',
                description: 'Memory-restricted multiscale DTW. Computes the warping path in a coarse-to-fine strategy. May not find the global optimal path, but is preferred for long sequences due to much lower memory usage and faster runtime.',
            },
            {
                title: 'DTW',
                description: 'Finds the global optimal solution, but can be very slow and memory-intensive for long sequences.',
            },
        ],
    },
};

export function buildAlignmentHelpLabelHtml(options: AlignmentHelpLabelHtmlOptions): string {
    const tooltipDomId = 'ts-help-tooltip-' + options.idPrefix + '-' + options.tooltipId;
    const tooltipContent = ALIGNMENT_HELP_TOOLTIP_CONTENT[options.tooltipId];
    const triggerAlignClass = options.align === 'end'
        ? ' ts-help-trigger-wrap-end'
        : ' ts-help-trigger-wrap-start';
    const itemsHtml = tooltipContent.items.map(function(item) {
        return '<li class="ts-help-tooltip-item">'
            + '<strong class="ts-help-tooltip-item-title">' + escapeHtml(item.title) + '</strong>'
            + '<span class="ts-help-tooltip-item-copy">' + escapeHtml(item.description) + '</span>'
            + '</li>';
    }).join('');

    return '<div class="ts-alignment-select-header">'
        + '<label class="ts-alignment-select-label" for="' + escapeHtml(options.selectId) + '">'
        + escapeHtml(options.label)
        + '</label>'
        + '<span class="ts-help-trigger-wrap' + triggerAlignClass + '">'
        + '<button class="ts-help-trigger" type="button" aria-label="Show help for '
        + escapeHtml(options.label) + '" aria-expanded="false" aria-controls="' + tooltipDomId + '">?</button>'
        + '<span class="ts-help-tooltip" id="' + tooltipDomId + '" role="tooltip">'
        + '<span class="ts-help-tooltip-title">' + escapeHtml(tooltipContent.heading) + '</span>'
        + '<ul class="ts-help-tooltip-list">' + itemsHtml + '</ul>'
        + '</span>'
        + '</span>'
        + '</div>';
}

export function bindAlignmentHelpTooltips(container: HTMLElement): void {
    const tooltipContainer = container as TooltipContainerElement;
    if (tooltipContainer.__tsAlignmentHelpCleanup__) {
        tooltipContainer.__tsAlignmentHelpCleanup__();
    }

    const roots = Array.from(container.querySelectorAll('.ts-help-trigger-wrap')).filter(function(node) {
        return node instanceof HTMLElement;
    }) as TooltipRootElement[];

    if (roots.length === 0) {
        return;
    }

    let openRoot: TooltipRootElement | null = null;
    let manualRoot: TooltipRootElement | null = null;

    function closeRoot(root: TooltipRootElement): void {
        root.classList.remove('is-open');
        if (root.__tsHelpButton) {
            root.__tsHelpButton.setAttribute('aria-expanded', 'false');
        }
        if (openRoot === root) {
            openRoot = null;
        }
        if (manualRoot === root) {
            manualRoot = null;
        }
    }

    function closeAll(): void {
        roots.forEach(function(root) {
            closeRoot(root);
        });
    }

    function openRootWithMode(root: TooltipRootElement, manual: boolean): void {
        if (openRoot && openRoot !== root) {
            closeRoot(openRoot);
        }

        root.classList.add('is-open');
        if (root.__tsHelpButton) {
            root.__tsHelpButton.setAttribute('aria-expanded', 'true');
        }
        openRoot = root;
        manualRoot = manual || manualRoot === root ? root : null;
    }

    function ensureConnected(): boolean {
        if (container.isConnected) {
            return true;
        }
        cleanup();
        return false;
    }

    const teardownCallbacks: Array<() => void> = [];

    roots.forEach(function(root) {
        const button = root.querySelector('.ts-help-trigger') as HTMLButtonElement | null;
        root.__tsHelpButton = button;
        if (!button) {
            return;
        }

        const handleMouseEnter = function(): void {
            if (manualRoot && manualRoot !== root) {
                return;
            }
            openRootWithMode(root, false);
        };
        const handleMouseLeave = function(event: MouseEvent): void {
            if (manualRoot === root) {
                return;
            }
            const relatedTarget = event.relatedTarget as Node | null;
            if (relatedTarget && root.contains(relatedTarget)) {
                return;
            }
            closeRoot(root);
        };
        const handleFocusIn = function(): void {
            if (manualRoot && manualRoot !== root) {
                return;
            }
            openRootWithMode(root, false);
        };
        const handleFocusOut = function(): void {
            window.setTimeout(function() {
                if (!ensureConnected()) {
                    return;
                }
                const activeElement = container.ownerDocument.activeElement;
                if (manualRoot === root || (activeElement && root.contains(activeElement))) {
                    return;
                }
                closeRoot(root);
            }, 0);
        };
        const handleClick = function(event: MouseEvent): void {
            event.preventDefault();
            event.stopPropagation();
            if (manualRoot === root) {
                closeRoot(root);
                return;
            }
            openRootWithMode(root, true);
        };

        root.addEventListener('mouseenter', handleMouseEnter);
        root.addEventListener('mouseleave', handleMouseLeave);
        root.addEventListener('focusin', handleFocusIn);
        root.addEventListener('focusout', handleFocusOut);
        button.addEventListener('click', handleClick);

        teardownCallbacks.push(function() {
            root.removeEventListener('mouseenter', handleMouseEnter);
            root.removeEventListener('mouseleave', handleMouseLeave);
            root.removeEventListener('focusin', handleFocusIn);
            root.removeEventListener('focusout', handleFocusOut);
            button.removeEventListener('click', handleClick);
        });
    });

    const handleDocumentPointerDown = function(event: PointerEvent): void {
        if (!ensureConnected()) {
            return;
        }
        const target = event.target as Node | null;
        if (!target) {
            closeAll();
            return;
        }
        const clickedInsideTooltip = roots.some(function(root) {
            return root.contains(target);
        });
        if (!clickedInsideTooltip) {
            closeAll();
        }
    };

    const handleDocumentKeyDown = function(event: KeyboardEvent): void {
        if (!ensureConnected()) {
            return;
        }
        if (event.key === 'Escape' && openRoot) {
            const button = openRoot.__tsHelpButton;
            closeAll();
            if (button) {
                button.focus();
            }
        }
    };

    container.ownerDocument.addEventListener('pointerdown', handleDocumentPointerDown, true);
    container.ownerDocument.addEventListener('keydown', handleDocumentKeyDown, true);

    teardownCallbacks.push(function() {
        container.ownerDocument.removeEventListener('pointerdown', handleDocumentPointerDown, true);
        container.ownerDocument.removeEventListener('keydown', handleDocumentKeyDown, true);
    });

    function cleanup(): void {
        teardownCallbacks.forEach(function(callback) {
            callback();
        });
        tooltipContainer.__tsAlignmentHelpCleanup__ = undefined;
    }

    tooltipContainer.__tsAlignmentHelpCleanup__ = cleanup;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
