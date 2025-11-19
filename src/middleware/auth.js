export function populateUserFromSession(request, _response, next) {
    if (request.session && request.session.linuxdo && request.session.stHandle) {
        request.user = {
            linuxdo: request.session.linuxdo,
            stHandle: request.session.stHandle,
        };
    }

    next();
}

export function requireLogin(request, response, next) {
    if (!request.user) {
        return response.status(401).json({ error: 'Not authenticated' });
    }

    return next();
}

export function requireAdmin(request, response, next) {
    if (!request.session || !request.session.isAdmin) {
        return response.status(403).json({ error: 'Admin credentials required' });
    }

    return next();
}

export function requireAdminWithCsrf(request, response, next) {
    if (!request.session || !request.session.isAdmin) {
        return response.status(403).json({ error: 'Admin credentials required' });
    }

    const sessionToken = request.session.csrfToken;
    const headerToken = request.headers['x-csrf-token'];

    if (!sessionToken || typeof headerToken !== 'string' || headerToken !== sessionToken) {
        return response.status(403).json({ error: 'Invalid or missing CSRF token' });
    }

    return next();
}
