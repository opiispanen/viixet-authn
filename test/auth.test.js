import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Every query opens its own connection, so ':memory:' would give each query an
// empty database. A temporary folder is used as the project root instead.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viixet-authn-'))

process.env.INIT_CWD = tmp
delete process.env.VIIXET_AUTHN_DB

let lib, createSession, activateSession

before(async () => {
    execFileSync(process.execPath, [path.join(root, 'db/createDB.js')], {
        env: { ...process.env, INIT_CWD: tmp },
        stdio: 'ignore',
    })

    // Imported after INIT_CWD is set, because the db path is read at import time
    lib = await import('../src/index.js')
    ;({ createSession, activateSession } = await import('../src/session.js'))
})

after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('register, login, authenticate and logout', async () => {
    const user_id = await lib.registerUser('anna', 'secret', 'anna@example.com')
    const { session_id } = await lib.loginUser('anna', 'secret')
    const session = await lib.authenticate(session_id)

    assert.equal(session.user_id, user_id)
    assert.equal(session.active, 1)

    assert.deepEqual(await lib.logoutUser(session_id), { success: true })
    await assert.rejects(
        lib.authenticate(session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.SESSION_NOTFOUND }
    )
})

test('wrong password is rejected', async () => {
    await lib.registerUser('ben', 'secret', 'ben@example.com')

    await assert.rejects(
        lib.loginUser('ben', 'wrong'),
        { message: lib.VIIXET_AUTHN_ERRORS.CREDENTIALS_INVALID }
    )
})

test('duplicate username and duplicate email are rejected', async () => {
    await lib.registerUser('cara', 'secret', 'cara@example.com')

    await assert.rejects(
        lib.registerUser('cara', 'secret', 'other@example.com'),
        { message: lib.VIIXET_AUTHN_ERRORS.USER_ALREADYEXISTS }
    )
    await assert.rejects(
        lib.registerUser('cara2', 'secret', 'cara@example.com'),
        { message: lib.VIIXET_AUTHN_ERRORS.USER_ALREADYEXISTS }
    )
})

test('activateSession and logoutUser report whether a row changed', async () => {
    const user_id = await lib.registerUser('dan', 'secret', 'dan@example.com')
    const session_id = await createSession(user_id, 0)

    assert.equal(await activateSession(session_id), true)
    assert.equal(await activateSession('no-such-session'), false)
    assert.deepEqual(await lib.logoutUser('no-such-session'), { success: false })
})

test('two factor code activates a pending session', async () => {
    const user_id = await lib.registerUser('eve', 'secret', 'eve@example.com')
    const session_id = await createSession(user_id, 0)

    assert.equal((await lib.authenticate(session_id)).active, 0)

    const { token_id, numbers } = await lib.createTwoFactorCode(user_id, session_id)

    // token_id is the row id, not the stored hash
    assert.match(token_id, /^[0-9a-f-]{36}$/)

    const wrong = numbers.map(n => (n + 1) % 10)
    await assert.rejects(
        lib.authenticateTwoFactorCode(wrong, token_id, user_id, session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_INVALID }
    )

    assert.equal(
        await lib.authenticateTwoFactorCode(numbers, token_id, user_id, session_id),
        true
    )
    assert.equal((await lib.authenticate(session_id)).active, 1)

    // the code can only be used once
    await assert.rejects(
        lib.authenticateTwoFactorCode(numbers, token_id, user_id, session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
})
