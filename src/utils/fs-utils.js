import fs from 'node:fs';
import path from 'node:path';

export function ensureDirectorySync(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

export function isPathUnderParent(parent, candidate) {
    const parentPath = path.resolve(parent);
    const candidatePath = path.resolve(candidate);

    if (parentPath === candidatePath) {
        return true;
    }

    const withSep = parentPath.endsWith(path.sep) ? parentPath : parentPath + path.sep;
    return candidatePath.startsWith(withSep);
}

export function calculateDirectorySize(rootDir) {
    let total = 0;

    if (!fs.existsSync(rootDir)) {
        return 0;
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
                total += stat.size;
            }
        }
    }

    return total;
}

export function appendJsonLineSync(filePath, record) {
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(filePath, line, { encoding: 'utf8' });
}

export function readJsonSafe(filePath, fallback) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch {
        return fallback;
    }
}

export function writeJsonAtomicSync(filePath, data) {
    const tmpPath = `${filePath}.tmp`;
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmpPath, json, { encoding: 'utf8' });
    fs.renameSync(tmpPath, filePath);
}

