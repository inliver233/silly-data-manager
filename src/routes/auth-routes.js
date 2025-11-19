import express from 'express';
import axios from 'axios';
import crypto from 'node:crypto';

import config from '../config.js';
import { normalizeHandle } from '../utils/handles.js';

export const authRouter = express.Router();

authRouter.get('/me', (request, response) => {
    if (!request.user) {
        return response.json({ authenticated: false });
    }

    return response.json({
        authenticated: true,
        linuxdo: request.user.linuxdo,
        stHandle: request.user.stHandle,
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

        const redirectTarget = request.session.returnTo || '/';
        delete request.session.returnTo;

        return response.redirect(redirectTarget);
    } catch (error) {
        console.error('LinuxDo OAuth2 callback failed:', error);
        return response.status(500).send('OAuth2 login failed');
    }
}
