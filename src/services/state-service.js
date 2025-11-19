import path from 'node:path';

import config from '../config.js';
import { ensureDirectorySync, readJsonSafe, writeJsonAtomicSync } from '../utils/fs-utils.js';

function getStateFilePath() {
    return path.join(config.dataRoot, '_upload_service', 'state.json');
}

function loadState() {
    const filePath = getStateFilePath();
    return readJsonSafe(filePath, { handles: {} });
}

function saveState(state) {
    const filePath = getStateFilePath();
    ensureDirectorySync(path.dirname(filePath));
    writeJsonAtomicSync(filePath, state);
}

export function getLastUploadForHandle(handle) {
    const state = loadState();
    return state.handles[handle] || null;
}

export function updateLastUploadForHandle(handle, payload) {
    const state = loadState();
    state.handles[handle] = payload;
    saveState(state);
}

