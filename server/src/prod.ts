import express from "express";
import app from './app.js';
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
    const port = process.env.PORT || 5000;

    // Serve pre-built client files (npm run build)
    const clientDistPath = path.resolve(__dirname, "../../client/dist");
    app.use(express.static(clientDistPath));
    
    // Handle client-side routing - serve index.html for non-API routes
    app.get('*', (req, res) => {
        // Only serve index.html for non-API routes
        if (!req.path.startsWith('/api') && !req.path.startsWith('/health')) {
            res.sendFile(path.join(clientDistPath, 'index.html'));
        }
    });

    app.listen(port, () => {
        console.log(`🚀 Production server running on http://localhost:${port}`);
        console.log(`📁 Serving static files from: ${clientDistPath}`);
    });
})();
