import { transaction } from '../db/transaction.js'
import { ERRORS } from './errors.js'

const MAX_KEY_LENGTH = 200

function nowSeconds() {
    return Math.floor(Date.now() / 1000)
}

function checkKey(key) {
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
        throw new TypeError(`Rate limit key must be a string of 1 to ${ MAX_KEY_LENGTH } characters`)
    }
}

// Counts one hit for `key` and throws RATE_LIMITED when there have been more than
// `max` hits in the current window. The window is a fixed one: it starts at the
// first hit and a new one starts when `windowSeconds` have passed.
//
// The error has a `retryAfter` property: the seconds until the window ends.
// Returns { count, remaining } when the hit is allowed.
export async function hitRateLimit(key, { max, windowSeconds } = {}) {
    checkKey(key)

    if (!Number.isInteger(max) || max < 1) {
        throw new TypeError('Rate limit max must be a positive integer')
    }

    if (!(windowSeconds > 0)) {
        throw new TypeError('Rate limit windowSeconds must be a positive number')
    }

    const now = nowSeconds()
    const expiredBefore = now - windowSeconds

    // One statement starts a new window or adds to the current one, so hits made
    // at the same time are all counted.
    await transaction(
        `INSERT INTO rate_limit (key, count, window_start) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
            window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END`,
        [ key, now, expiredBefore, expiredBefore, now ]
    )

    const { rows } = await transaction(
        'SELECT count, window_start FROM rate_limit WHERE key = ?',
        [ key ]
    )
    const { count, window_start } = rows[0]

    if (count > max) {
        const error = new Error(ERRORS.RATE_LIMITED)

        error.retryAfter = Math.max(1, window_start + Math.ceil(windowSeconds) - now)

        throw error
    }

    return { count, remaining: max - count }
}

// Forgets the hits for `key`, for example after a successful login.
// Returns true when there was something to forget.
export async function resetRateLimit(key) {
    checkKey(key)

    const { changes } = await transaction(
        'DELETE FROM rate_limit WHERE key = ?',
        [ key ]
    )

    return !!changes
}

// Deletes keys whose window started more than `maxAgeSeconds` ago (default one
// day). Use a value at least as long as your longest window.
// Returns the number of deleted keys.
export async function purgeRateLimits(maxAgeSeconds = 86400) {
    const { changes } = await transaction(
        'DELETE FROM rate_limit WHERE window_start < ?',
        [ nowSeconds() - maxAgeSeconds ]
    )

    return changes
}
