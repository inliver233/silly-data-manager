import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import axios from 'axios';
import crypto from 'node:crypto';
import storage from 'node-persist';

import config from '../config.js';
import { normalizeHandle } from '../utils/handles.js';
import { requireLogin } from '../middleware/auth.js';
import { writeOperationLog } from '../services/log-service.js';

export const authRouter = express.Router();

const USER_STORAGE_DIR = path.join(config.dataRoot, '_storage');
const USER_KEY_PREFIX = 'user:';

let userStorageInitialized = false;

async function getUserStorage() {
    if (!userStorageInitialized) {
        await storage.init({
            dir: USER_STORAGE_DIR,
            ttl: false,
            expiredInterval: 0,
        });
        userStorageInitialized = true;
    }

    return storage;
}

/**
 * Hashes a SillyTavern user password using the same algorithm as the main server.
 * @param {string} password
 * @param {string} salt
 * @returns {string}
 */
function getPasswordHash(password, salt) {
    return crypto.scryptSync(password.normalize(), salt, 64).toString('base64');
}

async function verifyHandlePassword(handle, password) {
    const userStorage = await getUserStorage();
    const user = await userStorage.getItem(`${USER_KEY_PREFIX}${handle}`);

    if (!user) {
        const error = new Error('SillyTavern 用户不存在，请先在主站创建对应的账号。');
        // @ts-expect-error custom status code
        error.statusCode = 403;
        throw error;
    }

    if (!user.enabled) {
        const error = new Error('该账号已被禁用，请更换账号或联系管理员。');
        // @ts-expect-error custom status code
        error.statusCode = 403;
        throw error;
    }

    if (user.expiresAt && user.expiresAt < Date.now()) {
        const error = new Error('该账号已过期，请到主站续期或重新购买后再使用上传系统。');
        // @ts-expect-error custom status code
        error.statusCode = 403;
        throw error;
    }

    if (!password) {
        const error = new Error('请输入 SillyTavern 用户名（Handle）对应的密码。');
        // @ts-expect-error custom status code
        error.statusCode = 400;
        throw error;
    }

    if (!user.password || !user.salt) {
        const error = new Error('该账号当前未设置密码，请先在 SillyTavern 中为账号设置密码后再尝试。');
        // @ts-expect-error custom status code
        error.statusCode = 403;
        throw error;
    }

    const hash = getPasswordHash(password, user.salt);
    if (hash !== user.password) {
        const error = new Error('SillyTavern 用户名或密码错误。');
        // @ts-expect-error custom status code
        error.statusCode = 403;
        throw error;
    }

    return user;
}

authRouter.get('/me', (request, response) => {
    if (!request.user) {
        return response.json({ authenticated: false });
    }

    return response.json({
        authenticated: true,
        linuxdo: request.user.linuxdo,
        stHandle: request.user.stHandle,
        handleVerified: Boolean(request.user.handleVerified),
    });
});

authRouter.post('/logout', (request, response) => {
    request.session.destroy(() => {
        response.json({ ok: true });
    });
});

authRouter.get('/login', (request, response) => {
    const state = crypto.randomBytes(16).toString('hex');
    request.session.oauthState = state;

    const authorizeUrl = new URL(config.linuxDo.authorizeUrl);
    authorizeUrl.searchParams.set('client_id', config.linuxDo.clientId);
    authorizeUrl.searchParams.set('redirect_uri', config.linuxDo.redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'read');
    authorizeUrl.searchParams.set('state', state);

    const returnTo = request.query.returnTo;
    if (typeof returnTo === 'string' && returnTo.length > 0) {
        request.session.returnTo = returnTo;
    }

    return response.redirect(authorizeUrl.toString());
});

authRouter.post('/handle', requireLogin, async (request, response) => {
    const rawHandle = typeof request.body?.rawHandle === 'string' ? request.body.rawHandle : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const normalized = normalizeHandle(rawHandle);

    if (!normalized) {
        return response.status(400).json({
            ok: false,
            message: '无效的 SillyTavern Handle，规范化后为空。',
        });
    }

    const dir = path.join(config.dataRoot, normalized);
    if (!fs.existsSync(dir)) {
        return response.status(400).json({
            ok: false,
            message: `DATA_ROOT 下不存在 data/${normalized} 目录，请确认输入的 SillyTavern Handle 是否正确。`,
        });
    }

    try {
        await verifyHandlePassword(normalized, password);

        const oldHandle = request.user?.stHandle || null;
        request.session.stHandle = normalized;
        request.session.handleVerified = true;

        try {
            const operationId = crypto.randomUUID();
            writeOperationLog({
                operationId,
                type: 'handle-change',
                linuxdo: request.session.linuxdo,
                stHandle: normalized,
                ip: request._clientIp,
                userAgent: request._userAgent,
                details: {
                    from: oldHandle,
                    to: normalized,
                    rawHandle,
                },
            });
        } catch {
            // logging failure should not block handle change
        }

        return response.json({
            ok: true,
            stHandle: normalized,
            path: dir,
        });
    } catch (error) {
        const statusCode = error.statusCode || error.status || 403;
        return response.status(statusCode).json({
            ok: false,
            message: error.message || '验证 SillyTavern 账号密码失败。',
        });
    }
});

export async function handleOAuthCallback(request, response) {
    const { code, state } = request.query;
    if (!code || typeof code !== 'string') {
        return response.status(400).send('Missing OAuth2 code');
    }

    if (!state || typeof state !== 'string' || state !== request.session.oauthState) {
        return response.status(400).send('Invalid OAuth2 state');
    }

    delete request.session.oauthState;

    try {
        const tokenResponse = await axios.post(
            config.linuxDo.tokenUrl,
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: config.linuxDo.redirectUri,
                client_id: config.linuxDo.clientId,
                client_secret: config.linuxDo.clientSecret,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            },
        );

        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            return response.status(500).send('Failed to obtain access token');
        }

        const userResponse = await axios.get(config.linuxDo.userInfoUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const profile = userResponse.data || {};
        const stHandle = normalizeHandle(profile.username || '');

        if (!stHandle) {
            return response.status(400).send('LinuxDo username cannot be mapped to a valid SillyTavern handle');
        }

        request.session.linuxdo = {
            id: profile.id,
            username: profile.username,
            name: profile.name,
            trust_level: profile.trust_level,
            active: profile.active,
            silenced: profile.silenced,
        };
        request.session.stHandle = stHandle;
        request.session.handleVerified = false;

        try {
            const operationId = crypto.randomUUID();
            writeOperationLog({
                operationId,
                type: 'login',
                linuxdo: request.session.linuxdo,
                stHandle,
                ip: request._clientIp,
                userAgent: request._userAgent,
                result: 'success',
                reason: null,
            });
        } catch {
            // ignore logging failure
        }

        const redirectTarget = request.session.returnTo || '/';
        delete request.session.returnTo;

        return response.redirect(redirectTarget);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('LinuxDo OAuth2 callback failed:', error);
        return response.status(500).send('OAuth2 login failed');
    }
}
