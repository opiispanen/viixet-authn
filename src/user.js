import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { transaction } from '../db/transaction.js'
import { createSession, deleteSession } from './session.js'
import { ERRORS } from './errors.js'

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
export async function loginUser(username, password, { requireSecondStep = false } = {}) {
    const query = 'SELECT user_id, username, password FROM user WHERE deleted = 0 AND username = ? LIMIT 1'
    const { rows } = await transaction(query, [username])

    if (rows.length === 0) throw new Error(ERRORS.USER_NOTFOUND)

    const [ user ] = rows
    const { user_id, password: hashedPassword } = user
    const match = await bcrypt.compare(password, hashedPassword)
    
    if (!match) throw new Error(ERRORS.CREDENTIALS_INVALID)
    
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