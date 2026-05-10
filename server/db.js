import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import bcrypt from 'bcryptjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH   = join(__dirname, 'bingo.db')
const WASM_PATH = join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm')

let db

export async function initDb() {
  const SQL = await initSqlJs({ locateFile: () => WASM_PATH })
  db = existsSync(DB_PATH)
    ? new SQL.Database(readFileSync(DB_PATH))
    : new SQL.Database()
  createSchema()
  runMigrations()
  await seedDefaults()
  return db
}

export function save() {
  writeFileSync(DB_PATH, Buffer.from(db.export()))
}

// ── Query helpers ─────────────────────────────────────────────────────────
export function query(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

export function queryOne(sql, params = []) {
  return query(sql, params)[0] ?? null
}

export function run(sql, params = []) {
  db.run(sql, params)
  save()
}

export function insert(sql, params = []) {
  db.run(sql, params)
  const res = db.exec('SELECT last_insert_rowid() as id')
  save()
  return res[0].values[0][0]
}

// Run many operations in one transaction, save once at the end.
// callback receives { run, query } that do NOT auto-save.
export function transaction(callback) {
  db.run('BEGIN TRANSACTION')
  try {
    const rawRun = (sql, params = []) => db.run(sql, params)
    const rawQuery = (sql, params = []) => {
      const stmt = db.prepare(sql)
      stmt.bind(params)
      const rows = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()
      return rows
    }
    callback({ run: rawRun, query: rawQuery })
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  save()
}

// ── Schema ────────────────────────────────────────────────────────────────
function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE,
      phone         TEXT,
      role          TEXT DEFAULT 'player',
      balance       REAL DEFAULT 0,
      points        REAL DEFAULT 0,
      password_hash TEXT,
      agent_id      INTEGER REFERENCES users(id),
      status        TEXT DEFAULT 'active',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER UNIQUE NOT NULL REFERENCES users(id),
      agent_type       TEXT DEFAULT 'agent',
      commission_rate  REAL DEFAULT 5.0,
      parent_agent_id  INTEGER REFERENCES agents(id),
      total_sales      REAL DEFAULT 0,
      total_commission REAL DEFAULT 0,
      status           TEXT DEFAULT 'active',
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS draw_schedule (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week      INTEGER NOT NULL,
      draw_time        TEXT NOT NULL,
      draw_number      INTEGER DEFAULT 1,
      title            TEXT NOT NULL,
      ball_interval    INTEGER DEFAULT 5,
      ticket_price     REAL DEFAULT 1.0,
      full_house_prize REAL DEFAULT 100.0,
      line_prize       REAL DEFAULT 10.0,
      enabled          INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS draws (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id      INTEGER REFERENCES draw_schedule(id),
      title            TEXT NOT NULL,
      draw_date        TEXT NOT NULL,
      draw_time        TEXT NOT NULL,
      ball_interval    INTEGER DEFAULT 5,
      ticket_price     REAL NOT NULL,
      full_house_prize REAL NOT NULL,
      line_prize       REAL NOT NULL,
      jackpot_enabled  INTEGER DEFAULT 0,
      jackpot_amount   REAL DEFAULT 0,
      jackpot_ball_count INTEGER DEFAULT 45,
      status           TEXT DEFAULT 'scheduled',
      numbers_drawn    TEXT DEFAULT '[]',
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      draw_id        INTEGER NOT NULL REFERENCES draws(id),
      numbers        TEXT NOT NULL,
      purchase_price REAL NOT NULL,
      agent_id       INTEGER REFERENCES agents(id),
      status         TEXT DEFAULT 'active',
      prize_amount   REAL DEFAULT 0,
      paid_out       INTEGER DEFAULT 0,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jackpot (
      id          INTEGER PRIMARY KEY,
      enabled     INTEGER DEFAULT 0,
      amount      REAL DEFAULT 1000,
      ball_count  INTEGER DEFAULT 45,
      last_won_at TEXT,
      last_won_by TEXT
    );

    CREATE TABLE IF NOT EXISTS system_tickets (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      draw_id            INTEGER REFERENCES draws(id),
      draw_label         TEXT NOT NULL,
      ticket_count       INTEGER NOT NULL DEFAULT 0,
      win_amount         REAL DEFAULT 0,
      winning_ticket_ids TEXT,
      notes              TEXT,
      created_at         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      type         TEXT NOT NULL,
      amount       REAL NOT NULL,
      balance_after REAL NOT NULL,
      description  TEXT,
      draw_id      INTEGER REFERENCES draws(id),
      reference    TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS preset_bingo_cards (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      card_code           TEXT NOT NULL UNIQUE,
      ticket_number       INTEGER NOT NULL,
      position_in_ticket  INTEGER NOT NULL,
      row1                TEXT NOT NULL,
      row2                TEXT NOT NULL,
      row3                TEXT NOT NULL,
      assigned            INTEGER DEFAULT 0,
      assigned_ticket_id  INTEGER REFERENCES tickets(id)
    );
  `)
}

function runMigrations() {
  // agents: add agent_type
  const agentCols = db.exec("PRAGMA table_info(agents)")[0]?.values?.map(r => r[1]) ?? []
  if (!agentCols.includes('agent_type')) {
    db.run("ALTER TABLE agents ADD COLUMN agent_type TEXT DEFAULT 'agent'")
  }

  // users: add password_hash and points
  const userCols = db.exec("PRAGMA table_info(users)")[0]?.values?.map(r => r[1]) ?? []
  if (!userCols.includes('password_hash')) {
    db.run("ALTER TABLE users ADD COLUMN password_hash TEXT")
  }
  if (!userCols.includes('points')) {
    db.run("ALTER TABLE users ADD COLUMN points REAL DEFAULT 0")
  }

  // system_tickets: add winning_ticket_ids column
  const stCols = db.exec("PRAGMA table_info(system_tickets)")[0]?.values?.map(r => r[1]) ?? []
  if (stCols.length && !stCols.includes('winning_ticket_ids')) {
    db.run('ALTER TABLE system_tickets ADD COLUMN winning_ticket_ids TEXT')
  }

  // draws: add type and description for special draws
  const drawCols = db.exec("PRAGMA table_info(draws)")[0]?.values?.map(r => r[1]) ?? []
  if (!drawCols.includes('type')) {
    db.run("ALTER TABLE draws ADD COLUMN type TEXT DEFAULT 'regular'")
  }
  if (!drawCols.includes('description')) {
    db.run("ALTER TABLE draws ADD COLUMN description TEXT")
  }

  save()
}

async function seedDefaults() {
  const adminRow = queryOne("SELECT id FROM admins WHERE username = 'admin'")
  if (!adminRow) {
    const hash = await bcrypt.hash('admin123', 10)
    insert('INSERT INTO admins (username, password_hash) VALUES (?, ?)', ['admin', hash])
  }
  const jackpotRow = queryOne('SELECT id FROM jackpot WHERE id = 1')
  if (!jackpotRow) {
    insert('INSERT INTO jackpot (id, enabled, amount, ball_count) VALUES (1, 0, 1000, 45)', [])
  }
}
