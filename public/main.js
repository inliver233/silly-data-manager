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
        // 返回不是 JSON 时保留原始文本
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
                appendLog(logEl, `服务器返回的不是 JSON，状态码：${status}，原始响应内容：`);
                appendLog(logEl, text.trim());
                if (errorEl) {
                    errorEl.textContent = '上传失败：服务器返回了 HTML/错误页面，而不是 JSON。请检查反向代理/Cloudflare/Nginx 等配置。';
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

function formatDate(isoString) {
    if (!isoString) {
        return '-';
    }
    try {
        return new Date(isoString).toLocaleString();
    } catch {
        return isoString;
    }
}

function formatSizeMb(bytes) {
    if (!bytes || typeof bytes !== 'number') {
        return '0.00';
    }
    return (bytes / (1024 * 1024)).toFixed(2);
}

async function refreshBackups(status) {
    const backupsSection = document.getElementById('backups-section');
    const backupsList = document.getElementById('backups-list');

    if (!backupsSection || !backupsList) {
        return;
    }

    if (!status.exists) {
        backupsList.textContent = '当前 Handle 在 DATA_ROOT 下不存在对应的数据目录，暂无可用备份。';
        return;
    }

    try {
        const json = await apiGet('/api/data/backups');
        const backups = json.backups || [];

        if (!backups.length) {
            backupsList.textContent = '当前没有可用备份。';
            return;
        }

        const fragments = backups.map(backup => {
            const sizeMb = formatSizeMb(backup.size);
            const time = formatDate(backup.mtime);
            const name = backup.name;

            return [
                '<div class="backup-row">',
                `<div><strong>${name}</strong></div>`,
                `<div>大小：${sizeMb} MB，时间：${time}</div>`,
                '<div class="backup-row-buttons">',
                `<button data-action="restore" data-name="${encodeURIComponent(name)}">从该备份恢复</button>`,
                `<button data-action="download" data-name="${encodeURIComponent(name)}">下载备份</button>`,
                `<button data-action="delete" data-name="${encodeURIComponent(name)}">删除备份</button>`,
                '</div>',
                '</div>',
            ].join('');
        });

        backupsList.innerHTML = fragments.join('\n');
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

        loginButton.style.display = 'none';
        logoutButton.style.display = 'inline-block';
        userSection.style.display = 'block';
        statusSection.style.display = 'block';
        uploadSection.style.display = 'block';
        rollbackSection.style.display = 'block';

        const linuxdoUsernameEl = document.getElementById('linuxdo-username');
        const stHandleEl = document.getElementById('st-handle');
        const handleInput = document.getElementById('handle-input');
        const uploadButton = document.getElementById('upload-button');
        const rollbackButton = document.getElementById('rollback-button');
        const handleWarningEl = document.getElementById('handle-verify-warning');

        const handleVerified = Boolean(auth.handleVerified);

        if (linuxdoUsernameEl) {
            linuxdoUsernameEl.textContent = auth.linuxdo?.username || '-';
        }
        if (stHandleEl) {
            stHandleEl.textContent = auth.stHandle || '';
        }
        if (handleInput && !handleInput.value) {
            handleInput.value = auth.stHandle || '';
        }

        if (!handleVerified) {
            authStatusEl.textContent = '已使用 LinuxDo 账号登录，但当前 Handle 未通过 SillyTavern 密码验证。请在下方输入 Handle 和密码完成绑定后再进行上传/回滚。';
            if (handleWarningEl) {
                handleWarningEl.textContent = '当前 Handle 未验证：上传 / 回滚 按钮已锁定，请先完成 SillyTavern Handle + 密码验证。';
            }
            if (uploadButton) {
                uploadButton.disabled = true;
            }
            if (rollbackButton) {
                rollbackButton.disabled = true;
            }
        } else {
            authStatusEl.textContent = '已使用 LinuxDo 账号登录，当前 Handle 已通过 SillyTavern 密码验证，可以安全执行上传和回滚。';
            if (handleWarningEl) {
                handleWarningEl.textContent = '';
            }
            if (uploadButton) {
                uploadButton.disabled = false;
            }
            if (rollbackButton) {
                rollbackButton.disabled = false;
            }
        }

        const status = await apiGet('/api/data/status');

        const statusJsonEl = document.getElementById('status-json');
        if (statusJsonEl) {
            statusJsonEl.textContent = JSON.stringify(status, null, 2);
        }

        const summaryEl = document.getElementById('status-summary');

        if (summaryEl) {
            if (!status.exists) {
                summaryEl.textContent = '当前 DATA_ROOT 下不存在该 Handle 对应的数据目录。';
            } else {
                const lines = [];
                const sizeMb = formatSizeMb(status.size);
                lines.push(`目录路径：${status.path}`);
                lines.push('目录存在：是');
                lines.push(`占用空间：${sizeMb} MB`);
                if (status.mtime) {
                    lines.push(`最后修改时间：${formatDate(status.mtime)}`);
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
                    lines.push('回滚：已启用，可恢复到最近一次真实上传前的自动备份。');
                    if (rb.backupMtime) {
                        lines.push(`备份时间：${formatDate(rb.backupMtime)}`);
                    }
                } else {
                    lines.push('回滚：未启用，未找到可用的自动备份。');
                }

                summaryEl.textContent = lines.join('\n');
            }
        }

        await refreshBackups(status);
    } catch (error) {
        authStatusEl.textContent = `刷新状态失败：${error.message}`;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const uploadButton = document.getElementById('upload-button');
    const rollbackButton = document.getElementById('rollback-button');

    const handleApplyButton = document.getElementById('handle-apply-button');
    const handleInput = document.getElementById('handle-input');
    const handlePasswordInput = document.getElementById('handle-password');

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
            resultEl.textContent = '文件超过 100MB，前端将拒绝上传，请拆分或压缩后再试。';
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
                ? '步骤 1/2：正在上传压缩包（模拟模式）...'
                : '步骤 1/3：正在上传压缩包...';
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
            const { json } = await uploadWithProgress(formData, simulate);
            if (!json) {
                resultEl.textContent = '上传完成，但服务器未返回数据。';
                return;
            }

            if (json.ok === false) {
                if (json.result) {
                    appendLog(resultEl, '服务器返回错误：');
                    appendLog(resultEl, JSON.stringify(json.result, null, 2));
                }
                if (errorEl) {
                    errorEl.textContent = json.message || '上传失败，请查看服务器日志。';
                }
            } else if (json.result && json.result.simulation) {
                if (progressText) {
                    progressText.textContent = '步骤 2/2：模拟检查完成。';
                }
                appendLog(resultEl, '模拟结果：');
                appendLog(resultEl, JSON.stringify(json.result, null, 2));
            } else {
                if (progressText) {
                    progressText.textContent = '步骤 2/3：解压与安全检查完成。\n步骤 3/3：数据合并完成。';
                }
                appendLog(resultEl, '上传完成，详细结果：');
                appendLog(resultEl, JSON.stringify(json.result, null, 2));
                await refreshAuthAndStatus();
            }
        } catch (error) {
            appendLog(resultEl, `上传失败：${error.message}`);
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
        resultEl.textContent = '正在执行回滚操作...';
        rollbackButton.disabled = true;

        try {
            const json = await apiPost('/api/data/rollback', {});
            resultEl.textContent = `回滚完成：\n${JSON.stringify(json.result || json, null, 2)}`;
            await refreshAuthAndStatus();
        } catch (error) {
            resultEl.textContent = `回滚失败：${error.message}`;
        } finally {
            rollbackButton.disabled = false;
        }
    });

    if (handleApplyButton && handleInput && handlePasswordInput) {
        handleApplyButton.addEventListener('click', async () => {
            const rawHandle = handleInput.value.trim();
            const password = handlePasswordInput.value;
            const resultEl = document.getElementById('upload-result');

            if (!rawHandle) {
                if (resultEl) {
                    resultEl.textContent = '请先输入要绑定的 SillyTavern Handle。';
                }
                return;
            }

            if (!password) {
                if (resultEl) {
                    resultEl.textContent = '请输入 SillyTavern 登录密码，然后再点击“使用此 Handle + 密码”。';
                }
                return;
            }

            try {
                const result = await apiPost('/api/auth/handle', { rawHandle, password });
                document.getElementById('st-handle').textContent = result.stHandle;
                handleInput.value = result.stHandle;
                handlePasswordInput.value = '';
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
            const nameEncoded = target.getAttribute('data-name');
            if (!action || !nameEncoded) {
                return;
            }

            const name = decodeURIComponent(nameEncoded);

            if (action === 'restore') {
                const resultEl = document.getElementById('rollback-result');
                if (resultEl) {
                    resultEl.textContent = `正在从备份恢复数据：\n${name}`;
                }
                try {
                    const json = await apiPost(`/api/data/backups/${encodeURIComponent(name)}/restore`, {});
                    if (resultEl) {
                        resultEl.textContent = `恢复完成：\n${JSON.stringify(json.result || json, null, 2)}`;
                    }
                    await refreshAuthAndStatus();
                } catch (error) {
                    if (resultEl) {
                        resultEl.textContent = `恢复失败：${error.message}`;
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

    // 首次加载时刷新状态
    refreshAuthAndStatus();
});

