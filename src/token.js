import { randomInt } from 'node:crypto'
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { transaction } from '../db/transaction.js'
import { activateSession, deleteUserSessions } from './session.js'
import { hitRateLimit } from './rateLimit.js'
import { ERRORS } from './errors.js'
import { isValidPassword } from './validate.js'

export const AUTH_TOKEN_TYPE = {
    twoFactor: 1,
    passwordRenewal: 2,
    emailLogin: 3,
}

// Tokens older than this are treated as not found. Compared in SQL against the
// UTC `created` column, so the server's timezone doesn't matter.
const TOKEN_MAX_AGE_MINUTES = {
    [AUTH_TOKEN_TYPE.twoFactor]: 15,
    [AUTH_TOKEN_TYPE.emailLogin]: 15,
    [AUTH_TOKEN_TYPE.passwordRenewal]: 45,
}

// Wrong guesses allowed per 2FA code. After that the code is spent and a new one is needed.
const TWO_FACTOR_MAX_ATTEMPTS = 5

// Codes that can be requested per session
const TWO_FACTOR_REQUEST_LIMIT = { max: 5, windowSeconds: 900 }

function notExpiredSql(type) {
    return `AND created >= datetime('now', '-${ TOKEN_MAX_AGE_MINUTES[type] } minutes')`
}

export async function createAuthToken(type, token, user_id, session_id) {
    const tokenId = uuidv4()
    const query = `
        INSERT INTO auth_token (
            token_id, user_id, session_id, type, token
        ) VALUES (?, ?, ?, ?, ?)
    `
    const { id } = await transaction(
        query, 
        [
            tokenId, 
            user_id,
            session_id,
            type,
            token
        ]
    )

    if (!id) {
        throw new Error(ERRORS.TOKEN_NEW_FAILED)
    }

    return tokenId
}

export async function deactivateAuthToken(token_id) {
    const query = `
        UPDATE auth_token SET deleted = 1 WHERE token_id = ?
    `
    const { changes } = await transaction(
        query, 
        [ token_id ]
    )
    return !!changes
}

function generateRandomNumbers() {
    const randomNumbers = []

    for (let i = 0; i < 6; i++) {
        randomNumbers.push(randomInt(0, 10))
    }

    return randomNumbers
}

// Requesting codes is rate limited per session and throws RATE_LIMITED (with
// `retryAfter`), because every new code gives a new set of guesses.
// { rateLimit: false } turns this off for apps that do their own limiting.
export async function createTwoFactorCode(user_id, session_id, { rateLimit = true } = {}) {
    if (rateLimit) {
        await hitRateLimit(`2fa-request:${session_id}`, TWO_FACTOR_REQUEST_LIMIT)
    }

    const numbers = generateRandomNumbers()
    const token = await bcrypt.hash(numbers.join('-'), 10)

    const token_id = await createAuthToken(AUTH_TOKEN_TYPE.twoFactor, token, user_id, session_id)

    return { token_id, numbers }
}

export async function authenticateTwoFactorCode(numbers, token_id, user_id, session_id) {
    // A guess is counted before the code is compared, in one UPDATE, so guesses
    // made at the same time can't get past the limit.
    const reserve = `UPDATE auth_token
        SET attempts = attempts + 1
        WHERE deleted = 0
        AND token_id = ?
        AND user_id = ?
        AND session_id = ?
        AND type = ?
        AND attempts < ?
        ${ notExpiredSql(AUTH_TOKEN_TYPE.twoFactor) }`
    const { changes } = await transaction(
        reserve,
        [
            token_id,
            user_id,
            session_id,
            AUTH_TOKEN_TYPE.twoFactor,
            TWO_FACTOR_MAX_ATTEMPTS
        ]
    )

    if (!changes) throw new Error(ERRORS.TOKEN_NOTFOUND)

    const { rows } = await transaction(
        'SELECT token FROM auth_token WHERE token_id = ? LIMIT 1',
        [ token_id ]
    )
    const { token } = rows[0]
    const match = await bcrypt.compare(numbers.join('-'), token)

    if (!match) {
        // The last allowed guess was wrong: the code is spent
        await transaction(
            'UPDATE auth_token SET deleted = 1 WHERE token_id = ? AND attempts >= ?',
            [ token_id, TWO_FACTOR_MAX_ATTEMPTS ]
        )

        throw new Error(ERRORS.TOKEN_INVALID)
    }

    await deactivateAuthToken(token_id)
    await activateSession(session_id)

    return true
}

// Email login and password reset tokens are made by the app. Only a bcrypt hash is
// stored, as for 2FA codes, so a leaked database doesn't hold working links.
// bcrypt reads only the first 72 bytes of the token.
async function hashToken(token) {
    return bcrypt.hash(token, 10)
}

// Looks for an unused, unexpired token of this type for this user and session. The
// stored value is a hash, so it can't be found with `WHERE token = ?`: the rows are
// read and compared one by one. Only the 5 newest are compared, so a flood of
// requests can't make this slow.
async function findUnusedToken(type, token, user_id, session_id) {
    if (typeof token !== 'string' || token === '') return null

    const query = `SELECT
            token_id,
            token
        FROM auth_token
        WHERE deleted = 0
        AND user_id = ?
        AND session_id = ?
        AND type = ?
        ${ notExpiredSql(type) }
        ORDER BY created DESC, rowid DESC
        LIMIT 5`
    const { rows } = await transaction(query, [ user_id, session_id, type ])

    for (const row of rows) {
        if (await bcrypt.compare(token, row.token)) return row.token_id
    }

    return null
}

export async function createEmailLoginToken(token, user_id, session_id) {
    const token_id = await createAuthToken(
        AUTH_TOKEN_TYPE.emailLogin,
        await hashToken(token),
        user_id,
        session_id
    )

    return { token_id }
}

export async function authenticateLoginToken(token, user_id, session_id) {
    const token_id = await findUnusedToken(AUTH_TOKEN_TYPE.emailLogin, token, user_id, session_id)

    if (!token_id) throw new Error(ERRORS.TOKEN_NOTFOUND)

    await deactivateAuthToken(token_id)
    await activateSession(session_id)

    return true
}

export async function createPasswordRenewalToken(token, user_id, session_id) {
    const token_id = await createAuthToken(
        AUTH_TOKEN_TYPE.passwordRenewal,
        await hashToken(token),
        user_id,
        session_id
    )

    return { token_id }
}

// The password has the same rules as in registerUser. It is checked before the token
// is looked at, so a password that is refused doesn't use up the token.
export async function changePassword(password, token, user_id, session_id) {
    if (!isValidPassword(password)) throw new Error(ERRORS.PASSWORD_INVALID)

    const hashedPassword = await bcrypt.hash(password, 10)
    const token_id = await findUnusedToken(AUTH_TOKEN_TYPE.passwordRenewal, token, user_id, session_id)

    if (!token_id) throw new Error(ERRORS.TOKEN_NOTFOUND)

    await deactivateAuthToken(token_id)

    const update = `
        UPDATE user SET password = ? WHERE user_id = ?
    `
    const { changes } = await transaction(
        update, 
        [
            hashedPassword,
            user_id
        ]
    )

    // A new password ends every session, so anyone who knew the old one is logged out
    if (changes) await deleteUserSessions(user_id)

    return !!changes
}