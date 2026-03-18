import type { InteractiveFile, AlignmentMethodId } from '../types';
import { renderIconSlotHtml } from '../../ui/icons';
import { classifyFileType } from '../file-handler';

export interface SettingsPanelState {
    files: InteractiveFile[];
    referenceFileId: string | null;
    alignmentMethod: AlignmentMethodId;
}

export interface SettingsPanelEvents {
    onApply(state: SettingsPanelState): void;
    onCancel(): void;
    onAddFiles(files: File[]): void;
}

export function buildSettingsPanelHtml(state: SettingsPanelState): string {
    let html = '<div class="ts-settings-panel" role="presentation">';
    html += '<div class="ts-settings-backdrop"></div>';
    html += '<div class="ts-settings-dialog" role="dialog" aria-modal="true" aria-label="Interactive settings">';

    // Header
    html += '<div class="ts-settings-panel-header">'
        + '<div class="ts-settings-panel-heading">'
        + '<span class="ts-section-kicker">Interactive mode</span>'
        + '<strong class="ts-settings-title">Alignment settings</strong>'
        + '<p class="ts-settings-copy">Adjust your file set, choose the reference timeline, and decide how aggressively the alignment should behave.</p>'
        + '</div>'
        + '<button class="ts-settings-cancel-btn" type="button" title="Close">'
        + renderIconSlotHtml('xmark') + '</button>'
        + '</div>';

    // Body
    html += '<div class="ts-settings-panel-body">';

    // Files section
    html += '<div class="ts-settings-section">'
        + '<div class="ts-settings-section-title">Files &amp; Reference</div>'
        + '<div class="ts-settings-section-copy">Choose the anchor file the rest of the material should align to.</div>'
        + '<div class="ts-settings-file-table-wrap">'
        + '<table class="ts-settings-file-table">';

    html += '<thead><tr>'
        + '<th>Ref</th>'
        + '<th>File</th>'
        + '<th>Type</th>'
        + '<th></th>'
        + '</tr></thead><tbody>';

    for (let i = 0; i < state.files.length; i += 1) {
        const file = state.files[i];
        const isReference = file.id === state.referenceFileId;
        const iconName = file.type === 'audio' ? 'file-audio' : 'file-code';
        const typeLabel = file.type === 'audio' ? 'Audio' : 'Score';

        html += '<tr data-file-id="' + file.id + '"' + (isReference ? ' class="is-reference"' : '') + '>'
            + '<td>' + buildReferenceToggleHtml(file.id, file.name, isReference) + '</td>'
            + '<td><span class="ts-file-name">' + escapeHtml(file.name) + '</span></td>'
            + '<td><span class="ts-file-type-icon">'
            + renderIconSlotHtml(iconName) + ' ' + typeLabel + '</span></td>'
            + '<td><button class="ts-file-remove-btn ts-settings-remove-btn" type="button" '
            + 'data-file-id="' + file.id + '" title="Remove">'
            + renderIconSlotHtml('trash') + '</button></td>'
            + '</tr>';
    }

    html += '</tbody></table></div>';

    // Add files button
    html += '<div class="ts-settings-add-files">'
        + '<button class="ts-settings-add-files-btn" type="button">'
        + renderIconSlotHtml('upload') + ' Add Files'
        + '</button>'
        + '<span class="ts-settings-add-files-copy">Add more audio or MusicXML without leaving this flow.</span>'
        + '<input type="file" class="ts-settings-add-files-input" style="display:none;" '
        + 'multiple accept=".wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.xml,.musicxml,.mxl">'
        + '</div>';

    html += '</div>';

    // Method section
    html += '<div class="ts-settings-section">'
        + '<div class="ts-settings-section-title">Alignment Method</div>'
        + '<div class="ts-settings-section-copy">Use the same method picker from the initial screen when you want to swap between the recommended pass and the quicker preview mode.</div>'
        + '<label class="ts-method-select-wrap">'
        + '<span class="ts-method-select-label">Alignment method</span>'
        + '<select class="ts-method-select">'
        + '<option value="mrmsdtw"' + (state.alignmentMethod === 'mrmsdtw' ? ' selected' : '') + '>MrMsDTW</option>'
        + '<option value="dtw"' + (state.alignmentMethod === 'dtw' ? ' selected' : '') + '>DTW</option>'
        + '</select>'
        + '</label>'
        + '</div>';

    html += '</div>';

    // Footer
    html += '<div class="ts-settings-panel-footer">'
        + '<button class="ts-settings-btn ts-settings-cancel-action" type="button">Cancel</button>'
        + '<button class="ts-settings-btn ts-settings-btn-primary ts-settings-apply-action" type="button">Apply Changes</button>'
        + '</div>';

    html += '</div></div>';
    return html;
}

export function bindSettingsPanelEvents(container: HTMLElement, initialState: SettingsPanelState, events: SettingsPanelEvents): void {
    // Working copy of state
    const workingState: SettingsPanelState = {
        files: [...initialState.files],
        referenceFileId: initialState.referenceFileId,
        alignmentMethod: initialState.alignmentMethod,
    };

    // Reference change
    container.addEventListener('click', function(e) {
        const referenceToggle = (e.target as HTMLElement).closest('.ts-settings-reference-toggle') as HTMLElement | null;
        if (referenceToggle) {
            const fileId = referenceToggle.getAttribute('data-file-id');
            if (fileId) {
                workingState.referenceFileId = fileId;
                syncReferenceSelection(container, fileId);
            }
        }
    });

    // Method change
    const methodSelect = container.querySelector('.ts-method-select') as HTMLSelectElement | null;
    if (methodSelect) {
        methodSelect.addEventListener('change', function() {
            workingState.alignmentMethod = methodSelect.value as AlignmentMethodId;
        });
    }

    // Remove buttons
    container.addEventListener('click', function(e) {
        const removeBtn = (e.target as HTMLElement).closest('.ts-settings-remove-btn') as HTMLElement | null;
        if (removeBtn) {
            const fileId = removeBtn.getAttribute('data-file-id');
            if (fileId) {
                workingState.files = workingState.files.filter(function(f) { return f.id !== fileId; });
                const row = removeBtn.closest('tr');
                if (row) {
                    row.remove();
                }
                if (workingState.referenceFileId === fileId && workingState.files.length > 0) {
                    workingState.referenceFileId = workingState.files[0].id;
                    syncReferenceSelection(container, workingState.referenceFileId);
                }
            }
        }
    });

    // Add files
    const addBtn = container.querySelector('.ts-settings-add-files-btn') as HTMLElement | null;
    const addInput = container.querySelector('.ts-settings-add-files-input') as HTMLInputElement | null;
    if (addBtn && addInput) {
        addBtn.addEventListener('click', function() {
            addInput.click();
        });
        addInput.addEventListener('change', function() {
            if (addInput.files && addInput.files.length > 0) {
                const validFiles: File[] = [];
                for (let i = 0; i < addInput.files.length; i += 1) {
                    if (classifyFileType(addInput.files[i]) !== null) {
                        validFiles.push(addInput.files[i]);
                    }
                }
                if (validFiles.length > 0) {
                    events.onAddFiles(validFiles);
                }
                addInput.value = '';
            }
        });
    }

    // Cancel
    const cancelActions = container.querySelectorAll('.ts-settings-cancel-btn, .ts-settings-cancel-action');
    cancelActions.forEach(function(el) {
        el.addEventListener('click', function() {
            events.onCancel();
        });
    });

    const backdrop = container.querySelector('.ts-settings-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', function() {
            events.onCancel();
        });
    }

    // Apply
    const applyBtn = container.querySelector('.ts-settings-apply-action');
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            events.onApply(workingState);
        });
    }
}

function buildReferenceToggleHtml(fileId: string, fileName: string, isReference: boolean): string {
    return '<button class="ts-settings-reference-toggle' + (isReference ? ' is-selected' : '') + '"'
        + ' type="button" data-file-id="' + fileId + '"'
        + ' aria-label="Use ' + escapeHtml(fileName) + ' as reference"'
        + ' aria-pressed="' + String(isReference) + '">'
        + renderIconSlotHtml(isReference ? 'circle-dot' : 'circle')
        + '</button>';
}

function syncReferenceSelection(container: HTMLElement, selectedFileId: string | null): void {
    const toggles = container.querySelectorAll('.ts-settings-reference-toggle');
    toggles.forEach(function(toggle) {
        if (!(toggle instanceof HTMLElement)) {
            return;
        }

        const isSelected = toggle.getAttribute('data-file-id') === selectedFileId;
        toggle.classList.toggle('is-selected', isSelected);
        toggle.setAttribute('aria-pressed', String(isSelected));
        toggle.innerHTML = renderIconSlotHtml(isSelected ? 'circle-dot' : 'circle');

        const row = toggle.closest('tr');
        if (row) {
            row.classList.toggle('is-reference', isSelected);
        }
    });
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
