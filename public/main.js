async function apiGet(path) {
    const response = await fetch(path, {
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
}

async function apiPost(path, body) {
    const response = await fetch(path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: body ? JSON.stringify(body) : '{}',
    });

    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        // best-effort parse; fall through
    }

    if (!response.ok) {
        const message = (json && json.message) ? json.message : (text || `Request failed: ${response.status}`);
        throw new Error(message);
    }

    return json || {};
}

function appendLog(element, line) {
    if (!element) {
        return;
    }
    if (!element.textContent) {
        element.textContent = line;
    } else {
        element.textContent += `\n${line}`;
    }
}

function uploadWithProgress(formData, simulate) {
    const logEl = document.getElementById('upload-result');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressText = document.getElementById('upload-progress-text');
    const errorEl = document.getElementById('upload-error');

    if (logEl) {
        logEl.textContent = '';
    }
    if (progressBar) {
        progressBar.style.width = '0%';
    }
    if (progressText) {
        progressText.textContent = '';
    }
    if (errorEl) {
        errorEl.textContent = '';
    }

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/data/upload', true);
        xhr.withCredentials = true;

        xhr.upload.onprogress = event => {
            if (!event.lengthComputable) {
                return;
            }
            const percent = Math.round((event.loaded / event.total) * 100);
            const loadedMb = (event.loaded / (1024 * 1024)).toFixed(2);
            const totalMb = (event.total / (1024 * 1024)).toFixed(2);

            if (progressBar) {
                progressBar.style.width = `${percent}%`;
            }
            if (progressText) {
                progressText.textContent = `Upload progress: ${percent}% (${loadedMb} MB / ${totalMb} MB)`;
            }
            appendLog(logEl, `Upload progress: ${percent}% (${loadedMb} MB / ${totalMb} MB)`);
        };

        xhr.onreadystatechange = () => {
            if (xhr.readyState !== 4) {
                return;
            }

            const status = xhr.status;
            const text = xhr.responseText || '';
            let json;
            try {
                json = text ? JSON.parse(text) : null;
            } catch {
                appendLog(logEl, `Server response is not JSON (status ${status}). Raw response:`);
                appendLog(logEl, text.trim());
                if (errorEl) {
                    errorEl.textContent = 'Server returned HTML instead of JSON. This is usually a gateway / reverse-proxy error (for example Cloudflare 4xx/5xx or Nginx error page). Please check proxy timeouts and body size limits.';
                }
                reject(new Error('Server response is not valid JSON'));
                return;
            }

            resolve({ status, json, rawText: text });
        };

        xhr.onerror = () => {
            if (errorEl) {
                errorEl.textContent = 'Network error while uploading. Please try again.';
            }
            reject(new Error('Network error during upload'));
        };

        xhr.send(formData);
    });
}

function getBackupNameFromPath(path) {
    if (!path || typeof path !== 'string') {
        return null;
    }
    const parts = path.split(/[\\/]/);
    if (!parts.length) {
        return null;
    }
    return parts[parts.length - 1] || null;
}

async function refreshBackups(status) {
    const backupsSection = document.getElementById('backups-section');
    const backupsList = document.getElementById('backups-list');

    if (!backupsSection || !backupsList) {
        return;
    }

    if (!status.exists) {
        backupsList.textContent = 'No user directory exists for this handle yet, so there are no automatic backups.';
        return;
    }

    backupsList.textContent = 'Loading backups…';

    try {
        const data = await apiGet('/api/data/backups');
        const backups = data.backups || [];

        if (!backups.length) {
            backupsList.textContent = 'No upload_*.zip automatic backups found in the last 24 hours.';
            return;
        }

        const rollback = status.rollback || null;
        const lastUpload = status.lastUpload || null;
        const currentPath = (rollback && rollback.backupPath) || (lastUpload && lastUpload.backupZipPath) || null;
        const currentName = getBackupNameFromPath(currentPath);

        const rows = backups.map(backup => {
            const timeText = (() => {
                try {
                    return new Date(backup.mtime).toLocaleString();
                } catch {
                    return backup.mtime;
                }
            })();

            const sizeMb = backup.size ? (backup.size / (1024 * 1024)).toFixed(2) : '0.00';
            const isCurrent = currentName && backup.name === currentName;

            const label = isCurrent ? `${backup.name} (current rollback point)` : backup.name;

            return `<div class="backup-row${isCurrent ? ' backup-row-current' : ''}">
    <div>
        <div>${label}</div>
        <div class="hint">${timeText} · ${sizeMb} MB</div>
    </div>
    <div class="backup-row-buttons">
        <button type="button" data-action="restore" data-name="${backup.name}">Restore</button>
        <button type="button" data-action="download" data-name="${backup.name}">Download</button>
        <button type="button" data-action="delete" data-name="${backup.name}">Delete</button>
    </div>
</div>`;
        });

        backupsList.innerHTML = rows.join('\n');
    } catch (error) {
        backupsList.textContent = `Failed to load backups: ${error.message}`;
    }
}

async function refreshAuthAndStatus() {
    const authStatusEl = document.getElementById('auth-status');
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const userSection = document.getElementById('user-section');
    const statusSection = document.getElementById('status-section');
    const uploadSection = document.getElementById('upload-section');
    const rollbackSection = document.getElementById('rollback-section');

    try {
        const auth = await apiGet('/api/auth/me');
        if (!auth.authenticated) {
            authStatusEl.textContent = 'Not logged in. Please login with your LinuxDo account.';
            loginButton.style.display = 'inline-block';
            logoutButton.style.display = 'none';
            userSection.style.display = 'none';
            statusSection.style.display = 'none';
            uploadSection.style.display = 'none';
            rollbackSection.style.display = 'none';
            return;
        }

        authStatusEl.textContent = 'Logged in with LinuxDo.';
        loginButton.style.display = 'none';
        logoutButton.style.display = 'inline-block';
        userSection.style.display = 'block';
        statusSection.style.display = 'block';
        uploadSection.style.display = 'block';
        rollbackSection.style.display = 'block';

        document.getElementById('linuxdo-username').textContent = auth.linuxdo.username;
        document.getElementById('st-handle').textContent = auth.stHandle;
        const handleInput = document.getElementById('handle-input');
        if (handleInput && !handleInput.value) {
            handleInput.value = auth.stHandle || '';
        }

        const status = await apiGet('/api/data/status');
        document.getElementById('status-json').textContent = JSON.stringify(status, null, 2);

        const summaryEl = document.getElementById('status-summary');
        const rollbackButton = document.getElementById('rollback-button');
        if (summaryEl) {
            if (!status.exists) {
                summaryEl.textContent = 'There is currently no data directory for this handle under DATA_ROOT.';
                if (rollbackButton) {
                    rollbackButton.disabled = true;
                }
            } else {
                const lines = [];
                const sizeMb = status.size ? (status.size / (1024 * 1024)).toFixed(2) : '0.00';
                lines.push(`Directory: ${status.path}`);
                lines.push('Exists: yes');
                lines.push(`Approx size: ${sizeMb} MB`);
                if (status.mtime) {
                    try {
                        const local = new Date(status.mtime).toLocaleString();
                        lines.push(`Last modified: ${local}`);
                    } catch {
                        lines.push(`Last modified: ${status.mtime}`);
                    }
                }
                const keys = status.keyFiles || {};
                const keyParts = [];
                keyParts.push(`settings.json: ${keys.settingsJson ? 'present' : 'missing'}`);
                keyParts.push(`secrets.json: ${keys.secretsJson ? 'present' : 'missing'}`);
                keyParts.push(`stats.json: ${keys.statsJson ? 'present' : 'missing'}`);
                keyParts.push(`content.log: ${keys.contentLog ? 'present' : 'missing'}`);
                lines.push(`Key files: ${keyParts.join(' | ')}`);

                const rb = status.rollback || null;
                if (rb && rb.canRollback) {
                    lines.push('Rollback: available (there is an automatic backup created before the last successful upload).');
                    if (rb.backupMtime) {
                        try {
                            const bLocal = new Date(rb.backupMtime).toLocaleString();
                            lines.push(`Backup created at: ${bLocal}`);
                        } catch {
                            lines.push(`Backup created at: ${rb.backupMtime}`);
                        }
                    }
                    if (rollbackButton) {
                        rollbackButton.disabled = false;
                    }
                } else {
                    lines.push('Rollback: not available (no recent automatic backup found).');
                    if (rollbackButton) {
                        rollbackButton.disabled = true;
                    }
                }

                summaryEl.textContent = lines.join('\n');
            }
        }

        await refreshBackups(status);
    } catch (error) {
        authStatusEl.textContent = `Failed to load status: ${error.message}`;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const uploadButton = document.getElementById('upload-button');
    const rollbackButton = document.getElementById('rollback-button');

    const handleApplyButton = document.getElementById('handle-apply-button');
    const handleInput = document.getElementById('handle-input');

    const backupsList = document.getElementById('backups-list');

    loginButton.addEventListener('click', () => {
        const returnTo = window.location.pathname || '/';
        window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
    });

    logoutButton.addEventListener('click', async () => {
        try {
            await apiPost('/api/auth/logout', {});
        } catch {
            // ignore
        }
        await refreshAuthAndStatus();
    });

    uploadButton.addEventListener('click', async () => {
        const fileInput = document.getElementById('data-file');
        const resultEl = document.getElementById('upload-result');
        const progressText = document.getElementById('upload-progress-text');
        const errorEl = document.getElementById('upload-error');

        const file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) {
            resultEl.textContent = 'Please choose a data.zip file first.';
            return;
        }

        if (file.size > 100 * 1024 * 1024) {
            resultEl.textContent = 'File is larger than 100MB. Upload rejected on client side.';
            return;
        }

        const formData = new FormData();
        formData.append('dataZip', file);

        const modeInput = document.querySelector('input[name="mode"]:checked');
        const mode = modeInput && typeof modeInput.value === 'string' ? modeInput.value : 'simulate';
        const simulate = mode === 'simulate';

        const overwriteSettings = document.getElementById('overwrite-settings').checked;
        const overwriteSecrets = document.getElementById('overwrite-secrets').checked;
        const overwriteStats = document.getElementById('overwrite-stats').checked;
        const overwriteContentLog = document.getElementById('overwrite-content-log').checked;

        formData.append('mode', mode);
        formData.append('simulate', simulate ? 'true' : 'false');
        formData.append('overwriteSettings', overwriteSettings ? 'true' : 'false');
        formData.append('overwriteSecrets', overwriteSecrets ? 'true' : 'false');
        formData.append('overwriteStats', overwriteStats ? 'true' : 'false');
        formData.append('overwriteContentLog', overwriteContentLog ? 'true' : 'false');

        if (progressText) {
            progressText.textContent = simulate
                ? 'Step 1/2: uploading archive and running simulation on the server…'
                : 'Step 1/3: uploading archive and extracting on the server…';
        }
        if (errorEl) {
            errorEl.textContent = '';
        }

        uploadButton.disabled = true;
        if (fileInput) {
            fileInput.disabled = true;
        }
        if (rollbackButton) {
            rollbackButton.disabled = true;
        }

        try {
            const { status, json } = await uploadWithProgress(formData, simulate);

            if (!json || json.ok === false) {
                appendLog(resultEl, `Upload failed: ${(json && json.message) || status}`);
                if (json) {
                    appendLog(resultEl, 'Full JSON response:');
                    appendLog(resultEl, JSON.stringify(json, null, 2));
                }
                if (errorEl) {
                    errorEl.textContent = 'Upload failed. See details above.';
                }
            } else if (json.result && json.result.simulation) {
                if (progressText) {
                    progressText.textContent = 'Step 2/2: simulation completed.';
                }
                appendLog(resultEl, 'Simulation result:');
                appendLog(resultEl, JSON.stringify(json.result, null, 2));
            } else {
                if (progressText) {
                    progressText.textContent = 'Step 2/3: extraction and safety checks completed.\nStep 3/3: backup + merge completed.';
                }
                appendLog(resultEl, 'Upload completed. Detailed result:');
                appendLog(resultEl, JSON.stringify(json.result, null, 2));
                await refreshAuthAndStatus();
            }
        } catch (error) {
            appendLog(resultEl, `Upload error: ${error.message}`);
        } finally {
            uploadButton.disabled = false;
            if (fileInput) {
                fileInput.disabled = false;
            }
            if (rollbackButton) {
                rollbackButton.disabled = false;
            }
        }
    });

    rollbackButton.addEventListener('click', async () => {
        const resultEl = document.getElementById('rollback-result');
        resultEl.textContent = 'Starting rollback…';
        rollbackButton.disabled = true;

        try {
            const json = await apiPost('/api/data/rollback', {});
            resultEl.textContent = `Rollback completed.\n${JSON.stringify(json.result || json, null, 2)}`;
            await refreshAuthAndStatus();
        } catch (error) {
            resultEl.textContent = `Rollback error: ${error.message}`;
        } finally {
            rollbackButton.disabled = false;
        }
    });

    if (handleApplyButton && handleInput) {
        handleApplyButton.addEventListener('click', async () => {
            const rawHandle = handleInput.value.trim();
            const resultEl = document.getElementById('upload-result');

            if (!rawHandle) {
                if (resultEl) {
                    resultEl.textContent = 'Please enter the SillyTavern handle you want to operate on.';
                }
                return;
            }

            try {
                const result = await apiPost('/api/auth/handle', { rawHandle });
                document.getElementById('st-handle').textContent = result.stHandle;
                handleInput.value = result.stHandle;
                if (resultEl) {
                    resultEl.textContent = `Switched handle to: ${result.stHandle}\nDirectory: ${result.path}`;
                }
                await refreshAuthAndStatus();
            } catch (error) {
                if (resultEl) {
                    resultEl.textContent = `Failed to switch handle: ${error.message}`;
                }
            }
        });
    }

    if (backupsList) {
        backupsList.addEventListener('click', async event => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            const action = target.getAttribute('data-action');
            const name = target.getAttribute('data-name');
            if (!action || !name) {
                return;
            }

            if (action === 'restore') {
                const resultEl = document.getElementById('rollback-result');
                if (resultEl) {
                    resultEl.textContent = `Starting restore from backup…\n${name}`;
                }
                try {
                    const json = await apiPost(`/api/data/backups/${encodeURIComponent(name)}/restore`, {});
                    if (resultEl) {
                        resultEl.textContent = `Restore completed.\n${JSON.stringify(json.result || json, null, 2)}`;
                    }
                    await refreshAuthAndStatus();
                } catch (error) {
                    if (resultEl) {
                        resultEl.textContent = `Restore error: ${error.message}`;
                    }
                }
            } else if (action === 'download') {
                window.open(`/api/data/backups/${encodeURIComponent(name)}`, '_blank');
            } else if (action === 'delete') {
                // eslint-disable-next-line no-alert
                const confirmed = window.confirm(`Delete backup?\n${name}`);
                if (!confirmed) {
                    return;
                }
                const resultEl = document.getElementById('rollback-result');
                try {
                    const response = await fetch(`/api/data/backups/${encodeURIComponent(name)}`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    });
                    const json = await response.json();
                    if (!response.ok || json.ok === false) {
                        throw new Error(json.message || `Request failed: ${response.status}`);
                    }
                    if (resultEl) {
                        resultEl.textContent = `Deleted backup: ${name}`;
                    }
                    await refreshAuthAndStatus();
                } catch (error) {
                    if (resultEl) {
                        resultEl.textContent = `Failed to delete backup: ${error.message}`;
                    }
                }
            }
        });
    }

    refreshAuthAndStatus();
});
