import sqlite3 from 'sqlite3'
import 'dotenv/config'

export function transaction(query, data = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(process.env.VIIXET_AUTHN_DB)

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