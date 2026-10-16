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

test('a version 1 database gets the attempts column and keeps its tokens', async () => {
    reset()
    await exec(SCHEMA_1_0_0)
    await exec('PRAGMA user_version = 1')
    await query(
        `INSERT INTO auth_token (token_id, user_id, session_id, token, type) VALUES (?, ?, ?, ?, ?)`,
        ['token-1', 'id-1', 'session-1', 'hash', 1]
    )

    await migrate()

    assert.equal(await version(), MIGRATIONS.length)

    const tokens = await query('SELECT token_id, token, attempts FROM auth_token')
    assert.deepEqual(tokens, [{ token_id: 'token-1', token: 'hash', attempts: 0 }])
    assert.deepEqual(backups(), ['from-env.db.bak-v1'])
})

test('a new database gets the tables and no backup', async () => {
    reset()

    await migrate()

    const tables = (await query(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    )).map(row => row.name)

    assert.deepEqual(tables, ['auth_token', 'rate_limit', 'session', 'user'])
    assert.equal(await version(), MIGRATIONS.length)
    assert.deepEqual(backups(), [])
})

test('a new database gets unique indexes on username and email', async () => {
    reset()

    await migrate()

    const indexes = (await query(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_user_%' ORDER BY name`
    )).map(row => row.name)

    assert.deepEqual(indexes, ['idx_user_email', 'idx_user_username'])

    await query(
        `INSERT INTO user (user_id, username, password, email, extra) VALUES (?, ?, ?, ?, ?)`,
        ['id-1', 'hilma', 'hash', 'hilma@example.com', '{}']
    )

    await assert.rejects(
        query(
            `INSERT INTO user (user_id, username, password, email, extra) VALUES (?, ?, ?, ?, ?)`,
            ['id-2', 'hilma', 'hash', 'toinen@example.com', '{}']
        ),
        { code: 'SQLITE_CONSTRAINT' }
    )
    await assert.rejects(
        query(
            `INSERT INTO user (user_id, username, password, email, extra) VALUES (?, ?, ?, ?, ?)`,
            ['id-3', 'taavetti', 'hash', 'hilma@example.com', '{}']
        ),
        { code: 'SQLITE_CONSTRAINT' }
    )
})

test('duplicates skip the index with one warning, and it is added once they are gone', async t => {
    reset()
    await exec(SCHEMA_1_0_0)

    const insert = (id, username, email) => query(
        `INSERT INTO user (user_id, username, password, email, extra) VALUES (?, ?, ?, ?, ?)`,
        [id, username, 'hash', email, '{}']
    )

    // Two accounts share an email, which the old registration check allowed
    await insert('id-1', 'kaisa', 'yhteinen@example.com')
    await insert('id-2', 'kaarlo', 'yhteinen@example.com')

    const warn = t.mock.method(console, 'warn', () => {})
    const indexNames = async () => (await query(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_user_%' ORDER BY name`
    )).map(row => row.name)

    await migrate()
    await migrate()

    // The username index is made, the email index waits, and the data is untouched
    assert.deepEqual(await indexNames(), ['idx_user_username'])
    assert.equal((await query('SELECT * FROM user')).length, 2)

    // Warned once, with the value and where to look
    assert.equal(warn.mock.callCount(), 1)

    const message = warn.mock.calls[0].arguments[0]

    assert.match(message, /user\.email/)
    assert.match(message, /"yhteinen@example\.com" \(2 rows\)/)
    assert.match(message, /SELECT user_id/)

    await query('DELETE FROM user WHERE user_id = ?', ['id-2'])
    await migrate()

    assert.deepEqual(await indexNames(), ['idx_user_email', 'idx_user_username'])
    assert.equal(warn.mock.callCount(), 1)
})

test('a database from a newer library is refused', async () => {
    await exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)

    await assert.rejects(migrate(), /newer than this version/)

    assert.equal(await version(), MIGRATIONS.length + 1)
})
