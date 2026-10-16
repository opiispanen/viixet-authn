import { dbPath } from './config.js'
import { migrate } from './migrate.js'

// Creates the database, or brings an existing one up to date. A failure is only
// reported, so it doesn't break `npm install`. The next query will try again.
try {
    await migrate()
    console.log(`Database ready: ${dbPath}`)
} catch (err) {
    console.warn(`viixet-authn: could not prepare the database (${err.message})`)
}
