import path from 'node:path';
import process from 'node:process';

import dotenv from 'dotenv';

dotenv.config();

function resolveDataRoot() {
    const raw = process.env.DATA_ROOT;
    if (raw && raw.trim().length > 0) {
        return path.resolve(process.cwd(), raw.trim());
    }

    return path.resolve(process.cwd(), 'data');
}

const linuxDoClientId = process.env.LINUXDO_CLIENT_ID || process.env.CLIENT_ID || '';
const linuxDoClientSecret = process.env.LINUXDO_CLIENT_SECRET || process.env.CLIENT_SECRET || '';
const linuxDoRedirectUri = process.env.LINUXDO_REDIRECT_URI || process.env.REDIRECT_URI || '';

const config = {
    port: Number.parseInt(process.env.PORT || '23669', 10),
    dataRoot: resolveDataRoot(),
    isProduction: process.env.NODE_ENV === 'production',
    sessionSecret: process.env.SESSION_SECRET || 'please-change-me',
    linuxDo: {
        clientId: linuxDoClientId,
        clientSecret: linuxDoClientSecret,
        redirectUri: linuxDoRedirectUri,
        authorizeUrl: process.env.LINUXDO_AUTHORIZE_URL || 'https://connect.linux.do/oauth2/authorize',
        tokenUrl: process.env.LINUXDO_TOKEN_URL || 'https://connect.linux.do/oauth2/token',
        userInfoUrl: process.env.LINUXDO_USERINFO_URL || 'https://connect.linux.do/api/user',
    },
    admin: {
        username: process.env.ADMIN_USERNAME || '',
        password: process.env.ADMIN_PASSWORD || '',
    },
};

export default config;

