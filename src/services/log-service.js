import path from 'node:path';
import process from 'node:process';

import config from '../config.js';
import { appendJsonLineSync, ensureDirectorySync } from '../utils/fs-utils.js';

function getLogsDirectory() {
    return path.join(config.dataRoot, '_upload_service', 'logs');
}

function getMonthlyLogPath(timestamp) {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const fileName = `${year}-${month}.log`;
    return path.join(getLogsDirectory(), fileName);
}

export function writeOperationLog(record) {
    const timestamp = record.timestamp || new Date().toISOString();
    const fullRecord = {
        ...record,
        timestamp,
    };

    const logPath = getMonthlyLogPath(timestamp);
    ensureDirectorySync(getLogsDirectory());
    appendJsonLineSync(logPath, fullRecord);
}

export function getClientIp(request) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }

    return request.ip || request.connection?.remoteAddress || '';
}

export function getUserAgent(request) {
    return request.headers['user-agent'] || '';
}

export function getLogsDirectoryForAdmin() {
    return getLogsDirectory();
}

export function getProcessInfo() {
    return {
        pid: process.pid,
        node: process.version,
    };
}

