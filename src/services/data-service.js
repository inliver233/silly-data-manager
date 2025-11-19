import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import config from '../config.js';
import { calculateDirectorySize, ensureDirectorySync } from '../utils/fs-utils.js';
import { extractZipSafely, zipDirectoryToFile } from '../utils/zip-utils.js';
import { MERGE_DIRECTORIES, UNSAFE_EXTENSIONS } from '../constants.js';
import { getLastUploadForHandle, updateLastUploadForHandle } from './state-service.js';
import { writeOperationLog } from './log-service.js';

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
const MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024;

function getUserRoot(handle) {
    return path.join(config.dataRoot, handle);
}

function getUserTempRoot(linuxdoUser) {
    const key = linuxdoUser?.username || String(linuxdoUser?.id || 'unknown');
    const root = path.join(config.tempRoot, key);
    ensureDirectorySync(root);
    return root;
}

function getUserBackupsDir(handle, linuxdoUser) {
    const userRoot = getUserTempRoot(linuxdoUser);
    const backupsRoot = path.join(userRoot, 'backups', handle);
    ensureDirectorySync(backupsRoot);
    return backupsRoot;
}

function getUploadTempDir(linuxdoUser) {
    const userRoot = getUserTempRoot(linuxdoUser);
    const base = path.join(userRoot, 'extract');
    ensureDirectorySync(base);
    return base;
}

export function getUploadBackups(handle, linuxdoUser, maxAgeMs = 24 * 60 * 60 * 1000) {
    const backupsDir = getUserBackupsDir(handle, linuxdoUser);
    if (!fs.existsSync(backupsDir)) {
        return [];
    }

    const now = Date.now();
    const entries = fs.readdirSync(backupsDir);
    const backups = [];

    for (const name of entries) {
        if (!name.startsWith('upload_') || !name.endsWith('.zip')) {
            continue;
        }
        const fullPath = path.join(backupsDir, name);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch {
            continue;
        }

        const ageMs = now - stat.mtimeMs;
        if (ageMs > maxAgeMs) {
            try {
                fs.unlinkSync(fullPath);
            } catch {
                // ignore cleanup errors
            }
            continue;
        }

        backups.push({
            name,
            path: fullPath,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
        });
    }

    backups.sort((a, b) => {
        const ta = new Date(a.mtime).getTime();
        const tb = new Date(b.mtime).getTime();
        return tb - ta;
    });

    return backups;
}

export function getBackupFileForHandle(handle, linuxdoUser, backupName) {
    if (!backupName || typeof backupName !== 'string') {
        return null;
    }

    if (backupName.includes('/') || backupName.includes('\\')) {
        return null;
    }

    if (!backupName.startsWith('upload_') || !backupName.endsWith('.zip')) {
        return null;
    }

    const backupsDir = getUserBackupsDir(handle, linuxdoUser);
    const fullPath = path.join(backupsDir, backupName);

    if (!fs.existsSync(fullPath)) {
        return null;
    }

    let stat;
    try {
        stat = fs.statSync(fullPath);
    } catch {
        return null;
    }

    return {
        name: backupName,
        path: fullPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
    };
}

export function deleteBackupFileForHandle(handle, linuxdoUser, backupName) {
    const info = getBackupFileForHandle(handle, linuxdoUser, backupName);
    if (!info) {
        return false;
    }

    try {
        fs.unlinkSync(info.path);
        return true;
    } catch {
        return false;
    }
}

export function getUserDataStatus(handle) {
    if (!handle) {
        return {
            handle,
            exists: false,
            path: null,
            size: 0,
            mtime: null,
            keyFiles: {
                settingsJson: false,
                secretsJson: false,
                statsJson: false,
                contentLog: false,
            },
            lastUpload: null,
        };
    }

    const root = getUserRoot(handle);
    const exists = fs.existsSync(root);

    const stats = exists ? fs.statSync(root) : null;
    const size = exists ? calculateDirectorySize(root) : 0;

    const keyFiles = {
        settingsJson: exists && fs.existsSync(path.join(root, 'settings.json')),
        secretsJson: exists && fs.existsSync(path.join(root, 'secrets.json')),
        statsJson: exists && fs.existsSync(path.join(root, 'stats.json')),
        contentLog: exists && fs.existsSync(path.join(root, 'content.log')),
    };

    const lastUpload = getLastUploadForHandle(handle);

    let rollback = null;
    if (lastUpload && lastUpload.backupZipPath) {
        const backupPath = lastUpload.backupZipPath;
        let backupExists = false;
        let backupSize = null;
        let backupMtime = null;

        try {
            if (fs.existsSync(backupPath)) {
                const stat = fs.statSync(backupPath);
                backupExists = true;
                backupSize = stat.size;
                backupMtime = stat.mtime.toISOString();
            }
        } catch {
            // ignore stat errors
        }

        rollback = {
            canRollback: Boolean(backupExists),
            backupPath,
            backupSize,
            backupMtime,
            uploadTimestamp: lastUpload.timestamp || null,
        };
    }

    return {
        handle,
        exists,
        path: root,
        size,
        mtime: stats ? stats.mtime.toISOString() : null,
        keyFiles,
        lastUpload,
        rollback,
    };
}

function looksLikeUserRoot(userRoot) {
    const hasSettings = fs.existsSync(path.join(userRoot, 'settings.json'));
    const hasCharacters = fs.existsSync(path.join(userRoot, 'characters'));
    const hasChats = fs.existsSync(path.join(userRoot, 'chats'));
    const hasBackups = fs.existsSync(path.join(userRoot, 'backups'));

    return hasSettings && (hasCharacters || hasChats || hasBackups);
}

function detectStructure(extractRoot, handle) {
    const userRoot = extractRoot;

    if (looksLikeUserRoot(userRoot)) {
        return {
            type: 'user_root',
            sourceUserRoot: userRoot,
            sourceHandle: null,
        };
    }

    const dataDir = path.join(extractRoot, 'data');
    if (fs.existsSync(dataDir)) {
        const preferred = path.join(dataDir, handle);
        if (fs.existsSync(preferred) && looksLikeUserRoot(preferred)) {
            return {
                type: 'data_dir',
                sourceUserRoot: preferred,
                sourceHandle: handle,
            };
        }

        const entries = fs.readdirSync(dataDir, { withFileTypes: true });
        const ignored = new Set([
            '_cache',
            '_storage',
            '_uploads',
            '_webpack',
            'system-monitor',
            'forum_data',
            'public_characters',
            'announcements',
        ]);

        /** @type {{ name: string, fullPath: string }[]} */
        const candidates = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (ignored.has(entry.name)) {
                continue;
            }

            const fullPath = path.join(dataDir, entry.name);
            if (looksLikeUserRoot(fullPath)) {
                candidates.push({ name: entry.name, fullPath });
            }
        }

        if (candidates.length === 1) {
            return {
                type: 'data_dir',
                sourceUserRoot: candidates[0].fullPath,
                sourceHandle: candidates[0].name,
            };
        }

        if (candidates.length > 1) {
            const names = candidates.map(x => x.name).join(', ');
            throw new Error(`data.zip contains data/ with multiple user directories (${names}), and none matches target handle ${handle}`);
        }

        throw new Error(`data.zip contains a data/ directory but no valid user directory was found`);
    }

    throw new Error('Invalid data.zip structure: could not find a user root or data/ directory');
}

function collectFilesRecursively(rootDir) {
    /** @type {{ path: string, size: number }[]} */
    const files = [];

    if (!fs.existsSync(rootDir)) {
        return files;
    }

    const stack = [rootDir];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }

        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(entryPath);
            } else if (entry.isFile()) {
                const stat = fs.statSync(entryPath);
                files.push({ path: entryPath, size: stat.size });
            }
        }
    }

    return files;
}

function checkForUnsafeFiles(sourceUserRoot) {
    const files = collectFilesRecursively(sourceUserRoot);
    const unsafe = [];

    for (const file of files) {
        const ext = path.extname(file.path).toLowerCase();
        if (!UNSAFE_EXTENSIONS.includes(ext)) {
            // extension not in deny list
            // eslint-disable-next-line no-continue
            continue;
        }

        // allow some web assets inside the extensions/ directory
        const relativePath = path.relative(sourceUserRoot, file.path);
        const topLevelSegment = relativePath.split(path.sep)[0] || '';

        if (topLevelSegment === 'extensions') {
            if (ext === '.js' || ext === '.html' || ext === '.htm') {
                // these are allowed inside extensions/
                // eslint-disable-next-line no-continue
                continue;
            }
        }

        unsafe.push(file.path);
    }

    return unsafe;
}

function mergeUserData(sourceUserRoot, targetRoot, overwriteOptions) {
    const directoriesMerged = [];
    const filesOverwritten = [];

    ensureDirectorySync(targetRoot);

    for (const subdir of MERGE_DIRECTORIES) {
        const sourcePath = path.join(sourceUserRoot, subdir);
        if (fs.existsSync(sourcePath)) {
            const targetPath = path.join(targetRoot, subdir);
            ensureDirectorySync(path.dirname(targetPath));
            fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
            directoriesMerged.push(subdir);
        }
    }

    const options = overwriteOptions || {};

    const filesToMaybeOverwrite = [
        { name: 'settings.json', flag: options.overwriteSettings },
        { name: 'secrets.json', flag: options.overwriteSecrets },
        { name: 'stats.json', flag: options.overwriteStats },
        { name: 'content.log', flag: options.overwriteContentLog },
    ];

    for (const entry of filesToMaybeOverwrite) {
        if (entry.flag === false) {
            continue;
        }
        const sourcePath = path.join(sourceUserRoot, entry.name);
        if (fs.existsSync(sourcePath)) {
            const targetPath = path.join(targetRoot, entry.name);
            fs.copyFileSync(sourcePath, targetPath);
            filesOverwritten.push(entry.name);
        }
    }

    return {
        directoriesMerged,
        filesOverwritten,
    };
}

function parseBooleanFlag(value, defaultValue) {
    if (value === undefined || value === null) {
        return defaultValue;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    const str = String(value).toLowerCase();
    if (str === 'true' || str === '1' || str === 'yes' || str === 'on') {
        return true;
    }
    if (str === 'false' || str === '0' || str === 'no' || str === 'off') {
        return false;
    }
    return defaultValue;
}

function buildSimulationSummary(structure, unsafeFiles, sourceUserRoot) {
    const totalSize = calculateDirectorySize(sourceUserRoot);

    return {
        structure: structure.type,
        sourceHandle: structure.sourceHandle || null,
        sourceUserRoot,
        unsafeFiles,
        approximateUncompressedSize: totalSize,
        canProceed: unsafeFiles.length === 0 && totalSize <= MAX_UNCOMPRESSED_SIZE,
    };
}

export async function processUpload(request, handle) {
    if (!handle) {
        const invalidHandleError = new Error('Invalid handle derived from LinuxDo username');
        // @ts-ignore
        invalidHandleError.statusCode = 400;
        throw invalidHandleError;
    }

    const linuxdoUser = request.user.linuxdo;
    const ip = request._clientIp;
    const userAgent = request._userAgent;
    const file = request.file;

    if (!file) {
        throw new Error('No data.zip file received');
    }

    if (file.size > MAX_UPLOAD_SIZE) {
        const error = new Error('File too large (>100MB)');
        // @ts-ignore
        error.statusCode = 413;
        throw error;
    }

    const timestamp = new Date().toISOString();
    const operationId = crypto.randomUUID();

    const tempBase = getUploadTempDir(linuxdoUser);
    const extractRoot = path.join(tempBase, `${Date.now()}_extracted`);

    let structure;
    let unsafeFiles;

    try {
        await extractZipSafely(file.path, extractRoot, { maxTotalSize: MAX_UNCOMPRESSED_SIZE });
        structure = detectStructure(extractRoot, handle);
        unsafeFiles = checkForUnsafeFiles(structure.sourceUserRoot);

        const rawMode = typeof request.body?.mode === 'string' ? request.body.mode : null;
        let simulation;
        if (rawMode === 'simulate') {
            simulation = true;
        } else if (rawMode === 'real') {
            simulation = false;
        } else {
            simulation = parseBooleanFlag(request.body?.simulate, false);
        }
        const overwriteSettings = parseBooleanFlag(request.body?.overwriteSettings, true);
        const overwriteSecrets = parseBooleanFlag(request.body?.overwriteSecrets, true);
        const overwriteStats = parseBooleanFlag(request.body?.overwriteStats, true);
        const overwriteContentLog = parseBooleanFlag(request.body?.overwriteContentLog, true);

        const archiveInfo = {
            filename: file.originalname,
            size: file.size,
            structure: structure.type,
            sourceHandle: structure.sourceHandle || null,
            effectiveUserRoot: handle,
        };

        const simulationSummary = buildSimulationSummary(structure, unsafeFiles, structure.sourceUserRoot);

        if (simulation) {
            writeOperationLog({
                operationId,
                type: 'upload-simulate',
                linuxdo: linuxdoUser,
                stHandle: handle,
                ip,
                userAgent,
                archive: archiveInfo,
                result: unsafeFiles.length > 0 ? 'rejected' : 'success',
                reason: unsafeFiles.length > 0 ? 'Unsafe file extensions detected in simulation' : null,
                simulation: simulationSummary,
            });

            return {
                simulation: true,
                archive: archiveInfo,
                overwriteOptions: {
                    overwriteSettings,
                    overwriteSecrets,
                    overwriteStats,
                    overwriteContentLog,
                },
                summary: simulationSummary,
            };
        }

        if (unsafeFiles.length > 0) {
            writeOperationLog({
                operationId,
                type: 'upload',
                linuxdo: linuxdoUser,
                stHandle: handle,
                ip,
                userAgent,
                archive: archiveInfo,
                result: 'rejected',
                reason: 'Unsafe file extensions detected',
                details: {
                    unsafeFiles,
                },
            });

            const error = new Error('Upload rejected due to unsafe files in archive');
            // @ts-ignore
            error.statusCode = 400;
            // @ts-ignore
            error.details = { unsafeFiles };
            throw error;
        }

        const targetRoot = getUserRoot(handle);
        if (!fs.existsSync(targetRoot)) {
            const error = new Error(`Target user directory does not exist: ${targetRoot}`);
            // @ts-ignore
            error.statusCode = 400;
            throw error;
        }

        const backupsDir = getUserBackupsDir(handle, linuxdoUser);

        const backupTimestamp = timestamp.replace(/[:.]/g, '-');
        const backupZipPath = path.join(backupsDir, `upload_${backupTimestamp}.zip`);

        await zipDirectoryToFile(targetRoot, backupZipPath);

        const overwriteOptions = {
            overwriteSettings,
            overwriteSecrets,
            overwriteStats,
            overwriteContentLog,
        };

        const mergeResult = mergeUserData(structure.sourceUserRoot, targetRoot, overwriteOptions);

        const lastUpload = {
            operationId,
            timestamp,
            backupZipPath,
            archive: archiveInfo,
            mergeResult,
        };

        updateLastUploadForHandle(handle, lastUpload);

        writeOperationLog({
            operationId,
            type: 'upload',
            linuxdo: linuxdoUser,
            stHandle: handle,
            ip,
            userAgent,
            archive: archiveInfo,
            result: 'success',
            reason: null,
            backup: {
                zipPath: backupZipPath,
                snapshotPath: null,
            },
            mergeResult,
        });

        return {
            archive: archiveInfo,
            mergeResult,
            backup: {
                zipPath: backupZipPath,
            },
            lastUpload,
        };
    } finally {
        try {
            if (fs.existsSync(extractRoot)) {
                fs.rmSync(extractRoot, { recursive: true, force: true });
            }
        } catch {
            // ignore cleanup errors
        }

        try {
            if (file && file.path && fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        } catch {
            // ignore cleanup errors
        }
    }
}

export async function rollbackLastUpload(request, handle) {
    if (!handle) {
        const invalidHandleError = new Error('Invalid handle derived from LinuxDo username');
        // @ts-ignore
        invalidHandleError.statusCode = 400;
        throw invalidHandleError;
    }

    const linuxdoUser = request.user.linuxdo;
    const ip = request._clientIp;
    const userAgent = request._userAgent;

    const info = getLastUploadForHandle(handle);
    if (!info || !info.backupZipPath) {
        const error = new Error('No previous upload backup found for rollback');
        // @ts-ignore
        error.statusCode = 400;
        throw error;
    }

    const backupZipPath = info.backupZipPath;
    if (!fs.existsSync(backupZipPath)) {
        const error = new Error('Backup zip file not found on disk');
        // @ts-ignore
        error.statusCode = 410;
        throw error;
    }

    const targetRoot = getUserRoot(handle);
    const timestamp = new Date().toISOString();
    const operationId = crypto.randomUUID();

    if (fs.existsSync(targetRoot)) {
        const failedSuffix = timestamp.replace(/[:.]/g, '-');
        const failedPath = `${targetRoot}__failed_${failedSuffix}`;
        fs.renameSync(targetRoot, failedPath);
    }

    ensureDirectorySync(targetRoot);
    await extractZipSafely(backupZipPath, targetRoot, { maxTotalSize: 500 * 1024 * 1024 });

    writeOperationLog({
        operationId,
        type: 'rollback',
        linuxdo: linuxdoUser,
        stHandle: handle,
        ip,
        userAgent,
        archive: info.archive,
        result: 'success',
        reason: null,
        backup: {
            zipPath: backupZipPath,
            snapshotPath: null,
        },
    });

    return {
        operationId,
        restoredFrom: backupZipPath,
    };
}
