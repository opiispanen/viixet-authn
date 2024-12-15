import path from 'path'
import sqlite3 from 'sqlite3'
import 'dotenv/config'

const projectRoot = process.env.INIT_CWD || process.cwd()
const dbName = process.env.VIIXET_AUTHN_DB || 'VIIXET_AUTHN.db'
const dbPath = path.join(projectRoot, dbName)

const db = new sqlite3.Database(dbPath);

// Create the 'todo' table
db.serialize(() => {
	db.run(`
		CREATE TABLE IF NOT EXISTS user (
			user_id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			password TEXT NOT NULL,
			email TEXT NOT NULL,
			extra TEXT NOT NULL,
			created DATETIME DEFAULT CURRENT_TIMESTAMP,
			modified DATETIME DEFAULT CURRENT_TIMESTAMP,
			deleted INT DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS session (
			session_id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			created DATETIME DEFAULT CURRENT_TIMESTAMP,
			modified DATETIME DEFAULT CURRENT_TIMESTAMP,
			active INT DEFAULT 0,
			deleted INT DEFAULT 0,
			FOREIGN KEY (user_id) REFERENCES user(user_id)
		);

		CREATE TABLE IF NOT EXISTS auth_token (
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
	`);
})

// Close the database connection
db.close((err) => {
	if (err) {
		return console.error(err.message);
	}
	console.log('Database created successfully');
})
