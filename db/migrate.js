import fs from 'fs'
import sqlite3 from 'sqlite3'
import { dbPath } from './config.js'

// The schema version is stored in the database itself (PRAGMA user_version) and
// equals the number of steps that have run. A database made by version 1.0.0 of
// this library has version 0.
//
// Rules for this list:
// - Only add steps at the end. Never edit or reorder a step that has been released.
// - Prefer changes that keep existing data safe: ADD COLUMN, CREATE INDEX.
// - Each step is run inside a transaction, so a failing step changes nothing.
export const MIGRATIONS = [
    // 1: the original schema. It does nothing to a database that already has the tables.
    async ({ run }) => {
        await run(`CREATE TABLE IF NOT EXISTS user (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            email TEXT NOT NULL,
            extra TEXT NOT NULL,
            created DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted INT DEFAULT 0
        )`)

        await run(`CREATE TABLE IF NOT EXISTS session (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified DATETIME DEFAULT CURRENT_TIMESTAMP,
            active INT DEFAULT 0,
            deleted INT DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES user(user_id)
        )`)

        await run(`CREATE TABLE IF NOT EXISTS auth_token (
            token_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            token TEXT NOT NULL,
            type INT NOT NULL,
            created DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted INT DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES user(user_id),
            FOREIGN KEY (session_id) REFERENCES session(session_id)
        )`)
    },
]

const BUSY_TIMEOUT_MS = 5000

function open() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, err => err ? reject(err) : resolve(db))
    })
}

function close(db) {
    return new Promise((resolve, reject) => {
        db.close(err => err ? reject(err) : resolve())
    })
}

function helpers(db) {
    return {
        run: (sql, params = []) => new Promise((resolve, reject) => {
            db.run(sql, params, err => err ? reject(err) : resolve())
        }),
        all: (sql, params = []) => new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
        }),
    }
}

function newerError(version) {
    return new Error(
        `viixet-authn: the database is at schema version ${version}, which is newer ` +
        `than this version of the library supports (${MIGRATIONS.length}). Update viixet-authn.`
    )
}

// Copies the database file once before it is changed. It is skipped for a new,
// empty database, and an existing backup is never overwritten.
async function backup({ all }, fromVersion) {
    const tables = await all(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )

    if (tables.length === 0) return

    const backupPath = `${dbPath}.bak-v${fromVersion}`

    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(dbPath, backupPath)
    }
}

async function getVersion({ all }) {
    const [{ user_version }] = await all('PRAGMA user_version')

    return user_version
}

// Brings the database up to date. Safe to call many times, and safe when two
// processes start at once: the second one waits for the lock and then finds
// nothing left to do.
export async function migrate() {
    const db = await open()

    try {
        db.configure('busyTimeout', BUSY_TIMEOUT_MS)

        const sql = helpers(db)
        const current = await getVersion(sql)

        if (current > MIGRATIONS.length) throw newerError(current)
        if (current === MIGRATIONS.length) return

        await sql.run('BEGIN IMMEDIATE')

        try {
            // The version is read again now that the write lock is held
            const from = await getVersion(sql)

            if (from > MIGRATIONS.length) throw newerError(from)

            if (from < MIGRATIONS.length) {
                await backup(sql, from)

                for (let version = from; version < MIGRATIONS.length; version++) {
                    await MIGRATIONS[version](sql)
                    await sql.run(`PRAGMA user_version = ${version + 1}`)
                }
            }

            await sql.run('COMMIT')
        } catch (err) {
            await sql.run('ROLLBACK').catch(() => {})
            throw err
        }
    } finally {
        await close(db)
    }
}
