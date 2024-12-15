import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { transaction } from './transaction.js'
import { createSession } from './session.js'

export async function userExists(username) {
    const query = 'SELECT user_id FROM user WHERE username = ? OR email = ? LIMIT 1'
    const { rows } = await transaction(query, [username, username])
    
    return rows.length > 0
}

export async function registerUser(username, password, email) {
    const exists = await userExists(username)

    if (exists) throw new Error('User already exists')

    const hashedPassword = await bcrypt.hash(password, 10)
    const query = `
        INSERT INTO user (user_id, username, password, email, extra) 
        VALUES (?, ?, ?, ?, ?)
    `
    const { id } = await transaction(
        query, 
        [
            uuidv4(), 
            username, 
            hashedPassword, 
            email,
            '{}'
        ]
    )
    return id
}

export async function loginUser(username, password) {
    const query = 'SELECT user_id, username, password FROM user WHERE deleted = 0 AND username = ? LIMIT 1'
    const { rows } = await transaction(query, [username])

    if (rows.length === 0) throw new Error('User not found')

    const [ user ] = rows
    const { user_id, username, password: hashedPassword } = user
    const match = await bcrypt.compare(password, hashedPassword)
    
    if (!match) throw new Error('Invalid credentials')
    
    const session_id = await createSession(user_id)

    return { session_id, user_id, username }
}

export async function authenticate(session_id) {
    const query = `
        SELECT 
            u.user_id, u.username, s.active
        FROM session s
        JOIN user u ON s.user_id = u.user_id
        WHERE s.session_id = ? AND s.deleted = 0 AND u.deleted = 0
        LIMIT 1
    `
    const { rows } = await transaction(query, [session_id])

    if (rows.length === 0) throw new Error('Session not found')

    const { user_id, username, active } = rows[0]
    const sessionExpires = new Date(modified).getTime() + parseInt(process.env.VIIXET_AUTHN_EXPIRES)

    if (Date.now() > sessionExpires) throw new Error('Session has expired')

    return { session_id, user_id, username, active }
}