const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const activeDockerServices = {};

const app = express();
const PORT = process.env.PORT || 3000;
const SERVICES_DIR = path.join(__dirname, 'services');
const TMP_DIR = path.join(SERVICES_DIR, 'tmp');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve temp output files so the frontend can fetch them
app.use('/api/tmp', express.static(TMP_DIR));

// Setup multer for service upload (binary + config)
const serviceUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, SERVICES_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const serviceUpload = multer({ storage: serviceUploadStorage });

// Setup multer for execution file arguments (stored in per-execution temp dirs)
// We use memoryStorage here and write to the temp dir manually so we control the path
const executionUpload = multer({ storage: multer.memoryStorage() });

// Ensure directories exist
(async () => {
    await fs.mkdir(SERVICES_DIR, { recursive: true });
    await fs.mkdir(TMP_DIR, { recursive: true });
})().catch(console.error);

// ── Helpers ──

/**
 * Create a unique temporary directory for a single execution.
 * Returns the absolute path to the created directory and its basename.
 */
async function createExecTmpDir() {
    const id = crypto.randomBytes(8).toString('hex');
    const dirPath = path.join(TMP_DIR, id);
    await fs.mkdir(dirPath, { recursive: true });
    return { dirPath, id };
}

/**
 * Schedule cleanup of a temp directory after a delay.
 */
function scheduleCleanup(dirPath, delayMs = 60000) {
    setTimeout(async () => {
        try {
            await fs.rm(dirPath, { recursive: true, force: true });
        } catch (e) {
            console.error(`Cleanup failed for ${dirPath}:`, e.message);
        }
    }, delayMs);
}

/**
 * Validate service name to prevent directory traversal.
 */
function isValidServiceName(name) {
    return name && !name.includes('/') && !name.includes('\\') && !name.includes('..');
}

// ── 1. Get all available services ──
app.get('/api/services', async (req, res) => {
    try {
        const files = await fs.readdir(SERVICES_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const services = [];
        for (const file of jsonFiles) {
            const content = await fs.readFile(path.join(SERVICES_DIR, file), 'utf-8');
            try {
                const parsed = JSON.parse(content);
                if (parsed.type === 'docker') {
                    parsed.status = activeDockerServices[parsed.name] ? 'running' : 'stopped';
                    if (activeDockerServices[parsed.name]) {
                        parsed.activePort = activeDockerServices[parsed.name].port;
                    }
                }
                services.push(parsed);
            } catch (e) {
                console.error(`Error parsing ${file}:`, e);
            }
        }
        res.json({ success: true, services });
    } catch (error) {
        console.error('Error reading services:', error);
        res.status(500).json({ success: false, error: 'Failed to read services' });
    }
});

// ── 2. Execute a service (supports text, number, file, and output_file args) ──
app.post('/api/execute/:serviceName', executionUpload.any(), async (req, res) => {
    const { serviceName } = req.params;

    if (!isValidServiceName(serviceName)) {
        return res.status(400).json({ success: false, error: 'Invalid service name' });
    }

    let tmpDir = null;

    try {
        // Read service configuration
        const configPath = path.join(SERVICES_DIR, `${serviceName}.json`);
        const binaryPath = path.join(SERVICES_DIR, serviceName);

        let configData;
        try {
            const content = await fs.readFile(configPath, 'utf-8');
            configData = JSON.parse(content);
        } catch (e) {
            return res.status(404).json({ success: false, error: 'Service configuration not found.' });
        }

        // Determine if we need a temp directory (any file or output_file args)
        const hasFileArgs = configData.args && configData.args.some(
            a => a.type === 'file' || a.type === 'output_file'
        );

        if (hasFileArgs) {
            tmpDir = await createExecTmpDir();
        }

        // Build the uploaded files map: fieldname -> file info
        const uploadedFiles = {};
        if (req.files) {
            for (const f of req.files) {
                uploadedFiles[f.fieldname] = f;
            }
        }

        // Prepare arguments in the order defined by config
        const args = [];
        const outputFiles = []; // Track output file paths for response

        for (const argDef of (configData.args || [])) {
            const argType = argDef.type || 'text';

            if (argType === 'text' || argType === 'number') {
                // Text/number: read from body fields (multipart form fields)
                const val = req.body[argDef.id];
                if (val === undefined || val === null || val === '') {
                    return res.status(400).json({ success: false, error: `Missing required argument: ${argDef.id}` });
                }
                args.push(String(val));

            } else if (argType === 'file') {
                // File: write uploaded buffer to temp dir, pass the path
                const uploaded = uploadedFiles[argDef.id];
                if (!uploaded) {
                    return res.status(400).json({ success: false, error: `Missing required file: ${argDef.id}` });
                }
                const ext = path.extname(uploaded.originalname) || '';
                const safeName = `${argDef.id}${ext}`;
                const filePath = path.join(tmpDir.dirPath, safeName);
                await fs.writeFile(filePath, uploaded.buffer);
                args.push(filePath);

            } else if (argType === 'output_file') {
                // Output file: generate a temp path for the binary to write to
                const ext = argDef.extension || '.out';
                const safeName = `${argDef.id}${ext}`;
                const filePath = path.join(tmpDir.dirPath, safeName);
                args.push(filePath);
                outputFiles.push({
                    id: argDef.id,
                    label: argDef.label || argDef.id,
                    path: filePath,
                    relativePath: `${tmpDir.id}/${safeName}`,
                    extension: ext
                });
            }
        }

        // Determine command and arguments (support execution wrappers like mpirun)
        let command = binaryPath;
        let execArgs = args;
        const execution = configData.execution;

        if (execution && execution.wrapper) {
            command = execution.wrapper;
            execArgs = [...(execution.wrapperArgs || []), binaryPath, ...args];
        }

        // Determine timeout (default 30s, configurable per-service)
        const timeout = (configData.timeout || 30) * 1000;

        // Execute
        execFile(command, execArgs, { timeout, maxBuffer: 10 * 1024 * 1024 }, async (error, stdout, stderr) => {
            if (error) {
                console.error(`Execution error for ${serviceName}:`, error);
                if (tmpDir) scheduleCleanup(tmpDir.dirPath, 5000);
                return res.status(500).json({ success: false, error: stderr || error.message });
            }

            // Build response
            const response = {
                success: true,
                result: stdout.trim(),
                stderr: stderr.trim()
            };

            // Check which output files were actually created
            if (outputFiles.length > 0) {
                const createdFiles = [];
                for (const of of outputFiles) {
                    try {
                        await fs.access(of.path);
                        // Determine MIME type hint from extension
                        const mimeType = getMimeType(of.extension);
                        createdFiles.push({
                            id: of.id,
                            label: of.label,
                            url: `/api/tmp/${of.relativePath}`,
                            mimeType,
                            extension: of.extension
                        });
                    } catch (e) {
                        // Output file was not created by the binary — skip
                        console.warn(`Output file not created: ${of.path}`);
                    }
                }
                response.outputFiles = createdFiles;

                // Schedule cleanup after 5 minutes to give the user time to download
                if (tmpDir) scheduleCleanup(tmpDir.dirPath, 300000);
            } else {
                if (tmpDir) scheduleCleanup(tmpDir.dirPath, 5000);
            }

            res.json(response);
        });

    } catch (error) {
        console.error(`Server error executing ${serviceName}:`, error);
        if (tmpDir) scheduleCleanup(tmpDir.dirPath, 5000);
        res.status(500).json({ success: false, error: 'Internal server error during execution' });
    }
});

// ── 3. Upload a new service (binary + config) ──
app.post('/api/upload', serviceUpload.fields([
    { name: 'config', maxCount: 1 },
    { name: 'binary', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.config || !req.files.binary) {
            return res.status(400).json({ success: false, error: 'Both config and payload files are required.' });
        }

        const binaryFile = req.files.binary[0];
        const configPath = req.files.config[0].path;

        const configContent = await fs.readFile(configPath, 'utf-8');
        let configData;
        try {
            configData = JSON.parse(configContent);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Invalid config JSON file.' });
        }

        if (configData.type === 'docker') {
            const zipPath = binaryFile.path;
            const targetDir = path.join(SERVICES_DIR, configData.name);

            // Delete target dir if exists to clean up old files
            await fs.rm(targetDir, { recursive: true, force: true });
            await fs.mkdir(targetDir, { recursive: true });

            const zip = new AdmZip(zipPath);
            zip.extractAllTo(targetDir, true);

            // Delete the zip file after extraction
            await fs.unlink(zipPath);
        } else {
            // Ensure binary has execute permissions
            const binaryPath = path.join(SERVICES_DIR, binaryFile.originalname);
            await fs.chmod(binaryPath, 0o755);
        }

        res.json({ success: true, message: 'Service uploaded successfully.' });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: 'Failed to complete upload' });
    }
});

// ── Docker App Control Endpoints ──
app.post('/api/docker/:serviceName/up', async (req, res) => {
    const { serviceName } = req.params;
    if (!isValidServiceName(serviceName)) return res.status(400).json({ success: false, error: 'Invalid name' });

    const configPath = path.join(SERVICES_DIR, `${serviceName}.json`);
    const appDir = path.join(SERVICES_DIR, serviceName);

    try {
        const configData = JSON.parse(await fs.readFile(configPath, 'utf-8'));
        if (configData.type !== 'docker') {
            return res.status(400).json({ success: false, error: 'Not a docker service' });
        }

        const composePath = path.join(appDir, 'docker-compose.yml');
        await fs.access(composePath);

        execFile('docker', ['compose', '-f', composePath, 'up', '-d', '--build'], { cwd: appDir }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error starting docker app ${serviceName}:`, stderr || error);
                return res.status(500).json({ success: false, error: stderr || error.message });
            }

            activeDockerServices[serviceName] = { port: configData.port || 8080 };
            res.json({ success: true, message: 'Docker app started successfully', port: activeDockerServices[serviceName].port });
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Failed to start docker app. Make sure docker-compose.yml exists.' });
    }
});

app.post('/api/docker/:serviceName/down', async (req, res) => {
    const { serviceName } = req.params;
    if (!isValidServiceName(serviceName)) return res.status(400).json({ success: false, error: 'Invalid name' });

    const appDir = path.join(SERVICES_DIR, serviceName);

    try {
        const composePath = path.join(appDir, 'docker-compose.yml');

        execFile('docker', ['compose', '-f', composePath, 'down'], { cwd: appDir }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error stopping docker app ${serviceName}:`, stderr || error);
                return res.status(500).json({ success: false, error: stderr || error.message });
            }

            delete activeDockerServices[serviceName];
            res.json({ success: true, message: 'Docker app stopped successfully' });
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Failed to stop docker app.' });
    }
});

// ── 4. Delete a service ──
app.delete('/api/services/:serviceName', async (req, res) => {
    const { serviceName } = req.params;
    try {
        if (!isValidServiceName(serviceName)) {
            return res.status(400).json({ success: false, error: 'Invalid service name' });
        }

        const configPath = path.join(SERVICES_DIR, `${serviceName}.json`);
        const binaryPath = path.join(SERVICES_DIR, serviceName);

        // Ensure config exists before deleting
        let configData;
        try {
            configData = JSON.parse(await fs.readFile(configPath, 'utf-8'));
        } catch (e) {
            return res.status(404).json({ success: false, error: 'Service not found.' });
        }

        if (configData.type === 'docker') {
            const composePath = path.join(binaryPath, 'docker-compose.yml');
            try {
                await new Promise((resolve) => {
                    execFile('docker', ['compose', '-f', composePath, 'down'], { cwd: binaryPath }, () => resolve());
                });
            } catch (e) { }

            delete activeDockerServices[serviceName];

            await fs.unlink(configPath);
            try {
                await fs.rm(binaryPath, { recursive: true, force: true });
            } catch (e) {
                console.error(`Warning: app folder for ${serviceName} not found during deletion.`);
            }
        } else {
            // Delete files
            await fs.unlink(configPath);
            try {
                await fs.unlink(binaryPath);
            } catch (e) {
                console.error(`Warning: binary for ${serviceName} not found during deletion.`);
            }
        }

        res.json({ success: true, message: 'Service deleted successfully.' });
    } catch (error) {
        console.error('Error deleting service:', error);
        res.status(500).json({ success: false, error: 'Failed to delete service.' });
    }
});

// ── Utility ──

function getMimeType(ext) {
    const map = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.zip': 'application/zip',
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
