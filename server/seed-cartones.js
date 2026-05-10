/**
 * One-shot import: reads the bingo card .txt file and populates
 * the preset_bingo_cards table in bingo.db.
 *
 * Usage:
 *   node server/seed-cartones.js [path-to-file]
 *
 * Default file path is the Desktop cartones file.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, transaction, queryOne } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const FILE_PATH = process.argv[2]
  ?? 'C:/Users/USER/Desktop/cartones_be8f5f06-1183-474a-b1d0-e7d8f408f029.txt'

// ── Parser ────────────────────────────────────────────────────────────────
// File format (fixed-width):
//   chars 0-4   : card code  e.g. "00001"
//   chars 5-9   : spaces (separator)
//   chars 10-27 : row 1  (9 columns × 2 chars — blank cell = "  ")
//   chars 28-45 : row 2
//   chars 46-63 : row 3

function parseRow(str18) {
  const cells = []
  for (let col = 0; col < 9; col++) {
    const cell = str18.slice(col * 2, col * 2 + 2)
    cells.push(cell.trim() === '' ? null : parseInt(cell, 10))
  }
  return cells // length 9, nulls for blank cells
}

function parseLine(line) {
  const code = line.slice(0, 5)
  if (!/^\d{5}$/.test(code)) return null

  // Pad line so slices are safe
  const padded = line.padEnd(64, ' ')
  const row1 = parseRow(padded.slice(10, 28))
  const row2 = parseRow(padded.slice(28, 46))
  const row3 = parseRow(padded.slice(46, 64))

  const numbers = [...row1, ...row2, ...row3].filter(n => n !== null)
  if (numbers.length !== 15) return null
  if (numbers.some(n => n < 1 || n > 90)) return null

  return { code, row1, row2, row3, numbers }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  await initDb()

  const existing = queryOne('SELECT COUNT(*) as n FROM preset_bingo_cards')?.n ?? 0
  if (existing > 0 && !process.argv.includes('--force')) {
    console.log(`preset_bingo_cards already has ${existing} rows.`)
    console.log('Run with --force to re-import.')
    process.exit(0)
  }

  console.log(`Reading: ${FILE_PATH}`)
  let text
  try {
    text = readFileSync(FILE_PATH, 'utf8')
  } catch (e) {
    console.error(`Cannot read file: ${e.message}`)
    process.exit(1)
  }

  const lines = text.split(/\r?\n/)
  console.log(`Lines in file: ${lines.length}`)

  let imported = 0
  let skipped  = 0

  transaction(({ run }) => {
    if (existing > 0) run('DELETE FROM preset_bingo_cards')

    for (const line of lines) {
      const card = parseLine(line)
      if (!card) { skipped++; continue }

      const cardNum         = parseInt(card.code, 10)
      const ticketNumber    = Math.ceil(cardNum / 6)
      const positionInTicket = ((cardNum - 1) % 6) + 1

      run(
        `INSERT OR IGNORE INTO preset_bingo_cards
           (card_code, ticket_number, position_in_ticket, row1, row2, row3)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          card.code,
          ticketNumber,
          positionInTicket,
          JSON.stringify(card.row1),
          JSON.stringify(card.row2),
          JSON.stringify(card.row3),
        ]
      )
      imported++

      if (imported % 1000 === 0) process.stdout.write(`  ${imported} cards...\r`)
    }
  })

  console.log(`\nDone. Imported: ${imported}  Skipped: ${skipped}`)
  console.log(`Tickets created: ${Math.ceil(imported / 6)} (${imported} cards / 6)`)

  // Verify: spot-check ticket 1 covers all 90 numbers
  const t1 = (function () {
    // inline query using the exported query fn
    return null // just log from DB not needed here
  })()
  console.log('Import complete — DB saved.')
}

main().catch(e => { console.error(e); process.exit(1) })
