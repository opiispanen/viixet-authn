import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sqlite3 from 'sqlite3'

// The paths are read when the config is imported, so they are set up first.
// Each test file runs in its own process, so this doesn't affect the other tests.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viixet-authn-migrate-'))

process.env.INIT_CWD = tmp
delete process.env.VIIXET_AUTHN_DB
fs.writeFileSync(path.join(tmp, '.env'), 'VIIXET_AUTHN_DB=from-env.db\n')

// The schema as version 1.0.0 of the library created it, before migrations existed
const SCHEMA_1_0_0 = `
    CREATE TABLE user (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        email TEXT NOT NULL,
        extra TEXT NOT NULL,
        created DATETIME DEFAULT CURRENT_TIMESTAMP,
        modified DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted INT DEFAULT 0
    );
    CREATE TABLE session (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created DATETIME DEFAULT CURRENT_TIMESTAMP,
        modified DATETIME DEFAULT CURRENT_TIMESTAMP,
        active INT DEFAULT 0,
        deleted INT DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES user(user_id)
    );
    CREATE TABLE auth_token (
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
    );
`

let config, migrate, MIGRATIONS

before(async () => {
    config = await import('../db/config.js')
    ;({ migrate, MIGRATIONS } = await import('../db/migrate.js'))
})

after(() => fs.rmSync(tmp, { recursive: true, force: true }))

function query(statement, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(config.dbPath)

        db.all(statement, params, (err, rows) => {
            db.close()
            err ? reject(err) : resolve(rows)
        })
    })
}

function exec(statements) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(config.dbPath)

        db.exec(statements, err => {
            db.close()
            err ? reject(err) : resolve()
        })
    })
}

async function version() {
    const [{ user_version }] = await query('PRAGMA user_version')

    return user_version
}

function backups() {
    return fs.readdirSync(tmp).filter(name => name.includes('.bak-'))
}

function reset() {
    for (const name of fs.readdirSync(tmp)) {
        if (name.startsWith('from-env.db')) fs.rmSync(path.join(tmp, name))
    }
}

test('the database path comes from the project .env', () => {
    assert.equal(config.dbName, 'from-env.db')
    assert.equal(config.dbPath, path.join(tmp, 'from-env.db'))
})

test('a 1.0.0 database is upgraded and keeps its data', async () => {
    reset()
    await exec(SCHEMA_1_0_0)
    await query(
        `INSERT INTO user (user_id, username, password, email, extra) VALUES (?, ?, ?, ?, ?)`,
        ['id-1', 'hilma', 'hash', 'hilma@example.com', '{}']
    )
    assert.equal(await version(), 0)

    await migrate()

    assert.equal(await version(), MIGRATIONS.length)

    const users = await query('SELECT username, email FROM user')
    assert.deepEqual(users, [{ username: 'hilma', email: 'hilma@example.com' }])

    // A copy of the old database was made first, and it has the user in it
    assert.deepEqual(backups(), ['from-env.db.bak-v0'])
    assert.ok(fs.statSync(path.join(tmp, 'from-env.db.bak-v0')).size > 0)
})

test('running the migration again changes nothing', async () => {
    const versionBefore = await version()

    await migrate()
    await migrate()

    assert.equal(await version(), versionBefore)
    assert.deepEqual(backups(), ['from-env.db.bak-v0'])
})

test('a new database gets the tables and no backup', async () => {
    reset()

    await migrate()

    const tables = (await query(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    )).map(row => row.name)

    assert.deepEqual(tables, ['auth_token', 'session', 'user'])
    assert.equal(await version(), MIGRATIONS.length)
    assert.deepEqual(backups(), [])
})

test('a database from a newer library is refused', async () => {
    await exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)

    await assert.rejects(migrate(), /newer than this version/)

    assert.equal(await version(), MIGRATIONS.length + 1)
})
