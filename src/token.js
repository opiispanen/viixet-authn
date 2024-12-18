import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { transaction } from './transaction.js'
import { activateSession } from './session.js'
import { ERRORS } from './errors.js'

export const AUTH_TOKEN_TYPE = {
    twoFactor: 1,
    passwordRenewal: 2,
    emailLogin: 3,
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

    if (rows.length === 0) throw new Error(ERRORS.TOKEN_NOTFOUND)
    
	const { token } = rows[0]
    const match = await bcrypt.compare(numbers.join('-'), token)
	
    if (!match) throw new Error(ERRORS.TOKEN_INVALID)

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

    if (rows.length === 0) throw new Error(ERRORS.TOKEN_NOTFOUND)
    
    const { token_id } = rows[0]

    if (!token_id) throw new Error(ERRORS.TOKEN_INVALID)

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

    if (rows.length === 0) throw new Error(ERRORS.TOKEN_NOTFOUND)

    const { token_id } = rows[0]
	
    if (!token_id) throw new Error(ERRORS.TOKEN_INVALID)

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