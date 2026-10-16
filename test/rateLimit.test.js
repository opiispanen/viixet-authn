import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sqlite3 from 'sqlite3'

// The database is created by the migration on the first query
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viixet-authn-ratelimit-'))

process.env.INIT_CWD = tmp
delete process.env.VIIXET_AUTHN_DB

let lib

before(async () => {
    lib = await import('../src/index.js')
})

after(() => fs.rmSync(tmp, { recursive: true, force: true }))

// Moves a key's window into the past
function ageKey(key, seconds) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(path.join(tmp, 'VIIXET_AUTHN.db'))

        db.run(
            'UPDATE rate_limit SET window_start = window_start - ? WHERE key = ?',
            [seconds, key],
            err => {
                db.close()
                err ? reject(err) : resolve()
            }
        )
    })
}

const limit = { max: 3, windowSeconds: 60 }

test('hits up to max are allowed and report what is left', async () => {
    assert.deepEqual(await lib.hitRateLimit('login:user:hilma', limit), { count: 1, remaining: 2 })
    assert.deepEqual(await lib.hitRateLimit('login:user:hilma', limit), { count: 2, remaining: 1 })
    assert.deepEqual(await lib.hitRateLimit('login:user:hilma', limit), { count: 3, remaining: 0 })
})

test('the hit after max is refused with a retryAfter', async () => {
    for (let i = 0; i < 3; i++) await lib.hitRateLimit('login:user:taavetti', limit)

    await assert.rejects(
        lib.hitRateLimit('login:user:taavetti', limit),
        error => {
            assert.equal(error.message, lib.VIIXET_AUTHN_ERRORS.RATE_LIMITED)
            assert.ok(error.retryAfter >= 1 && error.retryAfter <= 60)

            return true
        }
    )
})

test('keys are counted separately', async () => {
    for (let i = 0; i < 3; i++) await lib.hitRateLimit('login:user:kaisa', limit)

    await assert.rejects(
        lib.hitRateLimit('login:user:kaisa', limit),
        { message: lib.VIIXET_AUTHN_ERRORS.RATE_LIMITED }
    )
    assert.equal((await lib.hitRateLimit('login:user:efraim', limit)).count, 1)
})

test('a new window starts after windowSeconds', async () => {
    for (let i = 0; i < 3; i++) await lib.hitRateLimit('login:user:tyyne', limit)

    await assert.rejects(
        lib.hitRateLimit('login:user:tyyne', limit),
        { message: lib.VIIXET_AUTHN_ERRORS.RATE_LIMITED }
    )

    await ageKey('login:user:tyyne', 61)

    assert.deepEqual(await lib.hitRateLimit('login:user:tyyne', limit), { count: 1, remaining: 2 })
})

test('resetRateLimit forgets the hits', async () => {
    for (let i = 0; i < 3; i++) await lib.hitRateLimit('login:user:impi', limit)

    assert.equal(await lib.resetRateLimit('login:user:impi'), true)
    assert.equal(await lib.resetRateLimit('login:user:impi'), false)
    assert.equal((await lib.hitRateLimit('login:user:impi', limit)).count, 1)
})

test('purgeRateLimits deletes old keys only', async () => {
    await lib.hitRateLimit('purge:old', limit)
    await lib.hitRateLimit('purge:new', limit)
    await ageKey('purge:old', 3 * 86400)

    assert.equal(await lib.purgeRateLimits(), 1)

    // the new key kept its count
    assert.equal((await lib.hitRateLimit('purge:new', limit)).count, 2)
})

test('bad arguments are rejected', async () => {
    await assert.rejects(lib.hitRateLimit('', limit), TypeError)
    await assert.rejects(lib.hitRateLimit('x'.repeat(201), limit), TypeError)
    await assert.rejects(lib.hitRateLimit('key', { max: 0, windowSeconds: 60 }), TypeError)
    await assert.rejects(lib.hitRateLimit('key', { max: 3, windowSeconds: 0 }), TypeError)
    await assert.rejects(lib.hitRateLimit('key'), TypeError)
    await assert.rejects(lib.resetRateLimit(42), TypeError)
})
