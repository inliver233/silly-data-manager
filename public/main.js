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
                progressText.textContent = `�ϴ����ȣ�${percent}%��${loadedMb} MB / ${totalMb} MB��`;
            }
            appendLog(logEl, `�ϴ����ȣ�${percent}%��${loadedMb} MB / ${totalMb} MB��`);
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
                appendLog(logEl, `��������Ӧ���� JSON��״̬ ${status}����`);
                appendLog(logEl, text.trim());
                if (errorEl) {
                    errorEl.textContent = '���������ص� HTML ��Ӧ�����ܿ��� Nginx/���ؽ�ֹ���󣬱��������������� client_max_body_size ��ʱ�������á�';
                }
                reject(new Error('���������ص����ݲ�����Ч�� JSON'));
                return;
            }

            resolve({ status, json, rawText: text });
        };

        xhr.onerror = () => {
            if (errorEl) {
                errorEl.textContent = '����������������ɴأ��볢���Ժ����ԡ�';
            }
            reject(new Error('����������������ɴ�'));
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
        backupsList.textContent = '��ǰ handle �䲻�����ݿ⣬��û���κι���ϵͳ���ɵ��Զ����ݡ�';
        return;
    }

    backupsList.textContent = '���ڼ������б���';

    try {
        const data = await apiGet('/api/data/backups');
        const backups = data.backups || [];

        if (!backups.length) {
            backupsList.textContent = '��� 24 Сʱ����û�в鿴�� upload_*.zip �Զ����ݡ�';
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

            const label = isCurrent ? `${backup.name}��ǰ�ع㱸�ݵ㣩` : backup.name;

            return `<div class=\"backup-row${isCurrent ? ' backup-row-current' : ''}\">
    <div>
        <div>${label}</div>
        <div class=\"hint\">${timeText} · ${sizeMb} MB</div>
    </div>
    <div class=\"backup-row-buttons\">
        <button type=\"button\" data-action=\"download\" data-name=\"${backup.name}\">���</button>
        <button type=\"button\" data-action=\"delete\" data-name=\"${backup.name}\">ɾ��</button>
    </div>
</div>`;
        });

        backupsList.innerHTML = rows.join('\n');
    } catch (error) {
        backupsList.textContent = `�������б�ʧ�ܣ�${error.message}`;
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
            authStatusEl.textContent = 'δ��¼������ʹ�� LinuxDo �˺ŵ�¼��';
            loginButton.style.display = 'inline-block';
            logoutButton.style.display = 'none';
            userSection.style.display = 'none';
            statusSection.style.display = 'none';
            uploadSection.style.display = 'none';
            rollbackSection.style.display = 'none';
            return;
        }

        authStatusEl.textContent = '��ͨ�� LinuxDo ��¼��';
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
                summaryEl.textContent = '�������ϻ�û�и� handle ��Ӧ������Ŀ¼��';
                if (rollbackButton) {
                    rollbackButton.disabled = true;
                }
            } else {
                const lines = [];
                const sizeMb = status.size ? (status.size / (1024 * 1024)).toFixed(2) : '0.00';
                lines.push(`����Ŀ¼��${status.path}`);
                lines.push('�Ƿ���ڣ���');
                lines.push(`���ݴ�С��${sizeMb} MB`);
                if (status.mtime) {
                    try {
                        const local = new Date(status.mtime).toLocaleString();
                        lines.push(`����޸�ʱ�䣺${local}`);
                    } catch {
                        lines.push(`����޸�ʱ�䣺${status.mtime}`);
                    }
                }
                const keys = status.keyFiles || {};
                const keyParts = [];
                keyParts.push(`settings.json��${keys.settingsJson ? '����' : 'ȱʧ'}��`);
                keyParts.push(`secrets.json��${keys.secretsJson ? '����' : 'ȱʧ'}��`);
                keyParts.push(`stats.json��${keys.statsJson ? '����' : 'ȱʧ'}��`);
                keyParts.push(`content.log��${keys.contentLog ? '����' : 'ȱʧ'}��`);
                lines.push(`�ؼ��ļ���${keyParts.join('��')}`);

                const rb = status.rollback || null;
                if (rb && rb.canRollback) {
                    lines.push('�ع�״̬�����ã����ص����һ��ͨ����ϵͳ�ϴ�ǰ��״̬����');
                    if (rb.backupMtime) {
                        try {
                            const bLocal = new Date(rb.backupMtime).toLocaleString();
                            lines.push(`���ݴ���ʱ�䣺${bLocal}`);
                        } catch {
                            lines.push(`���ݴ���ʱ�䣺${rb.backupMtime}`);
                        }
                    }
                    if (rollbackButton) {
                        rollbackButton.disabled = false;
                    }
                } else {
                    lines.push('�ع�״̬����ǰû�п��õ��Զ����ݣ���δͨ����ϵͳ���гɹ��ϴ�����');
                    if (rollbackButton) {
                        rollbackButton.disabled = true;
                    }
                }

                summaryEl.textContent = lines.join('\n');
            }
        }

        await refreshBackups(status);
    } catch (error) {
        authStatusEl.textContent = `����״̬ʧ�ܣ�${error.message}`;
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
            resultEl.textContent = '����ѡ��һ�� data.zip �ļ���';
            return;
        }

        if (file.size > 100 * 1024 * 1024) {
            resultEl.textContent = '�ļ����� 100MB�������������ܾ���';
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

        if (progressText) {
            progressText.textContent = simulate
                ? '���� 1/2�������ϴ��ļ����ڷ������н�ѹ��ģ��ģʽ�������޸ķ��������ݣ���'
                : '���� 1/3�������ϴ��ļ����ڷ������н�ѹ��';
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
                appendLog(resultEl, `�ϴ�ʧ�ܣ�${(json && json.message) || status}`);
                if (json) {
                    appendLog(resultEl, '���������أ�');
                    appendLog(resultEl, JSON.stringify(json, null, 2));
                }
                if (errorEl) {
                    errorEl.textContent = '�ϴ�ʧ�ܣ��鿴������־�еľ�����Ϣ��';
                }
            } else if (json.result && json.result.simulation) {
                if (progressText) {
                    progressText.textContent = '���� 2/2������������ɽ�ѹ�Ͱ�ȫ��飨ģ��ģʽ����';
                }
                appendLog(resultEl, 'ģ�����£�');
                appendLog(resultEl, JSON.stringify(json.result, null, 2));
            } else {
                if (progressText) {
                    progressText.textContent = '���� 2/3������������ɽ�ѹ�Ͱ�ȫ��顣\n���� 3/3������ɱ��ݾ����ݲ��ϲ������ݡ�';
                }
                appendLog(resultEl, '��ϸ�����');
                appendLog(resultEl, JSON.stringify(json.result, null, 2));
                await refreshAuthAndStatus();
            }
        } catch (error) {
            appendLog(resultEl, `�ϴ������г�����${error.message}`);
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
        resultEl.textContent = '��������ع������Ժ�';
        rollbackButton.disabled = true;

        try {
            const json = await apiPost('/api/data/rollback', {});
            resultEl.textContent = `�ع��ɹ���\n${JSON.stringify(json.result || json, null, 2)}`;
            await refreshAuthAndStatus();
        } catch (error) {
            resultEl.textContent = `�ع������г�����${error.message}`;
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
                    resultEl.textContent = '��������Ҫ������ SillyTavern handle �����ơ�';
                }
                return;
            }

            try {
                const result = await apiPost('/api/auth/handle', { rawHandle });
                document.getElementById('st-handle').textContent = result.stHandle;
                handleInput.value = result.stHandle;
                if (resultEl) {
                    resultEl.textContent = `���л��� handle��${result.stHandle}\n��ӦĿ¼��${result.path}`;
                }
                await refreshAuthAndStatus();
            } catch (error) {
                if (resultEl) {
                    resultEl.textContent = `�л� handle ʧ�ܣ�${error.message}`;
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

            if (action === 'download') {
                window.open(`/api/data/backups/${encodeURIComponent(name)}`, '_blank');
            } else if (action === 'delete') {
                // eslint-disable-next-line no-alert
                const confirmed = window.confirm(`ȷ��Ҫɾ�����ݵ㣿\n${name}`);
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
                        resultEl.textContent = `�Ѿ�ɾ�����ݵ㣺${name}`;
                    }
                    await refreshAuthAndStatus();
                } catch (error) {
                    if (resultEl) {
                        resultEl.textContent = `ɾ�����ݵ�ʧ�ܣ�${error.message}`;
                    }
                }
            }
        });
    }

    refreshAuthAndStatus();
});
