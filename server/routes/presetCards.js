import { Router } from 'express'
import { query, queryOne } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/preset-cards/stats
router.get('/stats', requireAuth, (req, res) => {
  const total    = queryOne('SELECT COUNT(*) as n FROM preset_bingo_cards')?.n ?? 0
  const assigned = queryOne('SELECT COUNT(*) as n FROM preset_bingo_cards WHERE assigned = 1')?.n ?? 0
  res.json({
    total_cards:      total,
    total_tickets:    Math.floor(total / 6),
    assigned_cards:   assigned,
    assigned_tickets: Math.floor(assigned / 6),
    available_tickets: Math.floor((total - assigned) / 6),
  })
})

// GET /api/preset-cards/ticket/:ticketNo — returns all 6 cards for a ticket
router.get('/ticket/:ticketNo', requireAuth, (req, res) => {
  const ticketNo = parseInt(req.params.ticketNo, 10)
  if (!ticketNo || ticketNo < 1 || ticketNo > 2000) {
    return res.status(400).json({ error: 'ticket number must be 1–2000' })
  }
  const cards = query(
    `SELECT id, card_code, position_in_ticket, row1, row2, row3, assigned, assigned_ticket_id
     FROM preset_bingo_cards
     WHERE ticket_number = ?
     ORDER BY position_in_ticket`,
    [ticketNo]
  )
  if (!cards.length) return res.status(404).json({ error: 'Ticket not found' })

  // Parse JSON rows back into arrays
  const result = cards.map(c => ({
    ...c,
    row1: JSON.parse(c.row1),
    row2: JSON.parse(c.row2),
    row3: JSON.parse(c.row3),
  }))

  res.json({ ticket_no: ticketNo, cards: result })
})

// GET /api/preset-cards/card/:cardCode — single card by code e.g. "00001"
router.get('/card/:cardCode', requireAuth, (req, res) => {
  const code = req.params.cardCode.padStart(5, '0')
  const card = queryOne(
    'SELECT * FROM preset_bingo_cards WHERE card_code = ?',
    [code]
  )
  if (!card) return res.status(404).json({ error: 'Card not found' })
  res.json({
    ...card,
    row1: JSON.parse(card.row1),
    row2: JSON.parse(card.row2),
    row3: JSON.parse(card.row3),
  })
})

// GET /api/preset-cards/next-available — lowest unassigned ticket number
router.get('/next-available', requireAuth, (req, res) => {
  const row = queryOne(
    `SELECT ticket_number FROM preset_bingo_cards
     WHERE assigned = 0
     GROUP BY ticket_number
     HAVING COUNT(*) = 6
     ORDER BY ticket_number ASC
     LIMIT 1`
  )
  if (!row) return res.status(404).json({ error: 'No available tickets' })
  res.json({ ticket_no: row.ticket_number })
})

export default router
