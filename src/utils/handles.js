/**
 * Normalizes a user handle using the same rules as SillyTavern's normalizeHandle.
 *
 * Examples:
 *   normalizeHandle("User-Name")     => "user-name"
 *   normalizeHandle("user--name")    => "user-name"
 *   normalizeHandle("User_123")      => "user-123"
 *   normalizeHandle("-user-")        => "user"
 *   normalizeHandle("User@Name#123") => "username123"
 *
 * @param {string} handle
 * @returns {string}
 */
export function normalizeHandle(handle) {
    if (!handle || typeof handle !== 'string') {
        return '';
    }

    return handle
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

