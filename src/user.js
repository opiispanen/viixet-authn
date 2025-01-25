import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { transaction } from '../db/transaction.js'
import { createSession } from './session.js'
import { ERRORS } from './errors.js'

export async function userExists(username) {
    const query = 'SELECT user_id FROM user WHERE username = ? OR email = ? LIMIT 1'
    const { rows } = await transaction(query, [username, username])
    
    return rows.length > 0
}

export async function registerUser(username, password, email) {
    const exists = await userExists(username)

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

export async function loginUser(username, password) {
    const query = 'SELECT user_id, username, password FROM user WHERE deleted = 0 AND username = ? LIMIT 1'
    const { rows } = await transaction(query, [username])

    if (rows.length === 0) throw new Error(ERRORS.USER_NOTFOUND)

    const [ user ] = rows
    const { user_id, password: hashedPassword } = user
    const match = await bcrypt.compare(password, hashedPassword)
    
    if (!match) throw new Error(ERRORS.CREDENTIALS_INVALID)
    
    const session_id = await createSession(user_id)

    return { session_id, user_id, username }
}

export async function authenticate(session_id) {
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

    return { session_id, user_id, username, active }
}