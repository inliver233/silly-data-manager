async function apiGet(path) {
    const response = await fetch(path, {
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error(`请求失败：${response.status}`);
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
        // 尝试解析 JSON，失败则退回原始文本
    }

    if (!response.ok) {
        const message = (json && json.message) ? json.message : (text || `请求失败：${response.status}`);
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
            const line = `上传进度：${percent}%（${loadedMb} MB / ${totalMb} MB）`;
            if (progressText) {
                progressText.textContent = line;
            }
            appendLog(logEl, line);
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
                appendLog(logEl, `服务器返回的不是 JSON（状态码 ${status}）。原始响应：`);
                appendLog(logEl, text.trim());
                if (errorEl) {
                    errorEl.textContent = '服务器返回了 HTML/错误页而不是 JSON，通常是网关或反向代理错误（例如 Cloudflare 4xx/5xx 或 Nginx 错误页）。请检查代理超时和请求体大小限制。';
                }
                reject(new Error('服务器响应不是有效的 JSON'));
                return;
            }

            resolve({ status, json, rawText: text });
        };

        xhr.onerror = () => {
            if (errorEl) {
                errorEl.textContent = '上传过程中发生网络错误，请稍后重试。';
            }
            reject(new Error('上传过程中发生网络错误'));
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
        backupsList.textContent = '当前 Handle 尚不存在对应的数据目录，因此没有自动备份。';
        return;
    }

    backupsList.textContent = '正在加载备份列表……';

    try {
        const data = await apiGet('/api/data/backups');
        const backups = data.backups || [];

        if (!backups.length) {
            backupsList.textContent = '最近 24 小时内未找到任何 upload_*.zip 自动备份。';
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

            const label = isCurrent ? `${backup.name}（当前回滚点）` : backup.name;

            return `<div class="backup-row${isCurrent ? ' backup-row-current' : ''}">
    <div>
        <div>${label}</div>
        <div class="hint">${timeText} · ${sizeMb} MB</div>
    </div>
    <div class="backup-row-buttons">
        <button type="button" data-action="restore" data-name="${backup.name}">恢复</button>
        <button type="button" data-action="download" data-name="${backup.name}">下载</button>
        <button type="button" data-action="delete" data-name="${backup.name}">删除</button>
    </div>
</div>`;
        });

        backupsList.innerHTML = rows.join('\n');
    } catch (error) {
        backupsList.textContent = `加载备份列表失败：${error.message}`;
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
            authStatusEl.textContent = '当前未登录，请使用 LinuxDo 账号登录。';
            loginButton.style.display = 'inline-block';
            logoutButton.style.display = 'none';
            userSection.style.display = 'none';
            statusSection.style.display = 'none';
            uploadSection.style.display = 'none';
            rollbackSection.style.display = 'none';
            return;
        }

        authStatusEl.textContent = '已使用 LinuxDo 账号登录。';
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
                summaryEl.textContent = '当前 DATA_ROOT 下不存在该 Handle 对应的数据目录。';
                if (rollbackButton) {
                    rollbackButton.disabled = true;
                }
            } else {
                const lines = [];
                const sizeMb = status.size ? (status.size / (1024 * 1024)).toFixed(2) : '0.00';
                lines.push(`目录路径：${status.path}`);
                lines.push('目录存在：是');
                lines.push(`大致占用空间：${sizeMb} MB`);
                if (status.mtime) {
                    try {
                        const local = new Date(status.mtime).toLocaleString();
                        lines.push(`最后修改时间：${local}`);
                    } catch {
                        lines.push(`最后修改时间：${status.mtime}`);
                    }
                }
                const keys = status.keyFiles || {};
                const keyParts = [];
                keyParts.push(`settings.json：${keys.settingsJson ? '存在' : '缺失'}`);
                keyParts.push(`secrets.json：${keys.secretsJson ? '存在' : '缺失'}`);
                keyParts.push(`stats.json：${keys.statsJson ? '存在' : '缺失'}`);
                keyParts.push(`content.log：${keys.contentLog ? '存在' : '缺失'}`);
                lines.push(`关键文件：${keyParts.join(' | ')}`);

                const rb = status.rollback || null;
                if (rb && rb.canRollback) {
                    lines.push('回滚：可用（存在最近一次成功上传前的自动备份）。');
                    if (rb.backupMtime) {
                        try {
                            const bLocal = new Date(rb.backupMtime).toLocaleString();
                            lines.push(`备份创建时间：${bLocal}`);
                        } catch {
                            lines.push(`备份创建时间：${rb.backupMtime}`);
                        }
                    }
                    if (rollbackButton) {
                        rollbackButton.disabled = false;
                    }
                } else {
                    lines.push('回滚：不可用（未找到最近的自动备份）。');
                    if (rollbackButton) {
                        rollbackButton.disabled = true;
                    }
                }

                summaryEl.textContent = lines.join('\n');
            }
        }

        await refreshBackups(status);
    } catch (error) {
        authStatusEl.textContent = `加载状态失败：${error.message}`;
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
            // 忽略登出错误
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
            resultEl.textContent = '请先选择一个 data.zip 文件。';
            return;
        }

        if (file.size > 100 * 1024 * 1024) {
            resultEl.textContent = '文件大于 100MB，已在前端被拒绝上传。';
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
                ? '第 1/2 步：上传归档并在服务器端执行模拟检查……'
                : '第 1/3 步：上传归档并在服务器端解压……';
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
                appendLog(resultEl, `上传失败：${(json && json.message) || status}`);
                if (json) {
                    appendLog(resultEl, '完整 JSON 响应：');
                    appendLog(resultEl, JSON.stringify(json, null, 2));
                }
                if (errorEl) {
                    errorEl.textContent = '上传失败，详情请查看上方日志。';
                }
            } else if (json.result && json.result.simulation) {
                if (progressText) {
                    progressText.textContent = '第 2/2 步：模拟检查已完成。';
                }
                appendLog(resultEl, '模拟结果：');
                appendLog(resultEl, JSON.stringify(json.result, null, 2));
            } else {
                if (progressText) {
                    progressText.textContent = '第 2/3 步：解压与安全检查完成。\n第 3/3 步：备份与数据合并完成。';
                }
                appendLog(resultEl, '上传完成。详细结果：');
                appendLog(resultEl, JSON.stringify(json.result, null, 2));
                await refreshAuthAndStatus();
            }
        } catch (error) {
            appendLog(resultEl, `上传出错：${error.message}`);
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
        resultEl.textContent = '正在开始回滚……';
        rollbackButton.disabled = true;

        try {
            const json = await apiPost('/api/data/rollback', {});
            resultEl.textContent = `回滚完成。\n${JSON.stringify(json.result || json, null, 2)}`;
            await refreshAuthAndStatus();
        } catch (error) {
            resultEl.textContent = `回滚出错：${error.message}`;
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
                    resultEl.textContent = '请输入你想操作的 SillyTavern Handle。';
                }
                return;
            }

            try {
                const result = await apiPost('/api/auth/handle', { rawHandle });
                document.getElementById('st-handle').textContent = result.stHandle;
                handleInput.value = result.stHandle;
                if (resultEl) {
                    resultEl.textContent = `已切换 Handle：${result.stHandle}\n目录路径：${result.path}`;
                }
                await refreshAuthAndStatus();
            } catch (error) {
                if (resultEl) {
                    resultEl.textContent = `切换 Handle 失败：${error.message}`;
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
                    resultEl.textContent = `正在从备份恢复……\n${name}`;
                }
                try {
                    const json = await apiPost(`/api/data/backups/${encodeURIComponent(name)}/restore`, {});
                    if (resultEl) {
                        resultEl.textContent = `恢复完成。\n${JSON.stringify(json.result || json, null, 2)}`;
                    }
                    await refreshAuthAndStatus();
                } catch (error) {
                    if (resultEl) {
                        resultEl.textContent = `恢复出错：${error.message}`;
                    }
                }
            } else if (action === 'download') {
                window.open(`/api/data/backups/${encodeURIComponent(name)}`, '_blank');
            } else if (action === 'delete') {
                // eslint-disable-next-line no-alert
                const confirmed = window.confirm(`确认删除该备份？\n${name}`);
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
                        throw new Error(json.message || `请求失败：${response.status}`);
                    }
                    if (resultEl) {
                        resultEl.textContent = `已删除备份：${name}`;
                    }
                    await refreshAuthAndStatus();
                } catch (error) {
                    if (resultEl) {
                        resultEl.textContent = `删除备份失败：${error.message}`;
                    }
                }
            }
        });
    }

    refreshAuthAndStatus();
});
