const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const SERVICES_DIR = path.join(__dirname, 'services');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Setup multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, SERVICES_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

// Ensure services directory exists
fs.mkdir(SERVICES_DIR, { recursive: true }).catch(console.error);

// 1. Get all available services and their input forms
app.get('/api/services', async (req, res) => {
    try {
        const files = await fs.readdir(SERVICES_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const services = [];
        for (const file of jsonFiles) {
            const content = await fs.readFile(path.join(SERVICES_DIR, file), 'utf-8');
            try {
                const parsed = JSON.parse(content);
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

// 2. Execute a given service
app.post('/api/execute/:serviceName', async (req, res) => {
    const { serviceName } = req.params;
    const params = req.body; // Map of argument id -> value

    try {
        // Read configuration to determine argument order
        const configPath = path.join(SERVICES_DIR, `${serviceName}.json`);
        const binaryPath = path.join(SERVICES_DIR, serviceName);

        // Basic security check: prevent directory traversal
        if (serviceName.includes('/') || serviceName.includes('..')) {
            return res.status(400).json({ success: false, error: 'Invalid service name' });
        }

        let configData;
        try {
            const content = await fs.readFile(configPath, 'utf-8');
            configData = JSON.parse(content);
        } catch (e) {
            return res.status(404).json({ success: false, error: 'Service configuration not found.' });
        }

        // Prepare arguments in the correct order
        const args = [];
        for (const argDef of configData.args) {
            const val = params[argDef.id];
            if (val === undefined || val === null) {
                return res.status(400).json({ success: false, error: `Missing required argument: ${argDef.id}` });
            }
            args.push(String(val));
        }

        // Execute the binary securely
        execFile(binaryPath, args, { timeout: 5000 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Execution error for ${serviceName}:`, error);
                // Return exactly what the program errored with or stderr
                return res.status(500).json({ success: false, error: stderr || error.message });
            }
            res.json({ success: true, result: stdout.trim(), stderr: stderr.trim() });
        });

    } catch (error) {
        console.error(`Server error executing ${serviceName}:`, error);
        res.status(500).json({ success: false, error: 'Internal server error during execution' });
    }
});

// 3. Upload a new service (binary + config)
app.post('/api/upload', upload.fields([
    { name: 'config', maxCount: 1 },
    { name: 'binary', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.config || !req.files.binary) {
            return res.status(400).json({ success: false, error: 'Both config and binary files are required.' });
        }

        const binaryFile = req.files.binary[0];

        // Ensure binary has execute permissions
        const binaryPath = path.join(SERVICES_DIR, binaryFile.originalname);
        await fs.chmod(binaryPath, 0o755);

        res.json({ success: true, message: 'Service uploaded successfully.' });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: 'Failed to complete upload' });
    }
});

// 4. Delete a service
app.delete('/api/services/:serviceName', async (req, res) => {
    const { serviceName } = req.params;
    try {
        if (serviceName.includes('/') || serviceName.includes('..')) {
            return res.status(400).json({ success: false, error: 'Invalid service name' });
        }
        
        const configPath = path.join(SERVICES_DIR, `${serviceName}.json`);
        const binaryPath = path.join(SERVICES_DIR, serviceName);
        
        // Ensure config exists before deleting
        await fs.access(configPath);
        
        // Delete files
        await fs.unlink(configPath);
        try {
            await fs.unlink(binaryPath);
        } catch(e) {
            console.error(`Warning: binary for ${serviceName} not found during deletion.`);
        }
        
        res.json({ success: true, message: 'Service deleted successfully.' });
    } catch (error) {
        console.error('Error deleting service:', error);
        res.status(500).json({ success: false, error: 'Failed to delete service.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
