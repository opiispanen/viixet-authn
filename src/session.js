import { v4 as uuidv4 } from 'uuid'
import { transaction } from '../db/transaction.js'
import { ERRORS } from './errors.js'

export async function createSession(user_id, active) {
    const session_id = uuidv4()
    const query = `
        INSERT INTO session (session_id, user_id, active) 
        VALUES (?, ?, ?)
    `
    const { id } = await transaction(query, [ session_id, user_id, active ])

    if (!id) {
        throw new Error(ERRORS.SESSION_NEW_FAILED)
    }

    return session_id
}

export async function activateSession(session_id) {
    const query = `
        UPDATE session SET active = 1 WHERE session_id = ?
    `
    const { id } = await transaction(
        query, 
        [ session_id ]
    )
    return !!id
}

export async function deleteSession(session_id) {
    const query = `
        UPDATE session SET active = 0, deleted = 1 WHERE session_id = ?
    `
    const { id } = await transaction(
        query, 
        [ session_id ]
    )
    return !!id
}