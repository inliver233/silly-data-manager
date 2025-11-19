import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import config from '../config.js';
import { requireAdminWithCsrf } from '../middleware/auth.js';
import { getLogsDirectoryForAdmin } from '../services/log-service.js';

export const adminRouter = express.Router();

adminRouter.post('/login', (request, response) => {
    const { username, password } = request.body || {};

    if (!username || !password) {
        return response.status(400).json({ ok: false, message: 'Missing username or password' });
    }

    if (username !== config.admin.username || password !== config.admin.password) {
        return response.status(403).json({ ok: false, message: 'Invalid admin credentials' });
    }

    request.session.isAdmin = true;
    if (!request.session.csrfToken) {
        request.session.csrfToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }

    return response.json({ ok: true, csrfToken: request.session.csrfToken });
});

adminRouter.post('/logout', requireAdminWithCsrf, (request, response) => {
    request.session.isAdmin = false;
    request.session.csrfToken = undefined;
    return response.json({ ok: true });
});

adminRouter.get('/logs', requireAdminWithCsrf, (request, response) => {
    const limit = Number.parseInt(String(request.query.limit || '100'), 10);
    const type = typeof request.query.type === 'string' ? request.query.type : null;
    const handle = typeof request.query.handle === 'string' ? request.query.handle : null;

    const logsDir = getLogsDirectoryForAdmin();
    if (!fs.existsSync(logsDir)) {
        return response.json({ ok: true, logs: [] });
    }

    const files = fs.readdirSync(logsDir).filter(name => name.endsWith('.log'));

    /** @type {any[]} */
    const records = [];

    for (const fileName of files) {
        const filePath = path.join(logsDir, fileName);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }
            try {
                const record = JSON.parse(line);
                records.push(record);
            } catch {
                // ignore parse errors
            }
        }
    }

    records.sort((a, b) => {
        const ta = new Date(a.timestamp || 0).getTime();
        const tb = new Date(b.timestamp || 0).getTime();
        return tb - ta;
    });

    const filtered = records.filter(record => {
        if (type && record.type !== type) {
            return false;
        }
        if (handle && record.stHandle !== handle) {
            return false;
        }
        return true;
    });

    return response.json({
        ok: true,
        logs: filtered.slice(0, limit),
    });
});
