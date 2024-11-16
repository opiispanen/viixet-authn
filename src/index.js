import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { transaction } from './transaction.js'
import 'dotenv/config'

export const AUTH_TOKEN_TYPE = {
    twoFactor: 1,
    passwordRenewal: 2,
    emailLogin: 3,
}

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

export async function createSession(user_id, active) {
    const query = `
        INSERT INTO session (session_id, user_id, active) 
        VALUES (?, ?, ?)
    `
    const { id } = await transaction(query, [uuidv4(), user_id, active])
    return id
}

export async function activateSession(session_id) {
    const query = `
        UPDATE session SET active = 1 WHERE session_id = ?
    `
    const { id } = await transaction(
        query, 
        [ session_id ]
    )
    return id
}

export async function createAuthToken(type, token, user_id, session_id) {
    const query = `
        INSERT INTO auth_token (
            token_id, user_id, session_id, type, token
        ) VALUES (?, ?, ?, ?, ?)
    `
    const { id } = await transaction(
        query, 
        [
            uuidv4(), 
            user_id,
            session_id,
            type,
            token
        ]
    )
    return id
}

export async function deactivateAuthToken(token_id) {
    const query = `
        UPDATE auth_token SET deleted = 1 WHERE token_id = ?
    `
    const { id } = await transaction(
        query, 
        [ token_id ]
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

function generateRandomNumbers() {
    const randomNumbers = [];
    
    for (let i = 0; i < 6; i++) {
        randomNumbers.push(Math.floor(Math.random() * 10));
    }

    return randomNumbers;
}

export async function createTwoFactorCode(user_id, session_id) {
    const numbers = generateRandomNumbers()
    const token = await bcrypt.hash(numbers.join('-'), 10)

    const token_id = await createAuthToken(AUTH_TOKEN_TYPE.twoFactor, token, user_id, session_id)

    return { token_id, numbers }
}

export async function authenticateTwoFactorCode(numbers, token_id, user_id, session_id) {
    const query = `SELECT 
            token 
        FROM auth_token 
        WHERE deleted = 0 
        AND token_id = ? 
        AND user_id = ? 
        AND session_id = ? 
        AND type = ?
        LIMIT 1`
    const { rows } = await transaction(
        query, 
        [ 
            token_id, 
            user_id, 
            session_id,
            AUTH_TOKEN_TYPE.twoFactor
        ]
    )

    if (rows.length === 0) throw new Error('User not found')
    
	const { token } = rows[0]
    const match = await bcrypt.compare(numbers.join('-'), token)
	
    if (!match) throw new Error('Invalid credentials')

    await deactivateAuthToken(token_id)
    await activateSession(session_id)

    return true
}

export async function createEmailLoginToken(token, user_id, session_id) {
    const token_id = await createAuthToken(
        AUTH_TOKEN_TYPE.emailLogin, 
        token, 
        user_id, 
        session_id
    )

    return { token_id }
}

export async function authenticateLoginToken(token, user_id, session_id) {
    const query = `SELECT 
            token_id 
        FROM auth_token 
        WHERE deleted = 0 
        AND token = ? 
        AND user_id = ? 
        AND session_id = ? 
        AND type = ?
        LIMIT 1`
    const { rows } = await transaction(
        query, 
        [ 
            token, 
            user_id, 
            session_id,
            AUTH_TOKEN_TYPE.emailLogin
        ]
    )

    if (rows.length === 0) throw new Error('User not found')
    
    const { token_id } = rows[0]

    if (!token_id) throw new Error('Invalid credentials')

    await deactivateAuthToken(token_id)
    await activateSession(session_id)

    return true
}

export async function createPasswordRenewalToken(token, user_id, session_id) {
    const token_id = await createAuthToken(
        AUTH_TOKEN_TYPE.passwordRenewal, 
        token, 
        user_id, 
        session_id
    )

    return { token_id }
}

export async function changePassword(password, token, user_id, session_id) {
    const hashedPassword = await bcrypt.hash(password, 10)
    const query = `SELECT 
            token_id 
        FROM auth_token 
        WHERE deleted = 0 
        AND token = ? 
        AND user_id = ? 
        AND session_id = ? 
        AND type = ?
        LIMIT 1`
    const { rows } = await transaction(
        query, 
        [ 
            token, 
            user_id, 
            session_id,
            AUTH_TOKEN_TYPE.passwordRenewal
        ]
    )

    if (rows.length === 0) throw new Error('User not found')

    const { token_id } = rows[0]
	
    if (!token_id) throw new Error('Invalid credentials')

    await deactivateAuthToken(token_id)

    const update = `
        UPDATE user SET password = ? WHERE user_id = ?
    `
    const { id } = await transaction(
        update, 
        [ 
            hashedPassword, 
            user_id 
        ]
    )

    return id
}