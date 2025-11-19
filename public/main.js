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

        const status = await apiGet('/api/data/status');
        document.getElementById('status-json').textContent = JSON.stringify(status, null, 2);
    } catch (error) {
        authStatusEl.textContent = `加载状态失败：${error.message}`;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const uploadButton = document.getElementById('upload-button');
    const rollbackButton = document.getElementById('rollback-button');

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

        resultEl.textContent = simulate ? '正在进行模拟验证（不会修改服务器数据）…' : '正在上传并写入，请稍候…';

        try {
            const response = await fetch('/api/data/upload', {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });
            const json = await response.json();
            if (!response.ok || !json.ok) {
                resultEl.textContent = `上传失败：${json.message || response.status}`;
            } else {
                if (json.result && json.result.simulation) {
                    resultEl.textContent = `模拟结果：\n${JSON.stringify(json.result, null, 2)}\n如果没有危险文件且结构正确，可以切换到“真实写入”模式再次上传。`;
                } else {
                    resultEl.textContent = `上传成功：\n${JSON.stringify(json.result, null, 2)}`;
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

    refreshAuthAndStatus();
});
