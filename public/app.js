document.addEventListener('DOMContentLoaded', () => {
    fetchServices();

    // Modal logic
    const modal = document.getElementById('uploadModal');
    const openBtn = document.getElementById('openUploadBtn');
    const closeBtn = document.querySelector('.close-btn');

    openBtn.onclick = () => modal.classList.add('show');
    closeBtn.onclick = () => modal.classList.remove('show');
    window.onclick = (e) => {
        if (e.target === modal) modal.classList.remove('show');
    };

    // Upload logic
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
                // Refresh services list after short delay
                setTimeout(() => {
                    modal.classList.remove('show');
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
});

async function fetchServices() {
    const grid = document.getElementById('servicesGrid');
    grid.innerHTML = '<p>Loading services...</p>';

    try {
        const res = await fetch('/api/services');
        const data = await res.json();

        if (data.success) {
            if (data.services.length === 0) {
                grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted)">No services found. Upload one to get started!</p>';
                return;
            }
            grid.innerHTML = '';
            data.services.forEach((service, index) => {
                const card = createServiceCard(service, index);
                grid.appendChild(card);
            });
        }
    } catch (err) {
        grid.innerHTML = '<p class="error">Failed to load services.</p>';
        console.error(err);
    }
}

function createServiceCard(service, index) {
    const card = document.createElement('div');
    card.className = 'service-card';
    card.style.animationDelay = `${index * 0.1}s`;

    let formHtml = `<form id="form-${service.name}">`;
    
    if (service.args && service.args.length > 0) {
        service.args.forEach(arg => {
            const inputType = arg.type === 'number' ? 'number' : 'text';
            const step = arg.type === 'number' ? 'any' : ''; // Allow decimals if number
            formHtml += `
                <div class="form-group">
                    <label for="${service.name}-${arg.id}">${arg.label}</label>
                    <input type="${inputType}" id="${service.name}-${arg.id}" name="${arg.id}" step="${step}" required placeholder="Enter ${arg.label.toLowerCase()}">
                </div>
            `;
        });
    }

    formHtml += `
            <button type="submit" class="btn btn-primary full-width">Execute</button>
        </form>
        <div id="result-${service.name}" class="result-box"></div>
    `;

    card.innerHTML = `
        <button class="delete-btn" aria-label="Delete service" title="Delete service">&times;</button>
        <h2>${service.name}</h2>
        <p>${service.description}</p>
        ${formHtml}
    `;

    // Add delete event listener
    const deleteBtn = card.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to delete the "${service.name}" service?`)) {
            try {
                const res = await fetch(`/api/services/${service.name}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    card.style.animation = 'fadeInUp 0.3s ease-out reverse forwards';
                    setTimeout(() => {
                        card.remove();
                        if (document.querySelectorAll('.service-card').length === 0) {
                            fetchServices();
                        }
                    }, 300);
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (err) {
                alert('Network error while deleting service.');
            }
        }
    });

    // Add submit event listener
    const form = card.querySelector(`#form-${service.name}`);
    const resultBox = card.querySelector(`#result-${service.name}`);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const dataObj = Object.fromEntries(formData.entries());

        resultBox.className = 'result-box'; // reset
        resultBox.style.display = 'block';
        resultBox.textContent = 'Executing...';
        resultBox.style.color = 'var(--text-muted)';

        try {
            const res = await fetch(`/api/execute/${service.name}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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

    return card;
}
