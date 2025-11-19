let adminCsrfToken = null;
let adminUsers = [];
let selectedUserIndex = null;

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

    const loadUsersButton = document.getElementById('load-users-button');
    const usersOutput = document.getElementById('users-output');
    const selectedUserSummary = document.getElementById('selected-user-summary');

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
        adminUsers = [];
        selectedUserIndex = null;
        panelSection.style.display = 'none';
        loginSection.style.display = 'block';
    });

    function renderUsers() {
        if (!usersOutput) {
            return;
        }

        if (!adminUsers || adminUsers.length === 0) {
            usersOutput.textContent = 'No users found in logs yet.';
            if (selectedUserSummary) {
                selectedUserSummary.textContent = '';
            }
            return;
        }

        const fragments = adminUsers.map((user, index) => {
            const handles = (user.handles || []).join(', ') || '-';
            const label = `#${index + 1} [${user.linuxdoId ?? 'unknown'}] ${user.linuxdoUsername ?? 'unknown'} (${user.linuxdoName ?? ''})`;
            const stats = `logins: ${user.logins}, uploads: ${user.uploads}, rollbacks: ${user.rollbacks}, handle changes: ${user.handleChanges}`;
            const time = `first seen: ${user.firstSeen ?? '-'} / last seen: ${user.lastSeen ?? '-'}`;
            return `<div class="user-row" data-index="${index}"><div>${label}</div><div>Handles: ${handles}</div><div>${stats}</div><div>${time}</div></div>`;
        });

        usersOutput.innerHTML = fragments.join('');

        const rows = usersOutput.querySelectorAll('.user-row');
        rows.forEach(row => {
            row.addEventListener('click', () => {
                rows.forEach(r => r.classList.remove('user-row-selected'));
                row.classList.add('user-row-selected');
                const index = Number.parseInt(row.getAttribute('data-index') || '-1', 10);
                if (!Number.isNaN(index) && adminUsers[index]) {
                    selectedUserIndex = index;
                    const user = adminUsers[index];
                    if (selectedUserSummary) {
                        const lines = [];
                        lines.push(`LinuxDo ID: ${user.linuxdoId ?? 'unknown'}`);
                        lines.push(`LinuxDo username: ${user.linuxdoUsername ?? 'unknown'}`);
                        lines.push(`LinuxDo name: ${user.linuxdoName ?? ''}`);
                        lines.push(`Trust level: ${user.trustLevel ?? 'unknown'}`);
                        lines.push(`Handles: ${(user.handles || []).join(', ') || '-'}`);
                        lines.push(`First seen: ${user.firstSeen ?? '-'}`);
                        lines.push(`Last seen: ${user.lastSeen ?? '-'}`);
                        lines.push(`Logins: ${user.logins}, uploads: ${user.uploads}, rollbacks: ${user.rollbacks}, handle changes: ${user.handleChanges}`);
                        selectedUserSummary.textContent = lines.join('\n');
                    }

                    if (filterHandle && (!filterHandle.value || filterHandle.value.trim() === '') && user.handles && user.handles.length > 0) {
                        filterHandle.value = user.handles[0];
                    }
                }
            });
        });
    }

    if (loadUsersButton && usersOutput) {
        loadUsersButton.addEventListener('click', async () => {
            usersOutput.textContent = 'Loading users…';
            if (selectedUserSummary) {
                selectedUserSummary.textContent = '';
            }
            try {
                const json = await adminApiGet('/admin/api/users');
                adminUsers = json.users || [];
                selectedUserIndex = null;
                renderUsers();
            } catch (error) {
                usersOutput.textContent = `Failed to load users: ${error.message}`;
            }
        });
    }

    loadLogsButton.addEventListener('click', async () => {
        logsOutput.textContent = 'Loading logs…';
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

        const selectedUser = (selectedUserIndex != null && adminUsers[selectedUserIndex]) ? adminUsers[selectedUserIndex] : null;
        if (selectedUser) {
            if (selectedUser.linuxdoId != null) {
                params.set('linuxdoId', String(selectedUser.linuxdoId));
            }
            if (selectedUser.linuxdoUsername) {
                params.set('linuxdoUsername', selectedUser.linuxdoUsername);
            }
        }

        try {
            const json = await adminApiGet(`/admin/api/logs?${params.toString()}`);
            logsOutput.textContent = JSON.stringify(json.logs, null, 2);
        } catch (error) {
            logsOutput.textContent = `Failed to load logs: ${error.message}`;
        }
    });
});
