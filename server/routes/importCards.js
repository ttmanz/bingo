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
