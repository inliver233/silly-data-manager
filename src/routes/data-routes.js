import express from 'express';
import multer from 'multer';
import path from 'node:path';

import config from '../config.js';
import { requireLogin } from '../middleware/auth.js';
import { getUserDataStatus, processUpload, rollbackLastUpload } from '../services/data-service.js';
import { ensureDirectorySync } from '../utils/fs-utils.js';

export const dataRouter = express.Router();

dataRouter.get('/status', requireLogin, (request, response) => {
    const handle = request.user.stHandle;
    const status = getUserDataStatus(handle);
    return response.json(status);
});

const uploadsRoot = path.join(config.dataRoot, '_upload_temp_files');
ensureDirectorySync(uploadsRoot);

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadsRoot),
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
    }),
    limits: {
        fileSize: 100 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
        const isZip = file.mimetype === 'application/zip' || file.originalname.toLowerCase().endsWith('.zip');
        if (!isZip) {
            return cb(new Error('Only .zip files are allowed'));
        }
        return cb(null, true);
    },
});

dataRouter.post('/upload', requireLogin, upload.single('dataZip'), async (request, response) => {
    request._clientIp = request._clientIp || request.ip;
    request._userAgent = request._userAgent || request.headers['user-agent'];

    try {
        const result = await processUpload(request, request.user.stHandle);
        return response.json({
            ok: true,
            result,
        });
    } catch (error) {
        // @ts-ignore
        const statusCode = error.statusCode || 500;
        const payload = {
            ok: false,
            message: error.message || 'Upload failed',
        };

        // @ts-ignore
        if (error.details) {
            // @ts-ignore
            payload.details = error.details;
        }

        return response.status(statusCode).json(payload);
    }
});

dataRouter.post('/rollback', requireLogin, async (request, response) => {
    request._clientIp = request._clientIp || request.ip;
    request._userAgent = request._userAgent || request.headers['user-agent'];

    try {
        const result = await rollbackLastUpload(request, request.user.stHandle);
        return response.json({
            ok: true,
            result,
        });
    } catch (error) {
        // @ts-ignore
        const statusCode = error.statusCode || 500;
        return response.status(statusCode).json({
            ok: false,
            message: error.message || 'Rollback failed',
        });
    }
});
