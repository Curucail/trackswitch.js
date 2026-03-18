import type { AlignmentMethodId, InteractiveFile } from '../types';
import { renderIconSlotHtml } from '../../ui/icons';
import { classifyFileType } from '../file-handler';

export function buildDropZoneHtml(): string {
    return '<div class="ts-dropzone" tabindex="0">'
        + '<div class="ts-dropzone-prompt">'
        + renderIconSlotHtml('upload')
        + '<span>Drop audio or MusicXML files here, or click to browse</span>'
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
        + '<table>'
        + '<thead><tr>'
        + '<th>Ref</th>'
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

        html += '<tr data-file-id="' + file.id + '">'
            + '<td><input type="radio" name="ts-reference" value="' + file.id + '"'
            + (isReference ? ' checked' : '') + '></td>'
            + '<td>' + escapeHtml(file.name) + '</td>'
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
    alignmentMethod: AlignmentMethodId
): string {
    let html = '<div class="ts-compute-bar">'
        + '<div class="ts-compute-bar-row">'
        + '<button class="ts-compute-btn"' + (canCompute ? '' : ' disabled') + '>'
        + 'Compute Alignment</button>'
        + '<select class="ts-method-select">'
        + '<option value="mrmsdtw"' + (alignmentMethod === 'mrmsdtw' ? ' selected' : '') + '>MrMsDTW</option>'
        + '<option value="dtw"' + (alignmentMethod === 'dtw' ? ' selected' : '') + '>DTW</option>'
        + '</select>'
        + '</div>';

    if (status) {
        const isError = status.toLowerCase().includes('error');
        html += '<span class="ts-compute-status' + (isError ? ' ts-compute-status-error' : '') + '">'
            + escapeHtml(status) + '</span>';
    }

    html += '</div>';
    return html;
}

export function buildComputingOverlayHtml(message: string): string {
    return '<div class="ts-computing-overlay">'
        + renderIconSlotHtml('spinner')
        + '<div class="ts-progress-bar"><div class="ts-progress-fill" style="width: 0%;"></div></div>'
        + '<span>' + escapeHtml(message) + '</span>'
        + '</div>';
}

export function buildFullDropZonePanel(
    files: InteractiveFile[],
    referenceFileId: string | null,
    canCompute: boolean,
    statusMessage: string,
    isComputing: boolean,
    computingMessage: string,
    alignmentMethod: AlignmentMethodId
): string {
    let html = '<div class="ts-interactive-panel ts-stack-section" style="position: relative;">';

    html += buildDropZoneHtml();
    html += buildFileListHtml(files, referenceFileId);
    html += buildComputeBarHtml(canCompute, statusMessage, alignmentMethod);

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
    onComputeClicked(): void;
}

export function bindDropZoneEvents(container: HTMLElement, events: DropZoneEvents): void {
    const dropZone = container.querySelector('.ts-dropzone') as HTMLElement | null;
    const fileInput = container.querySelector('.ts-dropzone-input') as HTMLInputElement | null;

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', function(e) {
            if ((e.target as HTMLElement).closest('.ts-file-remove-btn')) {
                return;
            }
            fileInput.click();
        });

        dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('ts-dropzone-dragover');
        });

        dropZone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('ts-dropzone-dragover');
        });

        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('ts-dropzone-dragover');
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

    // Reference radio buttons
    container.addEventListener('change', function(e) {
        const target = e.target as HTMLInputElement;
        if (target.name === 'ts-reference' && target.checked) {
            events.onReferenceChanged(target.value);
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

    // Compute button
    container.addEventListener('click', function(e) {
        const btn = (e.target as HTMLElement).closest('.ts-compute-btn') as HTMLButtonElement | null;
        if (btn && !btn.disabled) {
            events.onComputeClicked();
        }
    });
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
