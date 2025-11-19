let adminCsrfToken = null;

async function adminApiPost(path, body) {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (adminCsrfToken) {
        headers['X-CSRF-Token'] = adminCsrfToken;
    }

    const response = await fetch(path, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(body || {}),
    });
    const json = await response.json();
    if (!response.ok || json.ok === false) {
        throw new Error(json.message || `Request failed: ${response.status}`);
    }
    return json;
}

async function adminApiGet(path) {
    const headers = {};
    if (adminCsrfToken) {
        headers['X-CSRF-Token'] = adminCsrfToken;
    }

    const response = await fetch(path, {
        credentials: 'include',
        headers,
    });
    const json = await response.json();
    if (!response.ok || json.ok === false) {
        throw new Error(json.message || `Request failed: ${response.status}`);
    }
    return json;
}

window.addEventListener('DOMContentLoaded', () => {
    const loginSection = document.getElementById('admin-login-section');
    const panelSection = document.getElementById('admin-panel');
    const loginButton = document.getElementById('admin-login-button');
    const logoutButton = document.getElementById('admin-logout-button');
    const loginMessage = document.getElementById('admin-login-message');

    const filterHandle = document.getElementById('filter-handle');
    const filterType = document.getElementById('filter-type');
    const filterLimit = document.getElementById('filter-limit');
    const loadLogsButton = document.getElementById('load-logs-button');
    const logsOutput = document.getElementById('logs-output');

    loginButton.addEventListener('click', async () => {
        const username = document.getElementById('admin-username').value;
        const password = document.getElementById('admin-password').value;

        try {
            const result = await adminApiPost('/admin/api/login', { username, password });
            if (result.csrfToken) {
                adminCsrfToken = result.csrfToken;
            }
            loginMessage.textContent = 'Login successful.';
            loginSection.style.display = 'none';
            panelSection.style.display = 'block';
        } catch (error) {
            loginMessage.textContent = `Login failed: ${error.message}`;
        }
    });

    logoutButton.addEventListener('click', async () => {
        try {
            await adminApiPost('/admin/api/logout', {});
        } catch {
            // ignore
        }
        adminCsrfToken = null;
        panelSection.style.display = 'none';
        loginSection.style.display = 'block';
    });

    loadLogsButton.addEventListener('click', async () => {
        logsOutput.textContent = 'Loading logs...';
        const params = new URLSearchParams();
        const typeValue = filterType.value;
        const handleValue = filterHandle.value.trim();
        const limitValue = filterLimit.value;

        if (typeValue) {
            params.set('type', typeValue);
        }
        if (handleValue) {
            params.set('handle', handleValue);
        }
        if (limitValue) {
            params.set('limit', limitValue);
        }

        try {
            const json = await adminApiGet(`/admin/api/logs?${params.toString()}`);
            logsOutput.textContent = JSON.stringify(json.logs, null, 2);
        } catch (error) {
            logsOutput.textContent = `Failed to load logs: ${error.message}`;
        }
    });
});
