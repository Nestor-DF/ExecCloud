document.addEventListener('DOMContentLoaded', () => {
    // ── State ──
    let allServices = [];
    let filteredServices = [];
    let currentPage = 1;
    const PAGE_SIZE = 12;

    // ── DOM refs ──
    const grid = document.getElementById('servicesGrid');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const searchResultsInfo = document.getElementById('searchResultsInfo');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    const paginationControls = document.getElementById('paginationControls');

    // ── Upload Modal ──
    const uploadModal = document.getElementById('uploadModal');
    const openUploadBtn = document.getElementById('openUploadBtn');

    openUploadBtn.onclick = () => openModal(uploadModal);

    // Close buttons (shared for all modals)
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-modal');
            if (modalId) {
                closeModal(document.getElementById(modalId));
            }
        });
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
    });

    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.show').forEach(m => closeModal(m));
        }
    });

    function openModal(modal) {
        modal.classList.add('show');
    }

    function closeModal(modal) {
        modal.classList.remove('show');
    }

    // ── Upload Form ──
    const uploadForm = document.getElementById('uploadForm');
    const uploadStatus = document.getElementById('uploadStatus');

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(uploadForm);

        uploadStatus.textContent = 'Uploading...';
        uploadStatus.className = 'status-message';

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                uploadStatus.textContent = 'Service uploaded successfully!';
                uploadStatus.classList.add('success');
                uploadForm.reset();
                setTimeout(() => {
                    closeModal(uploadModal);
                    uploadStatus.textContent = '';
                    fetchServices();
                }, 1500);
            } else {
                uploadStatus.textContent = data.error || 'Upload failed.';
                uploadStatus.classList.add('error');
            }
        } catch (err) {
            uploadStatus.textContent = 'Network error during upload.';
            uploadStatus.classList.add('error');
        }
    });

    // ── Search ──
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        clearSearchBtn.classList.toggle('visible', query.length > 0);
        applyFilter(query);
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.classList.remove('visible');
        applyFilter('');
        searchInput.focus();
    });

    function applyFilter(query) {
        currentPage = 1;
        if (!query) {
            filteredServices = [...allServices];
            searchResultsInfo.textContent = '';
        } else {
            const words = query.toLowerCase().split(/\s+/).filter(Boolean);
            filteredServices = allServices.filter(service => {
                const haystack = `${service.name} ${service.description}`.toLowerCase();
                return words.every(word => haystack.includes(word));
            });
            searchResultsInfo.textContent = `${filteredServices.length} service${filteredServices.length !== 1 ? 's' : ''} found`;
        }
        renderPage();
    }

    // ── Pagination ──
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; renderPage(); }
    });

    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredServices.length / PAGE_SIZE);
        if (currentPage < totalPages) { currentPage++; renderPage(); }
    });

    function updatePagination() {
        const totalPages = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE));
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        paginationControls.classList.toggle('hidden', filteredServices.length <= PAGE_SIZE);
    }

    // ── Render ──
    function renderPage() {
        const start = (currentPage - 1) * PAGE_SIZE;
        const pageItems = filteredServices.slice(start, start + PAGE_SIZE);

        grid.innerHTML = '';

        if (allServices.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>No services found. Upload one to get started!</p></div>';
            paginationControls.classList.add('hidden');
            return;
        }

        if (pageItems.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>No services match your search.</p></div>';
            updatePagination();
            return;
        }

        pageItems.forEach((service, index) => {
            const card = createPreviewCard(service, index);
            grid.appendChild(card);
        });

        updatePagination();
    }

    function createPreviewCard(service, index) {
        const card = document.createElement('div');
        card.className = 'preview-card';
        card.style.animationDelay = `${index * 0.05}s`;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Open service: ${service.name}`);

        // Build tags for arg types
        const argTypes = (service.args || []).map(a => a.type || 'text');
        const uniqueTypes = [...new Set(argTypes)];
        const tagsHtml = uniqueTypes.map(t => {
            const label = { text: 'Text', number: 'Number', file: 'File', output_file: 'Output' }[t] || t;
            return `<span class="preview-card__tag preview-card__tag--${t}">${label}</span>`;
        }).join('');

        // Show execution wrapper badge if present
        const wrapperBadge = service.execution && service.execution.wrapper
            ? `<span class="preview-card__tag preview-card__tag--wrapper">${escapeHtml(service.execution.wrapper)}</span>`
            : '';

        card.innerHTML = `
            <div class="preview-card__name">${escapeHtml(service.name)}</div>
            <div class="preview-card__desc">${escapeHtml(service.description)}</div>
            <div class="preview-card__tags">${tagsHtml}${wrapperBadge}</div>
            <div class="preview-card__arrow">Open →</div>
        `;

        const openAction = () => openServiceModal(service);
        card.addEventListener('click', openAction);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAction(); }
        });

        return card;
    }

    // ── Service Execution Modal ──
    const serviceModal = document.getElementById('serviceModal');
    const serviceModalBody = document.getElementById('serviceModalBody');

    function openServiceModal(service) {
        const formId = `modal-form-${service.name}`;
        const resultId = `modal-result-${service.name}`;

        let formHtml = `<form id="${formId}" enctype="multipart/form-data">`;

        if (service.args && service.args.length > 0) {
            service.args.forEach(arg => {
                const argType = arg.type || 'text';
                const fieldId = `modal-${service.name}-${arg.id}`;

                if (argType === 'text') {
                    formHtml += `
                        <div class="form-group">
                            <label for="${fieldId}">${escapeHtml(arg.label)}</label>
                            <input type="text" id="${fieldId}" name="${arg.id}" required placeholder="Enter ${arg.label.toLowerCase()}">
                        </div>
                    `;
                } else if (argType === 'number') {
                    formHtml += `
                        <div class="form-group">
                            <label for="${fieldId}">${escapeHtml(arg.label)}</label>
                            <input type="number" id="${fieldId}" name="${arg.id}" step="any" required placeholder="Enter ${arg.label.toLowerCase()}">
                        </div>
                    `;
                } else if (argType === 'file') {
                    const accept = arg.accept || '';
                    formHtml += `
                        <div class="form-group">
                            <label for="${fieldId}">${escapeHtml(arg.label)}</label>
                            <div class="file-input-wrapper" id="wrapper-${fieldId}">
                                <input type="file" id="${fieldId}" name="${arg.id}" accept="${accept}" required class="file-input-hidden">
                                <div class="file-input-display">
                                    <svg class="file-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                    <span class="file-input-text">Choose file or drag here</span>
                                    <span class="file-input-name"></span>
                                </div>
                            </div>
                        </div>
                    `;
                } else if (argType === 'output_file') {
                    formHtml += `
                        <div class="form-group output-file-info">
                            <label>${escapeHtml(arg.label)}</label>
                            <div class="output-file-badge">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                                <span>Generated automatically (${arg.extension || '.out'})</span>
                            </div>
                        </div>
                    `;
                }
            });
        }

        // Execution info badge
        let execInfoHtml = '';
        if (service.execution && service.execution.wrapper) {
            const wArgs = (service.execution.wrapperArgs || []).join(' ');
            execInfoHtml = `
                <div class="exec-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                    <span>${escapeHtml(service.execution.wrapper)} ${escapeHtml(wArgs)}</span>
                </div>
            `;
        }

        formHtml += `
            <button type="submit" class="btn btn-primary full-width" id="executeBtn-${service.name}">Execute</button>
        </form>
        <div id="${resultId}" class="result-container"></div>
        `;

        serviceModalBody.innerHTML = `
            <div class="service-modal-header">
                <div>
                    <h2>${escapeHtml(service.name)}</h2>
                    <p>${escapeHtml(service.description)}</p>
                    ${execInfoHtml}
                </div>
            </div>
            ${formHtml}
            <div class="service-modal-actions">
                <button class="delete-service-btn" id="deleteServiceBtn">Delete Service</button>
            </div>
        `;

        // Setup file input interactivity
        setupFileInputs(serviceModalBody);

        // Form submit
        const form = serviceModalBody.querySelector(`#${formId}`);
        const resultContainer = serviceModalBody.querySelector(`#${resultId}`);
        const executeBtn = serviceModalBody.querySelector(`#executeBtn-${service.name}`);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Build FormData (includes both text fields and file inputs)
            const formData = new FormData(form);

            // Show loading state
            resultContainer.innerHTML = '';
            resultContainer.className = 'result-container';
            resultContainer.innerHTML = `
                <div class="result-box" style="display:block; color: var(--text-muted);">
                    <div class="executing-spinner"></div>
                    Executing...
                </div>
            `;
            executeBtn.disabled = true;
            executeBtn.textContent = 'Executing...';

            try {
                const res = await fetch(`/api/execute/${service.name}`, {
                    method: 'POST',
                    body: formData
                });

                const data = await res.json();

                if (data.success) {
                    resultContainer.innerHTML = '';
                    resultContainer.className = 'result-container';

                    // Show stdout if present
                    if (data.result) {
                        const stdoutBox = document.createElement('div');
                        stdoutBox.className = 'result-box success';
                        stdoutBox.style.display = 'block';
                        stdoutBox.textContent = `Output:\n${data.result}`;
                        resultContainer.appendChild(stdoutBox);
                    }

                    // Show output files
                    if (data.outputFiles && data.outputFiles.length > 0) {
                        const filesBox = document.createElement('div');
                        filesBox.className = 'output-files-container';

                        data.outputFiles.forEach(file => {
                            const fileEl = document.createElement('div');
                            fileEl.className = 'output-file-item';

                            if (file.mimeType && file.mimeType.startsWith('image/')) {
                                // Show image preview
                                fileEl.innerHTML = `
                                    <p class="output-file-label">${escapeHtml(file.label)}</p>
                                    <div class="output-image-preview">
                                        <img src="${file.url}" alt="${escapeHtml(file.label)}" loading="lazy">
                                    </div>
                                    <a href="${file.url}" download class="btn btn-secondary output-download-btn">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        Download
                                    </a>
                                `;
                            } else if (file.mimeType && (file.mimeType.startsWith('video/') || file.mimeType.startsWith('audio/'))) {
                                // Show video/audio player
                                const tag = file.mimeType.startsWith('video/') ? 'video' : 'audio';
                                fileEl.innerHTML = `
                                    <p class="output-file-label">${escapeHtml(file.label)}</p>
                                    <${tag} controls class="output-media-preview">
                                        <source src="${file.url}" type="${file.mimeType}">
                                        Your browser does not support this media type.
                                    </${tag}>
                                    <a href="${file.url}" download class="btn btn-secondary output-download-btn">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        Download
                                    </a>
                                `;
                            } else {
                                // Generic file download
                                fileEl.innerHTML = `
                                    <p class="output-file-label">${escapeHtml(file.label)}</p>
                                    <a href="${file.url}" download class="btn btn-secondary output-download-btn">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        Download ${file.extension || 'file'}
                                    </a>
                                `;
                            }

                            filesBox.appendChild(fileEl);
                        });

                        resultContainer.appendChild(filesBox);
                    }

                    // If no output at all
                    if (!data.result && (!data.outputFiles || data.outputFiles.length === 0)) {
                        const emptyBox = document.createElement('div');
                        emptyBox.className = 'result-box success';
                        emptyBox.style.display = 'block';
                        emptyBox.textContent = 'Execution completed successfully (no output).';
                        resultContainer.appendChild(emptyBox);
                    }
                } else {
                    resultContainer.innerHTML = `<div class="result-box error" style="display:block;">Error:\n${escapeHtml(data.error)}</div>`;
                }
            } catch (err) {
                resultContainer.innerHTML = '<div class="result-box error" style="display:block;">Execution failed. Check connection.</div>';
            } finally {
                executeBtn.disabled = false;
                executeBtn.textContent = 'Execute';
            }
        });

        // Delete button
        const deleteBtn = serviceModalBody.querySelector('#deleteServiceBtn');
        deleteBtn.addEventListener('click', async () => {
            if (confirm(`Are you sure you want to delete the "${service.name}" service?`)) {
                try {
                    const res = await fetch(`/api/services/${service.name}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        closeModal(serviceModal);
                        fetchServices();
                    } else {
                        alert('Error: ' + data.error);
                    }
                } catch (err) {
                    alert('Network error while deleting service.');
                }
            }
        });

        openModal(serviceModal);
    }

    // ── File Input Interactivity ──
    function setupFileInputs(container) {
        container.querySelectorAll('.file-input-wrapper').forEach(wrapper => {
            const input = wrapper.querySelector('.file-input-hidden');
            const display = wrapper.querySelector('.file-input-display');
            const textEl = wrapper.querySelector('.file-input-text');
            const nameEl = wrapper.querySelector('.file-input-name');

            // Click to open file picker
            display.addEventListener('click', () => input.click());

            // Show selected file name
            input.addEventListener('change', () => {
                if (input.files && input.files.length > 0) {
                    nameEl.textContent = input.files[0].name;
                    textEl.style.display = 'none';
                    nameEl.style.display = 'inline';
                    wrapper.classList.add('has-file');
                } else {
                    nameEl.textContent = '';
                    textEl.style.display = 'inline';
                    nameEl.style.display = 'none';
                    wrapper.classList.remove('has-file');
                }
            });

            // Drag and drop
            display.addEventListener('dragover', (e) => {
                e.preventDefault();
                wrapper.classList.add('drag-over');
            });
            display.addEventListener('dragleave', () => {
                wrapper.classList.remove('drag-over');
            });
            display.addEventListener('drop', (e) => {
                e.preventDefault();
                wrapper.classList.remove('drag-over');
                if (e.dataTransfer.files.length > 0) {
                    input.files = e.dataTransfer.files;
                    input.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    // ── Fetch Services ──
    async function fetchServices() {
        grid.innerHTML = '<div class="empty-state"><p>Loading services...</p></div>';
        paginationControls.classList.add('hidden');

        try {
            const res = await fetch('/api/services');
            const data = await res.json();

            if (data.success) {
                allServices = data.services;
                const query = searchInput.value.trim();
                applyFilter(query);
            }
        } catch (err) {
            grid.innerHTML = '<div class="empty-state"><p style="color: var(--error)">Failed to load services.</p></div>';
            console.error(err);
        }
    }

    // ── Helpers ──
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Init ──
    fetchServices();
});
