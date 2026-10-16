import sqlite3 from 'sqlite3'
import { dbPath } from './config.js'
import { migrate } from './migrate.js'

// The database is checked once per process, before the first query, so an app
// that upgraded the library without reinstalling still gets the new schema.
let migrated = null

function ensureMigrated() {
    if (!migrated) {
        migrated = migrate().catch(err => {
            migrated = null // try again on the next query
            throw err
        })
    }

    return migrated
}

export async function transaction(query, data = []) {
    await ensureMigrated()

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath)

        // SQLite lets one writer in at a time. Wait up to 5 seconds for the lock
        // instead of failing at once with SQLITE_BUSY.
        db.configure('busyTimeout', 5000)

        db.serialize(() => {
            const isSelectQuery = query.trim().toUpperCase().startsWith('SELECT')
            const method = isSelectQuery ? 'all' : 'run'
            
            db[method](
                query,
                data,
                function(err, rows) {
                    if (err) {
                        reject(err)
                    } else {
                        resolve({ 
                            rows, 
                            id: this.lastID,
                            changes: this.changes,
                        })
                    }
                }
            );
        })

        db.close()
    })
}