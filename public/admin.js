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
        throw new Error(json.message || `请求失败：${response.status}`);
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
        throw new Error(json.message || `请求失败：${response.status}`);
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
            loginMessage.textContent = '登录成功。';
            loginSection.style.display = 'none';
            panelSection.style.display = 'block';
        } catch (error) {
            loginMessage.textContent = `登录失败：${error.message}`;
        }
    });

    logoutButton.addEventListener('click', async () => {
        try {
            await adminApiPost('/admin/api/logout', {});
        } catch {
            // 忽略登出错误
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
            usersOutput.textContent = '日志中暂未发现任何用户记录。';
            if (selectedUserSummary) {
                selectedUserSummary.textContent = '';
            }
            return;
        }

        const fragments = adminUsers.map((user, index) => {
            const handles = (user.handles || []).join(', ') || '-';
            const label = `#${index + 1} [${user.linuxdoId ?? 'unknown'}] ${user.linuxdoUsername ?? 'unknown'} (${user.linuxdoName ?? ''})`;
            const stats = `登录次数：${user.logins}，上传次数：${user.uploads}，回滚次数：${user.rollbacks}，Handle 变更次数：${user.handleChanges}`;
            const time = `首次出现：${user.firstSeen ?? '-'} / 最后出现：${user.lastSeen ?? '-'}`;
            return `<div class="user-row" data-index="${index}"><div>${label}</div><div>Handles：${handles}</div><div>${stats}</div><div>${time}</div></div>`;
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
                        lines.push(`LinuxDo ID：${user.linuxdoId ?? 'unknown'}`);
                        lines.push(`LinuxDo 用户名：${user.linuxdoUsername ?? 'unknown'}`);
                        lines.push(`LinuxDo 昵称：${user.linuxdoName ?? ''}`);
                        lines.push(`信任等级：${user.trustLevel ?? 'unknown'}`);
                        lines.push(`Handles：${(user.handles || []).join(', ') || '-'}`);
                        lines.push(`首次出现：${user.firstSeen ?? '-'}`);
                        lines.push(`最后出现：${user.lastSeen ?? '-'}`);
                        lines.push(`登录次数：${user.logins}，上传次数：${user.uploads}，回滚次数：${user.rollbacks}，Handle 变更次数：${user.handleChanges}`);
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
            usersOutput.textContent = '正在加载用户列表……';
            if (selectedUserSummary) {
                selectedUserSummary.textContent = '';
            }
            try {
                const json = await adminApiGet('/admin/api/users');
                adminUsers = json.users || [];
                selectedUserIndex = null;
                renderUsers();
            } catch (error) {
                usersOutput.textContent = `加载用户列表失败：${error.message}`;
            }
        });
    }

    loadLogsButton.addEventListener('click', async () => {
        logsOutput.textContent = '正在加载日志……';
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
            logsOutput.textContent = `加载日志失败：${error.message}`;
        }
    });
});

