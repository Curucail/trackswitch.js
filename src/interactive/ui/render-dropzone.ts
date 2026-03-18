import type { AlignmentMethodId, InteractiveFile } from '../types';
import { renderIconSlotHtml } from '../../ui/icons';
import { classifyFileType } from '../file-handler';

export function buildDropZoneHtml(): string {
    return '<div class="ts-dropzone" tabindex="0">'
        + '<div class="ts-dropzone-prompt">'
        + '<span class="ts-dropzone-eyebrow">Interactive alignment</span>'
        + '<span class="ts-dropzone-icon">' + renderIconSlotHtml('upload') + '</span>'
        + '<strong class="ts-dropzone-title">Drop audio and scores here</strong>'
        + '<span class="ts-dropzone-hint">Supported Audio Formats: WAV, MP3, OGG, FLAC, M4A, AAC, WebM</span>'
        + '<span class="ts-dropzone-hint">Supported Score Formats: XML, MusicXML, MXL</span>'
        + '</div>'
        + '<input type="file" class="ts-dropzone-input" multiple '
        + 'accept=".wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.xml,.musicxml,.mxl">'
        + '</div>';
}

export function buildFileListHtml(files: InteractiveFile[], referenceFileId: string | null): string {
    if (files.length === 0) {
        return '';
    }

    let html = '<div class="ts-interactive-file-list">'
        + '<div class="ts-interactive-list-header">'
        + '<div>'
        + '<span class="ts-section-kicker">Selected files</span>'
        + '<strong class="ts-section-title">Pick a reference to align other sources to</strong>'
        + '</div>'
        + '<span class="ts-file-count">' + files.length + (files.length === 1 ? ' file' : ' files') + '</span>'
        + '</div>'
        + '<table>'
        + '<thead><tr>'
        + '<th>Reference</th>'
        + '<th>File</th>'
        + '<th>Type</th>'
        + '<th></th>'
        + '</tr></thead>'
        + '<tbody>';

    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const isReference = file.id === referenceFileId;
        const iconName = file.type === 'audio' ? 'file-audio' : 'file-code';
        const typeLabel = file.type === 'audio' ? 'Audio' : 'Score';

        html += '<tr data-file-id="' + file.id + '"' + (isReference ? ' class="is-reference"' : '') + '>'
            + '<td>' + buildReferenceToggleHtml(file.id, file.name, isReference, 'ts-reference-toggle') + '</td>'
            + '<td><span class="ts-file-name">' + escapeHtml(file.name) + '</span></td>'
            + '<td><span class="ts-file-type-icon">' + renderIconSlotHtml(iconName)
            + ' ' + typeLabel + '</span></td>'
            + '<td><button class="ts-file-remove-btn" data-file-id="' + file.id
            + '" title="Remove file">' + renderIconSlotHtml('trash') + '</button></td>'
            + '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
}

export function buildComputeBarHtml(
    canCompute: boolean,
    status: string,
    alignmentMethod: AlignmentMethodId,
    isComputing: boolean,
    showCancel: boolean,
    syncGenerationEnabled: boolean
): string {
    let html = '<div class="ts-compute-bar">'
        + '<div class="ts-compute-bar-row">'
        + '<div class="ts-compute-options">'
        + '<label class="ts-method-select-wrap">'
        + '<span class="ts-method-select-label">Alignment method</span>'
        + '<select class="ts-method-select">'
        + '<option value="mrmsdtw"' + (alignmentMethod === 'mrmsdtw' ? ' selected' : '') + '>MrMsDTW</option>'
        + '<option value="dtw"' + (alignmentMethod === 'dtw' ? ' selected' : '') + '>DTW</option>'
        + '</select>'
        + '</label>'
        + '<label class="ts-sync-toggle-row">'
        + '<span class="ts-sync-toggle-copy">'
        + '<span class="ts-sync-toggle-title">Generate synced audio</span>'
        + '<span class="ts-sync-toggle-hint">Create time- and pitch-synchronized playback sources.</span>'
        + '</span>'
        + '<span class="ts-sync-toggle-switch">'
        + '<input class="ts-sync-toggle-input" type="checkbox"' + (syncGenerationEnabled ? ' checked' : '') + '>'
        + '<span class="ts-sync-toggle-knob" aria-hidden="true"></span>'
        + '</span>'
        + '</label>'
        + '</div>'
        + '<div class="ts-compute-actions">';

    if (showCancel) {
        html += '<button class="ts-cancel-btn" type="button">'
            + '<span>Cancel</span></button>';
    }

    html += '<button class="ts-compute-btn"' + (canCompute ? '' : ' disabled') + '>'
        + '<span>Compute Alignment</span></button>'
        + '</div>'
        + '</div>';

    if (status && !isComputing) {
        const isError = status.toLowerCase().includes('error');
        html += '<span class="ts-compute-status' + (isError ? ' ts-compute-status-error' : '') + '">'
            + escapeHtml(status) + '</span>';
    }

    html += '</div>';
    return html;
}

export function buildComputingOverlayHtml(message: string): string {
    return '<div class="ts-computing-overlay">'
        + '<div class="ts-computing-card">'
        + '<div class="ts-progress-bar"><div class="ts-progress-fill" style="width: 0%;"></div></div>'
        + '<span class="ts-progress-percent">--%</span>'
        + '<span class="ts-computing-message">' + escapeHtml(message) + '</span>'
        + '</div>'
        + '</div>';
}

export function buildFullDropZonePanel(
    files: InteractiveFile[],
    referenceFileId: string | null,
    canCompute: boolean,
    statusMessage: string,
    isComputing: boolean,
    computingMessage: string,
    alignmentMethod: AlignmentMethodId,
    showCancel: boolean,
    syncGenerationEnabled: boolean
): string {
    let html = '<div class="ts-interactive-panel ts-stack-section">';

    html += buildDropZoneHtml();
    html += buildFileListHtml(files, referenceFileId);
    html += buildComputeBarHtml(
        canCompute,
        statusMessage,
        alignmentMethod,
        isComputing,
        showCancel,
        syncGenerationEnabled
    );

    if (isComputing) {
        html += buildComputingOverlayHtml(computingMessage);
    }

    html += '</div>';
    return html;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Event binding ──

export interface DropZoneEvents {
    onFilesAdded(files: File[]): void;
    onReferenceChanged(fileId: string): void;
    onFileRemoved(fileId: string): void;
    onMethodChanged(method: AlignmentMethodId): void;
    onSyncGenerationChanged(enabled: boolean): void;
    onCancelClicked(): void;
    onComputeClicked(): void;
}

export function bindDropZoneEvents(container: HTMLElement, events: DropZoneEvents): void {
    const dropZone = container.querySelector('.ts-dropzone') as HTMLElement | null;
    const fileInput = container.querySelector('.ts-dropzone-input') as HTMLInputElement | null;
    let dragDepth = 0;

    function setDragOverState(active: boolean): void {
        container.classList.toggle('ts-interactive-panel-dragover', active);
        if (dropZone) {
            dropZone.classList.toggle('ts-dropzone-dragover', active);
        }
    }

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', function(e) {
            if ((e.target as HTMLElement).closest('.ts-file-remove-btn')) {
                return;
            }
            fileInput.click();
        });

        container.addEventListener('dragenter', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dragDepth += 1;
            setDragOverState(true);
        });

        container.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            setDragOverState(true);
        });

        container.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) {
                setDragOverState(false);
            }
        });

        container.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dragDepth = 0;
            setDragOverState(false);
            if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                const validFiles = filterValidFiles(e.dataTransfer.files);
                if (validFiles.length > 0) {
                    events.onFilesAdded(validFiles);
                }
            }
        });

        fileInput.addEventListener('change', function() {
            if (fileInput.files && fileInput.files.length > 0) {
                const validFiles = filterValidFiles(fileInput.files);
                if (validFiles.length > 0) {
                    events.onFilesAdded(validFiles);
                }
                fileInput.value = '';
            }
        });
    }

    // Reference buttons
    container.addEventListener('click', function(e) {
        const referenceToggle = (e.target as HTMLElement).closest('.ts-reference-toggle') as HTMLElement | null;
        if (referenceToggle) {
            const fileId = referenceToggle.getAttribute('data-file-id');
            if (fileId) {
                events.onReferenceChanged(fileId);
            }
        }
    });

    // Remove buttons
    container.addEventListener('click', function(e) {
        const removeBtn = (e.target as HTMLElement).closest('.ts-file-remove-btn') as HTMLElement | null;
        if (removeBtn) {
            e.stopPropagation();
            const fileId = removeBtn.getAttribute('data-file-id');
            if (fileId) {
                events.onFileRemoved(fileId);
            }
        }
    });

    // Method selector
    const methodSelect = container.querySelector('.ts-method-select') as HTMLSelectElement | null;
    if (methodSelect) {
        methodSelect.addEventListener('change', function() {
            events.onMethodChanged(methodSelect.value as AlignmentMethodId);
        });
    }

    const syncToggleInput = container.querySelector('.ts-sync-toggle-input') as HTMLInputElement | null;
    if (syncToggleInput) {
        syncToggleInput.addEventListener('change', function() {
            events.onSyncGenerationChanged(syncToggleInput.checked);
        });
    }

    // Compute button
    container.addEventListener('click', function(e) {
        const btn = (e.target as HTMLElement).closest('.ts-compute-btn') as HTMLButtonElement | null;
        if (btn && !btn.disabled) {
            events.onComputeClicked();
        }
    });

    container.addEventListener('click', function(e) {
        const btn = (e.target as HTMLElement).closest('.ts-cancel-btn') as HTMLButtonElement | null;
        if (btn) {
            events.onCancelClicked();
        }
    });
}

function buildReferenceToggleHtml(
    fileId: string,
    fileName: string,
    isReference: boolean,
    className: string
): string {
    return '<button class="' + className + (isReference ? ' is-selected' : '') + '"'
        + ' type="button" data-file-id="' + fileId + '"'
        + ' aria-label="Use ' + escapeHtml(fileName) + ' as reference"'
        + ' aria-pressed="' + String(isReference) + '">'
        + renderIconSlotHtml(isReference ? 'circle-dot' : 'circle')
        + '</button>';
}

function filterValidFiles(fileList: FileList): File[] {
    const result: File[] = [];
    for (let i = 0; i < fileList.length; i += 1) {
        if (classifyFileType(fileList[i]) !== null) {
            result.push(fileList[i]);
        }
    }
    return result;
}
