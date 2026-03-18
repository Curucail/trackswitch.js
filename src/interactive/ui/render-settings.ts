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
    let html = '<div class="ts-settings-panel">';

    // Header
    html += '<div class="ts-settings-panel-header">'
        + '<span>Settings</span>'
        + '<button class="ts-settings-cancel-btn" title="Close">'
        + renderIconSlotHtml('xmark') + '</button>'
        + '</div>';

    // Body
    html += '<div class="ts-settings-panel-body">';

    // Files section
    html += '<div class="ts-settings-section">'
        + '<div class="ts-settings-section-title">Files &amp; Reference</div>'
        + '<table class="ts-settings-file-table" style="width:100%; border-collapse:collapse;">';

    html += '<thead><tr>'
        + '<th style="text-align:left; padding:4px 8px; font-size:11px;">Ref</th>'
        + '<th style="text-align:left; padding:4px 8px; font-size:11px;">File</th>'
        + '<th style="text-align:left; padding:4px 8px; font-size:11px;">Type</th>'
        + '<th></th>'
        + '</tr></thead><tbody>';

    for (let i = 0; i < state.files.length; i += 1) {
        const file = state.files[i];
        const isReference = file.id === state.referenceFileId;
        const iconName = file.type === 'audio' ? 'file-audio' : 'file-code';
        const typeLabel = file.type === 'audio' ? 'Audio' : 'Score';

        html += '<tr data-file-id="' + file.id + '">'
            + '<td style="padding:4px 8px;"><input type="radio" name="ts-settings-reference" value="'
            + file.id + '"' + (isReference ? ' checked' : '') + '></td>'
            + '<td style="padding:4px 8px;">' + escapeHtml(file.name) + '</td>'
            + '<td style="padding:4px 8px;"><span class="ts-file-type-icon">'
            + renderIconSlotHtml(iconName) + ' ' + typeLabel + '</span></td>'
            + '<td style="padding:4px 8px;"><button class="ts-file-remove-btn ts-settings-remove-btn" '
            + 'data-file-id="' + file.id + '" title="Remove">'
            + renderIconSlotHtml('trash') + '</button></td>'
            + '</tr>';
    }

    html += '</tbody></table>';

    // Add files button
    html += '<div class="ts-settings-add-files">'
        + '<button class="ts-settings-add-files-btn">'
        + renderIconSlotHtml('upload') + ' Add Files'
        + '</button>'
        + '<input type="file" class="ts-settings-add-files-input" style="display:none;" '
        + 'multiple accept=".wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.xml,.musicxml,.mxl">'
        + '</div>';

    html += '</div>';

    // Method section
    html += '<div class="ts-settings-section">'
        + '<div class="ts-settings-section-title">Alignment Method</div>'
        + '<select class="ts-method-select">'
        + '<option value="mrmsdtw"' + (state.alignmentMethod === 'mrmsdtw' ? ' selected' : '') + '>MrMsDTW (recommended)</option>'
        + '<option value="dtw"' + (state.alignmentMethod === 'dtw' ? ' selected' : '') + '>DTW (faster)</option>'
        + '</select>'
        + '</div>';

    html += '</div>';

    // Footer
    html += '<div class="ts-settings-panel-footer">'
        + '<button class="ts-settings-btn ts-settings-cancel-action">Cancel</button>'
        + '<button class="ts-settings-btn ts-settings-btn-primary ts-settings-apply-action">Apply</button>'
        + '</div>';

    html += '</div>';
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
    container.addEventListener('change', function(e) {
        const target = e.target as HTMLInputElement;
        if (target.name === 'ts-settings-reference' && target.checked) {
            workingState.referenceFileId = target.value;
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
                    const firstRadio = container.querySelector('input[name="ts-settings-reference"]') as HTMLInputElement | null;
                    if (firstRadio) {
                        firstRadio.checked = true;
                    }
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

    // Apply
    const applyBtn = container.querySelector('.ts-settings-apply-action');
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            events.onApply(workingState);
        });
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
