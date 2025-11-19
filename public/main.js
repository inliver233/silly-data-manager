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
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed: ${response.status} ${text}`);
    }
    return response.json();
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
            authStatusEl.textContent = '未登录，请先使用 LinuxDo 账号登录。';
            loginButton.style.display = 'inline-block';
            logoutButton.style.display = 'none';
            userSection.style.display = 'none';
            statusSection.style.display = 'none';
            uploadSection.style.display = 'none';
            rollbackSection.style.display = 'none';
            return;
        }

        authStatusEl.textContent = '已通过 LinuxDo 登录。';
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
                summaryEl.textContent = '服务器上还没有该 handle 对应的数据目录。';
                if (rollbackButton) {
                    rollbackButton.disabled = true;
                }
            } else {
                const lines = [];
                const sizeMb = status.size ? (status.size / (1024 * 1024)).toFixed(2) : '0.00';
                lines.push(`数据目录：${status.path}`);
                lines.push('是否存在：是');
                lines.push(`数据大小：${sizeMb} MB`);
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
                keyParts.push(`settings.json（${keys.settingsJson ? '存在' : '缺失'}）`);
                keyParts.push(`secrets.json（${keys.secretsJson ? '存在' : '缺失'}）`);
                keyParts.push(`stats.json（${keys.statsJson ? '存在' : '缺失'}）`);
                keyParts.push(`content.log（${keys.contentLog ? '存在' : '缺失'}）`);
                lines.push(`关键文件：${keyParts.join('，')}`);

                const rb = status.rollback || null;
                if (rb && rb.canRollback) {
                    lines.push('回滚状态：可用（将回到最近一次通过本系统上传前的状态）。');
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
                    lines.push('回滚状态：当前没有可用的自动备份（尚未通过本系统进行成功上传）。');
                    if (rollbackButton) {
                        rollbackButton.disabled = true;
                    }
                }

                summaryEl.textContent = lines.join('\n');
            }
        }
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

        const file = fileInput.files && fileInput.files[0];
        if (!file) {
            resultEl.textContent = '请先选择一个 data.zip 文件。';
            return;
        }

        if (file.size > 100 * 1024 * 1024) {
            resultEl.textContent = '文件大于 100MB，将被服务器拒绝。';
            return;
        }

        const formData = new FormData();
        formData.append('dataZip', file);

        const mode = document.querySelector('input[name="mode"]:checked')?.value || 'simulate';
        const simulate = mode === 'simulate';

        const overwriteSettings = document.getElementById('overwrite-settings').checked;
        const overwriteSecrets = document.getElementById('overwrite-secrets').checked;
        const overwriteStats = document.getElementById('overwrite-stats').checked;
        const overwriteContentLog = document.getElementById('overwrite-content-log').checked;

        formData.append('simulate', simulate ? 'true' : 'false');
        formData.append('overwriteSettings', overwriteSettings ? 'true' : 'false');
        formData.append('overwriteSecrets', overwriteSecrets ? 'true' : 'false');
        formData.append('overwriteStats', overwriteStats ? 'true' : 'false');
        formData.append('overwriteContentLog', overwriteContentLog ? 'true' : 'false');

        resultEl.textContent = simulate
            ? '步骤 1/2：正在上传文件并在服务器中解压（模拟模式，不会修改服务器数据）…'
            : '步骤 1/3：正在上传文件并在服务器中解压…';

        try {
            const response = await fetch('/api/data/upload', {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });
            const json = await response.json();
            if (!response.ok || !json.ok) {
                resultEl.textContent = `上传失败：${json.message || response.status}\n服务器返回：\n${JSON.stringify(json, null, 2)}`;
            } else {
                if (json.result && json.result.simulation) {
                    resultEl.textContent =
                        '步骤 2/2：服务器已完成解压和安全检查（模拟模式）。\n' +
                        '如果没有危险文件且结构正确，可以切换到“真实写入”模式再次上传。\n\n' +
                        JSON.stringify(json.result, null, 2);
                } else {
                    resultEl.textContent =
                        '步骤 2/3：服务器已完成解压和安全检查。\n' +
                        '步骤 3/3：已完成备份旧数据并合并新数据。\n\n' +
                        '详细结果：\n' +
                        JSON.stringify(json.result, null, 2);
                    await refreshAuthAndStatus();
                }
            }
        } catch (error) {
            resultEl.textContent = `上传过程中出错：${error.message}`;
        }
    });

    rollbackButton.addEventListener('click', async () => {
        const resultEl = document.getElementById('rollback-result');
        resultEl.textContent = '正在请求回滚，请稍候…';

        try {
            const json = await apiPost('/api/data/rollback', {});
            if (!json.ok) {
                resultEl.textContent = `回滚失败：${json.message || '未知错误'}`;
            } else {
                resultEl.textContent = `回滚成功：\n${JSON.stringify(json.result, null, 2)}`;
                await refreshAuthAndStatus();
            }
        } catch (error) {
            resultEl.textContent = `回滚过程中出错：${error.message}`;
        }
    });

    if (handleApplyButton && handleInput) {
        handleApplyButton.addEventListener('click', async () => {
            const rawHandle = handleInput.value.trim();
            const resultEl = document.getElementById('upload-result');

            if (!rawHandle) {
                if (resultEl) {
                    resultEl.textContent = '请输入想要操作的 SillyTavern handle 或名称。';
                }
                return;
            }

            try {
                const result = await apiPost('/api/auth/handle', { rawHandle });
                document.getElementById('st-handle').textContent = result.stHandle;
                handleInput.value = result.stHandle;
                if (resultEl) {
                    resultEl.textContent = `已切换到 handle：${result.stHandle}\n对应目录：${result.path}`;
                }
                await refreshAuthAndStatus();
            } catch (error) {
                if (resultEl) {
                    resultEl.textContent = `切换 handle 失败：${error.message}`;
                }
            }
        });
    }

    refreshAuthAndStatus();
});

