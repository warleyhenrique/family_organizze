import Database from 'better-sqlite3';
import path from 'path';
import { dataDir } from './config.js';

export const db = new Database(path.join(dataDir, 'lar-em-ordem.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, color TEXT DEFAULT '#39694a', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, title TEXT NOT NULL, document_number TEXT, category TEXT, due_date TEXT, original_name TEXT, stored_name TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, source_url TEXT, ingredients TEXT, instructions TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, event_date TEXT NOT NULL, event_time TEXT, detail TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS medications (id INTEGER PRIMARY KEY, name TEXT NOT NULL, person TEXT, medication_time TEXT, detail TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS birthdays (id INTEGER PRIMARY KEY, name TEXT NOT NULL, birthday_date TEXT NOT NULL, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, due_date TEXT, done INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS shopping_items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, quantity TEXT, category TEXT, purchased INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS albums (id INTEGER PRIMARY KEY, title TEXT NOT NULL, album_date TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
