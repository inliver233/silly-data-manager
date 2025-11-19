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
    const linuxdoId = typeof request.query.linuxdoId === 'string' ? request.query.linuxdoId : null;
    const linuxdoUsername = typeof request.query.linuxdoUsername === 'string' ? request.query.linuxdoUsername : null;

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
        if (linuxdoId && String(record.linuxdo?.id) !== linuxdoId) {
            return false;
        }
        if (linuxdoUsername && record.linuxdo?.username !== linuxdoUsername) {
            return false;
        }
        return true;
    });

    return response.json({
        ok: true,
        logs: filtered.slice(0, limit),
    });
});

adminRouter.get('/users', requireAdminWithCsrf, (request, response) => {
    const logsDir = getLogsDirectoryForAdmin();
    if (!fs.existsSync(logsDir)) {
        return response.json({ ok: true, users: [] });
    }

    const files = fs.readdirSync(logsDir).filter(name => name.endsWith('.log'));

    /** @type {Record<string, any>} */
    const usersMap = {};

    for (const fileName of files) {
        const filePath = path.join(logsDir, fileName);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }
            let record;
            try {
                record = JSON.parse(line);
            } catch {
                continue;
            }

            const linuxdo = record.linuxdo || {};
            const stHandle = record.stHandle || null;
            const key = `${linuxdo.id || 'unknown'}|${stHandle || ''}`;

            if (!usersMap[key]) {
                usersMap[key] = {
                    linuxdoId: linuxdo.id || null,
                    linuxdoUsername: linuxdo.username || null,
                    linuxdoName: linuxdo.name || null,
                    trustLevel: linuxdo.trust_level ?? null,
                    handles: new Set(),
                    firstSeen: record.timestamp || null,
                    lastSeen: record.timestamp || null,
                    uploads: 0,
                    rollbacks: 0,
                    logins: 0,
                    handleChanges: 0,
                };
            }

            const entry = usersMap[key];

            if (stHandle) {
                entry.handles.add(stHandle);
            }

            const ts = record.timestamp || null;
            if (ts) {
                if (!entry.firstSeen || ts < entry.firstSeen) {
                    entry.firstSeen = ts;
                }
                if (!entry.lastSeen || ts > entry.lastSeen) {
                    entry.lastSeen = ts;
                }
            }

            if (record.type === 'upload') {
                entry.uploads += 1;
            } else if (record.type === 'rollback') {
                entry.rollbacks += 1;
            } else if (record.type === 'login') {
                entry.logins += 1;
            } else if (record.type === 'handle-change') {
                entry.handleChanges += 1;
            }
        }
    }

    const users = Object.values(usersMap).map(entry => ({
        linuxdoId: entry.linuxdoId,
        linuxdoUsername: entry.linuxdoUsername,
        linuxdoName: entry.linuxdoName,
        trustLevel: entry.trustLevel,
        handles: Array.from(entry.handles),
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        uploads: entry.uploads,
        rollbacks: entry.rollbacks,
        logins: entry.logins,
        handleChanges: entry.handleChanges,
    }));

    users.sort((a, b) => {
        const ta = new Date(a.lastSeen || 0).getTime();
        const tb = new Date(b.lastSeen || 0).getTime();
        return tb - ta;
    });

    return response.json({ ok: true, users });
});
