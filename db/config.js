import path from 'path'
import dotenv from 'dotenv'

// npm and yarn set INIT_CWD to the folder the command was started in, which is
// the project root even while a postinstall script runs inside node_modules.
const projectRoot = process.env.INIT_CWD || process.cwd()

// Variables that are already set in the real environment win over .env
dotenv.config({ path: path.join(projectRoot, '.env') })

export const dbName = process.env.VIIXET_AUTHN_DB || 'VIIXET_AUTHN.db'

// A relative VIIXET_AUTHN_DB is placed in the project root, an absolute one is used as it is
export const dbPath = path.resolve(projectRoot, dbName)
