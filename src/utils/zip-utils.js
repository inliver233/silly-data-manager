import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import unzipper from 'unzipper';

import { ensureDirectorySync, isPathUnderParent } from './fs-utils.js';

export async function zipDirectoryToFile(sourceDir, targetZipPath) {
    await new Promise((resolve, reject) => {
        ensureDirectorySync(path.dirname(targetZipPath));

        const output = fs.createWriteStream(targetZipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

export async function extractZipSafely(zipPath, extractRoot, options = {}) {
    const { maxTotalSize = 500 * 1024 * 1024 } = options;

    ensureDirectorySync(extractRoot);

    let totalSize = 0;

    const stream = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));

    // eslint-disable-next-line no-restricted-syntax
    for await (const entry of stream) {
        const fileName = entry.path;
        const type = entry.type;

        const targetPath = path.join(extractRoot, fileName);
        if (!isPathUnderParent(extractRoot, targetPath)) {
            entry.autodrain();
            throw new Error('Zip entry outside of extraction root (possible Zip Slip attack)');
        }

        if (type === 'Directory') {
            ensureDirectorySync(targetPath);
            entry.autodrain();
            // eslint-disable-next-line no-continue
            continue;
        }

        ensureDirectorySync(path.dirname(targetPath));

        await new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(targetPath);
            entry.on('data', chunk => {
                totalSize += chunk.length;
                if (totalSize > maxTotalSize) {
                    writeStream.destroy();
                    reject(new Error('Uncompressed size exceeds allowed limit'));
                }
            });
            entry.on('error', reject);
            writeStream.on('error', reject);
            writeStream.on('finish', resolve);
            entry.pipe(writeStream);
        });
    }
}

