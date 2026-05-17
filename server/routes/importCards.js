import { Router } from 'express'
import { readFileSync } from 'fs'
import { requireAuth } from '../middleware/auth.js'
import { queryOne, run, transaction } from '../db.js'

const router = Router()

// Fixed-width format: 5-char code + 5-char prefix + 3 rows of 18 chars (9 cols × 2 chars)
// Blank cell = "  " (2 spaces) → null in the stored array
function parseRow(str18) {
  const cells = []
  for (let col = 0; col < 9; col++) {
    const cell = str18.slice(col * 2, col * 2 + 2)
    cells.push(cell.trim() === '' ? null : parseInt(cell, 10))
  }
  return cells
}

function parseCardLine(line) {
  const code = line.slice(0, 5)
  if (!/^\d{5}$/.test(code)) return null
  const padded = line.padEnd(64, ' ')
  const row1 = parseRow(padded.slice(10, 28))
  const row2 = parseRow(padded.slice(28, 46))
  const row3 = parseRow(padded.slice(46, 64))
  const numbers = [...row1, ...row2, ...row3].filter(n => n !== null)
  if (numbers.length !== 15 || numbers.some(n => n < 1 || n > 90)) return null
  return {
    code,
    row1: JSON.stringify(row1),
    row2: JSON.stringify(row2),
    row3: JSON.stringify(row3),
  }
}

// ── 90-ball card generator ─────────────────────────────────────────────────
const COL_RANGES = [
  [1,9],[10,19],[20,29],[30,39],[40,49],[50,59],[60,69],[70,79],[80,90]
]

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function generateCard() {
  // 3 rows × 9 cols, 5 numbers per row, no column repeated in same row
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid = Array.from({length: 3}, () => Array(9).fill(null))
    const colUsed = Array.from({length: 9}, () => [])
    let ok = true

    for (let r = 0; r < 3; r++) {
      const cols = shuffleArr([0,1,2,3,4,5,6,7,8]).slice(0, 5).sort((a,b) => a-b)
      for (const col of cols) {
        const [lo, hi] = COL_RANGES[col]
        const pool = []
        for (let n = lo; n <= hi; n++) if (!colUsed[col].includes(n)) pool.push(n)
        if (!pool.length) { ok = false; break }
        const n = pool[Math.floor(Math.random() * pool.length)]
        colUsed[col].push(n)
        grid[r][col] = n
      }
      if (!ok) break
    }

    if (!ok) continue

    // Sort numbers within each column ascending top→bottom
    for (let col = 0; col < 9; col++) {
      const rows = [0,1,2].filter(r => grid[r][col] !== null)
      if (rows.length > 1) {
        const nums = rows.map(r => grid[r][col]).sort((a,b) => a-b)
        rows.forEach((r, i) => { grid[r][col] = nums[i] })
      }
    }

    return { row1: grid[0], row2: grid[1], row3: grid[2] }
  }
  return null
}

// POST /api/import-cards/generate — generate N tickets of 6 cards each
router.post('/generate', requireAuth, (req, res) => {
  const tickets = Math.min(Math.max(parseInt(req.body.tickets) || 200, 10), 2000)
  let cardCode = 1
  let inserted = 0

  try {
    transaction(({ run: tRun }) => {
      tRun('DELETE FROM preset_bingo_cards')
      for (let t = 1; t <= tickets; t++) {
        for (let pos = 1; pos <= 6; pos++) {
          const card = generateCard()
          if (!card) continue
          const code = String(cardCode).padStart(5, '0')
          tRun(
            `INSERT INTO preset_bingo_cards (card_code, ticket_number, position_in_ticket, row1, row2, row3)
             VALUES (?,?,?,?,?,?)`,
            [code, t, pos, JSON.stringify(card.row1), JSON.stringify(card.row2), JSON.stringify(card.row3)]
          )
          cardCode++
          inserted++
        }
      }
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  res.json({ ok: true, tickets, cards_inserted: inserted })
})

// GET /api/import-cards/status
router.get('/status', requireAuth, (req, res) => {
  const total    = queryOne('SELECT COUNT(*) as n FROM preset_bingo_cards')?.n ?? 0
  const assigned = queryOne('SELECT COUNT(*) as n FROM preset_bingo_cards WHERE assigned = 1')?.n ?? 0
  res.json({ total, assigned, available: total - assigned })
})

// POST /api/import-cards — reads the text file and bulk-inserts all cards
router.post('/', requireAuth, (req, res) => {
  const { file_path } = req.body
  if (!file_path) return res.status(400).json({ error: 'file_path is required' })

  let text
  try {
    text = readFileSync(file_path, 'utf8')
  } catch (e) {
    return res.status(400).json({ error: `Cannot read file: ${e.message}` })
  }

  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 6) return res.status(400).json({ error: 'File too short — expected 12000 card lines' })

  let imported = 0
  let skipped  = 0

  try {
    transaction(({ run: tRun }) => {
      // Clear existing preset cards before re-import
      tRun('DELETE FROM preset_bingo_cards')

      for (const line of lines) {
        const card = parseCardLine(line)
        if (!card) { skipped++; continue }
        const cardNum     = parseInt(card.code, 10)
        const ticketNumber = Math.ceil(cardNum / 6)
        const position    = ((cardNum - 1) % 6) + 1
        tRun(
          `INSERT OR IGNORE INTO preset_bingo_cards
             (card_code, ticket_number, position_in_ticket, row1, row2, row3)
           VALUES (?,?,?,?,?,?)`,
          [card.code, ticketNumber, position, card.row1, card.row2, card.row3]
        )
        imported++
      }
    })
  } catch (e) {
    return res.status(500).json({ error: `Import failed: ${e.message}` })
  }

  res.json({ ok: true, imported, skipped, total_lines: lines.length })
})

export default router
