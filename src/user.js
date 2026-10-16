import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { transaction } from '../db/transaction.js'
import { createHash } from 'node:crypto'
import { createSession, deleteSession } from './session.js'
import { hitRateLimit, resetRateLimit } from './rateLimit.js'
import { ERRORS } from './errors.js'

// Login attempts per username (reset by a successful login) and per address
const LOGIN_USER_LIMIT = { max: 10, windowSeconds: 900 }
const LOGIN_IP_LIMIT = { max: 30, windowSeconds: 900 }

// The username is hashed so it stays out of the table and the key is always short
function loginUserKey(username) {
    const hash = createHash('sha256').update(String(username).toLowerCase()).digest('hex')

    return `login:user:${hash}`
}

export async function userExists(username, email = username) {
    const query = 'SELECT user_id FROM user WHERE username = ? OR email = ? LIMIT 1'
    const { rows } = await transaction(query, [username, email])
    
    return rows.length > 0
}

export async function registerUser(username, password, email) {
    const exists = await userExists(username, email)

    if (exists) throw new Error(ERRORS.USER_ALREADYEXISTS)

    const userId = uuidv4()
    const hashedPassword = await bcrypt.hash(password, 10)
    const query = `
        INSERT INTO user (user_id, username, password, email, extra) 
        VALUES (?, ?, ?, ?, ?)
    `
    const { id } = await transaction(
        query, 
        [
            userId, 
            username, 
            hashedPassword, 
            email,
            '{}'
        ]
    )

    if (!id) {
        throw new Error(ERRORS.USER_NEW_FAILED)
    }

    return userId
}

// With { requireSecondStep: true } the session starts inactive (active = 0) and
// only works after a 2FA code or an email login token has been verified.
//
// Attempts are rate limited and throw RATE_LIMITED (with `retryAfter`) when there
// are too many: per username, and also per address when { ip } is given.
// { rateLimit: false } turns this off for apps that do their own limiting.
export async function loginUser(
    username,
    password,
    { requireSecondStep = false, ip, rateLimit = true } = {}
) {
    const userKey = loginUserKey(username)

    if (rateLimit) {
        if (ip) await hitRateLimit(`login:ip:${String(ip).slice(0, 100)}`, LOGIN_IP_LIMIT)

        await hitRateLimit(userKey, LOGIN_USER_LIMIT)
    }

    const query = 'SELECT user_id, username, password FROM user WHERE deleted = 0 AND username = ? LIMIT 1'
    const { rows } = await transaction(query, [username])

    if (rows.length === 0) throw new Error(ERRORS.USER_NOTFOUND)

    const [ user ] = rows
    const { user_id, password: hashedPassword } = user
    const match = await bcrypt.compare(password, hashedPassword)
    
    if (!match) throw new Error(ERRORS.CREDENTIALS_INVALID)

    // The address counter is kept, so logging in to your own account doesn't clear it
    if (rateLimit) await resetRateLimit(userKey)

    const session_id = await createSession(user_id, requireSecondStep ? 0 : 1)

    return { session_id, user_id, username }
}

export async function logoutUser(session_id) {
    const success = await deleteSession(session_id)

    return { success }
}

// Inactive sessions (waiting for a second step) are rejected unless
// { allowInactive: true } is passed, which the second step itself needs.
export async function authenticate(session_id, { allowInactive = false } = {}) {
    const query = `
        SELECT 
            u.user_id, u.username, s.active, s.modified
        FROM session s
        JOIN user u ON s.user_id = u.user_id
        WHERE s.session_id = ? AND s.deleted = 0 AND u.deleted = 0
        LIMIT 1
    `
    const { rows } = await transaction(query, [session_id])

    if (rows.length === 0) throw new Error(ERRORS.SESSION_NOTFOUND)

    const { user_id, username, active, modified } = rows[0]
    const sessionExpires = new Date(modified).getTime() + (24 * 3_600_000) // default 24 hours

    if (Date.now() > sessionExpires) throw new Error(ERRORS.SESSION_EXPIRED)
    if (!active && !allowInactive) throw new Error(ERRORS.SESSION_INACTIVE)

    return { session_id, user_id, username, active }
}