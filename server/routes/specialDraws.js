import { Router } from 'express'
import { query, queryOne, run, insert, transaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireUserAuth } from '../middleware/userAuth.js'

const router = Router()

// ── GET /api/special-draws — public list of relevant special draws
// Shows: all scheduled (upcoming), any running, and completed draws from today only.
router.get('/', (req, res) => {
  const draws = query(
    `SELECT * FROM draws
     WHERE type = 'special'
       AND (
         status IN ('scheduled', 'running')
         OR (status = 'completed' AND draw_date = date('now'))
       )
     ORDER BY
       CASE status WHEN 'running' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
       draw_date ASC, draw_time ASC
     LIMIT 50`
  )
  res.json(draws)
})

// ── GET /api/special-draws/:id — single draw detail (public)
router.get('/:id', (req, res) => {
  const draw = queryOne("SELECT * FROM draws WHERE id = ? AND type = 'special'", [req.params.id])
  if (!draw) return res.status(404).json({ error: 'Draw not found' })
  res.json(draw)
})

// ── POST /api/special-draws — admin creates a special draw
router.post('/', requireAuth, (req, res) => {
  const {
    title, description, draw_date, draw_time, timezone = 'UTC',
    ticket_price = 1, full_house_prize = 500, line_prize = 50,
    ball_interval = 5, jackpot_enabled = 0, jackpot_amount = 0,
    announcer = null
  } = req.body

  if (!title || !draw_date || !draw_time) {
    return res.status(400).json({ error: 'Title, date and time are required' })
  }

  const id = insert(
    `INSERT INTO draws
       (title, description, draw_date, draw_time, timezone, ticket_price,
        full_house_prize, line_prize, ball_interval,
        jackpot_enabled, jackpot_amount, announcer, status, type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'scheduled','special')`,
    [title, description ?? null, draw_date, draw_time, timezone,
     ticket_price, full_house_prize, line_prize, ball_interval,
     jackpot_enabled ? 1 : 0, jackpot_amount, announcer ?? null]
  )
  res.json({ ok: true, id })
})

// ── PUT /api/special-draws/:id — admin updates a special draw
router.put('/:id', requireAuth, (req, res) => {
  const draw = queryOne("SELECT * FROM draws WHERE id = ? AND type = 'special'", [req.params.id])
  if (!draw) return res.status(404).json({ error: 'Draw not found' })

  const {
    title, description, draw_date, draw_time, timezone, ticket_price,
    full_house_prize, line_prize, ball_interval,
    jackpot_enabled, jackpot_amount, status, announcer
  } = req.body

  run(
    `UPDATE draws SET
       title=?, description=?, draw_date=?, draw_time=?, timezone=?,
       ticket_price=?, full_house_prize=?, line_prize=?,
       ball_interval=?, jackpot_enabled=?, jackpot_amount=?, status=?, announcer=?
     WHERE id=?`,
    [
      title ?? draw.title,
      description ?? draw.description,
      draw_date ?? draw.draw_date,
      draw_time ?? draw.draw_time,
      timezone ?? draw.timezone ?? 'UTC',
      ticket_price ?? draw.ticket_price,
      full_house_prize ?? draw.full_house_prize,
      line_prize ?? draw.line_prize,
      ball_interval ?? draw.ball_interval,
      jackpot_enabled !== undefined ? (jackpot_enabled ? 1 : 0) : draw.jackpot_enabled,
      jackpot_amount ?? draw.jackpot_amount,
      status ?? draw.status,
      announcer !== undefined ? (announcer || null) : draw.announcer,
      req.params.id,
    ]
  )
  res.json({ ok: true })
})

// ── DELETE /api/special-draws/:id — admin removes a special draw
router.delete('/:id', requireAuth, (req, res) => {
  run("DELETE FROM draws WHERE id = ? AND type = 'special'", [req.params.id])
  res.json({ ok: true })
})

// ── POST /api/special-draws/:id/buy — player buys ticket(s) using points
router.post('/:id/buy', requireUserAuth, (req, res) => {
  const draw = queryOne(
    "SELECT * FROM draws WHERE id = ? AND type = 'special' AND status = 'scheduled'",
    [req.params.id]
  )
  if (!draw) return res.status(404).json({ error: 'Draw not available for ticket purchase' })

  const { quantity = 1 } = req.body
  const qty = Math.max(1, parseInt(quantity) || 1)
  const totalCost = draw.ticket_price * qty

  const user = queryOne('SELECT id, points FROM users WHERE id = ?', [req.user.user_id])
  if (!user) return res.status(404).json({ error: 'User not found' })
  if ((user.points ?? 0) < totalCost) {
    return res.status(400).json({
      error: `Insufficient points. Need ${totalCost}, have ${user.points ?? 0}`
    })
  }

  // Per-draw pool: each draw has its own independent set of 2000 tickets
  const presetTotal = queryOne('SELECT COUNT(DISTINCT ticket_number) as n FROM preset_bingo_cards')?.n ?? 0
  if (presetTotal > 0) {
    const soldForDraw = queryOne(
      'SELECT COUNT(*) as n FROM tickets WHERE draw_id = ? AND ticket_number IS NOT NULL',
      [draw.id]
    )?.n ?? 0
    if (presetTotal - soldForDraw < qty) {
      return res.status(400).json({ error: `Only ${presetTotal - soldForDraw} tickets remaining for this draw` })
    }
  }

  const tickets = []

  try {
    transaction(({ run: tRun, query: tQuery }) => {
      for (let i = 0; i < qty; i++) {
        let cards
        let ticketNumbers

        if (presetTotal > 0) {
          // Pick lowest ticket_number not yet sold for THIS draw
          const avail = tQuery(
            `SELECT pc.ticket_number
             FROM preset_bingo_cards pc
             WHERE pc.ticket_number NOT IN (
               SELECT t.ticket_number FROM tickets t
               WHERE t.draw_id = ? AND t.ticket_number IS NOT NULL
             )
             GROUP BY pc.ticket_number HAVING COUNT(*) = 6
             ORDER BY pc.ticket_number ASC LIMIT 1`,
            [draw.id]
          )
          if (!avail.length) throw new Error('No tickets available for this draw')
          const tNum = avail[0].ticket_number
          cards = tQuery(
            `SELECT * FROM preset_bingo_cards WHERE ticket_number = ? ORDER BY position_in_ticket ASC`,
            [tNum]
          )

          const cardData = cards.map(c => ({
            code:     c.card_code,
            position: c.position_in_ticket,
            row1:     JSON.parse(c.row1),
            row2:     JSON.parse(c.row2),
            row3:     JSON.parse(c.row3),
          }))

          tRun(
            `INSERT INTO tickets (user_id, draw_id, ticket_number, numbers, purchase_price, status)
             VALUES (?,?,?,?,?,'active')`,
            [user.id, draw.id, tNum, JSON.stringify(cardData), draw.ticket_price]
          )
          const tidRes = tQuery('SELECT last_insert_rowid() as id')
          const tid = tidRes[0].id

          tickets.push({ id: tid, ticket_number: tNum, cards: cardData })
        } else {
          // Fallback: generate random 15 numbers (no preset pool loaded)
          const pool = Array.from({ length: 90 }, (_, k) => k + 1)
          for (let j = pool.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [pool[j], pool[k]] = [pool[k], pool[j]]
          }
          const numbers = pool.slice(0, 15).sort((a, b) => a - b)
          tRun(
            `INSERT INTO tickets (user_id, draw_id, numbers, purchase_price, status)
             VALUES (?,?,?,'${draw.ticket_price}','active')`,
            [user.id, draw.id, JSON.stringify(numbers)]
          )
          const tidRes = tQuery('SELECT last_insert_rowid() as id')
          tickets.push({ id: tidRes[0].id, numbers })
        }
      }

      // Deduct points
      tRun('UPDATE users SET points = points - ? WHERE id = ?', [totalCost, user.id])
      tRun(
        'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
        [user.id, 'ticket_purchase', -totalCost,
         (user.points - totalCost),
         `${qty} ticket${qty > 1 ? 's' : ''} for "${draw.title}"`]
      )
    })
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  res.json({ ok: true, tickets, cost: totalCost, remaining_points: user.points - totalCost })
})

// ── GET /api/special-draws/:id/my-tickets — player's tickets for a draw
router.get('/:id/my-tickets', requireUserAuth, (req, res) => {
  const tickets = query(
    'SELECT * FROM tickets WHERE draw_id = ? AND user_id = ? ORDER BY created_at DESC',
    [req.params.id, req.user.user_id]
  )
  res.json(tickets)
})

export default router
