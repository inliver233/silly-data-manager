import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import session from 'express-session';

import config from './config.js';
import { populateUserFromSession } from './middleware/auth.js';
import { authRouter, handleOAuthCallback } from './routes/auth-routes.js';
import { dataRouter } from './routes/data-routes.js';
import { adminRouter } from './routes/admin-routes.js';
import { getClientIp, getUserAgent } from './services/log-service.js';

const app = express();

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    name: 'stc-data-upload.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: 7 * 24 * 60 * 60 * 1000,
    },
}));

app.use((request, _response, next) => {
    request._clientIp = getClientIp(request);
    request._userAgent = getUserAgent(request);
    next();
});

app.use(populateUserFromSession);

app.use('/api/auth', authRouter);
app.use('/api/data', dataRouter);
app.use('/admin/api', adminRouter);

app.get('/oauth', handleOAuthCallback);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticRoot = path.join(__dirname, '..', 'public');

app.use(express.static(staticRoot));

app.get('/admin', (_request, response) => {
    response.sendFile(path.join(staticRoot, 'admin.html'));
});

const port = config.port;
app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Data upload service listening on port ${port}, DATA_ROOT=${config.dataRoot}`);
});

