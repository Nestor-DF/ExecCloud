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

        card.innerHTML = `
            <div class="preview-card__name">${escapeHtml(service.name)}</div>
            <div class="preview-card__desc">${escapeHtml(service.description)}</div>
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
        let formHtml = `<form id="modal-form-${service.name}">`;

        if (service.args && service.args.length > 0) {
            service.args.forEach(arg => {
                const inputType = arg.type === 'number' ? 'number' : 'text';
                const step = arg.type === 'number' ? 'any' : '';
                formHtml += `
                    <div class="form-group">
                        <label for="modal-${service.name}-${arg.id}">${escapeHtml(arg.label)}</label>
                        <input type="${inputType}" id="modal-${service.name}-${arg.id}" name="${arg.id}" step="${step}" required placeholder="Enter ${arg.label.toLowerCase()}">
                    </div>
                `;
            });
        }

        formHtml += `
            <button type="submit" class="btn btn-primary full-width">Execute</button>
        </form>
        <div id="modal-result-${service.name}" class="result-box"></div>
        `;

        serviceModalBody.innerHTML = `
            <div class="service-modal-header">
                <div>
                    <h2>${escapeHtml(service.name)}</h2>
                    <p>${escapeHtml(service.description)}</p>
                </div>
            </div>
            ${formHtml}
            <div class="service-modal-actions">
                <button class="delete-service-btn" id="deleteServiceBtn">Delete Service</button>
            </div>
        `;

        // Form submit
        const form = serviceModalBody.querySelector(`#modal-form-${service.name}`);
        const resultBox = serviceModalBody.querySelector(`#modal-result-${service.name}`);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const dataObj = Object.fromEntries(formData.entries());

            resultBox.className = 'result-box';
            resultBox.style.display = 'block';
            resultBox.textContent = 'Executing...';
            resultBox.style.color = 'var(--text-muted)';

            try {
                const res = await fetch(`/api/execute/${service.name}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dataObj)
                });

                const data = await res.json();
                if (data.success) {
                    resultBox.className = 'result-box success';
                    resultBox.textContent = `Result:\n${data.result}`;
                } else {
                    resultBox.className = 'result-box error';
                    resultBox.textContent = `Error:\n${data.error}`;
                }
            } catch (err) {
                resultBox.className = 'result-box error';
                resultBox.textContent = 'Execution failed. Check connection.';
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
