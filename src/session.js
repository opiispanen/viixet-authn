import { v4 as uuidv4 } from 'uuid'
import { transaction } from '../db/transaction.js'

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