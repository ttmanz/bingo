import { Router } from 'express'
import { query, queryOne, run, insert, transaction } from '../db.js'
import { requireUserAuth } from '../middleware/userAuth.js'

const router = Router()

// GET /api/user-portal/me
router.get('/me', requireUserAuth, (req, res) => {
  const user = queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.points, u.status, u.created_at,
       a.name as agent_name, a.email as agent_email
     FROM users u
     LEFT JOIN users a ON a.id = u.agent_id
     WHERE u.id = ?`,
    [req.user.user_id]
  )
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(user)
})

// GET /api/user-portal/available-draws
// Returns today's regular scheduled draws + all upcoming/live special draws.
// "Today" uses the draw_schedule day_of_week (0=Mon … 6=Sun).
// SQLite strftime('%w','now') = 0=Sun,1=Mon…6=Sat  →  ((%w+6)%7) = Mon-first.
router.get('/available-draws', requireUserAuth, (req, res) => {
  // Today's regular draws (from draw_schedule → draws table)
  const regular = query(
    `SELECT d.*, 'regular' as draw_type
     FROM draws d
     WHERE d.type = 'regular'
       AND d.draw_date = date('now')
       AND d.status IN ('scheduled','running')
     ORDER BY d.draw_time ASC`
  )

  // All upcoming + live special draws, plus today's completed specials
  const special = query(
    `SELECT d.*, 'special' as draw_type
     FROM draws d
     WHERE d.type = 'special'
       AND (
         d.status IN ('scheduled','running')
         OR (d.status = 'completed' AND d.draw_date = date('now'))
       )
     ORDER BY
       CASE d.status WHEN 'running' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
       d.draw_date ASC, d.draw_time ASC
     LIMIT 50`
  )

  // Add per-draw available ticket count (each draw has its own independent pool)
  const presetTotal = queryOne('SELECT COUNT(DISTINCT ticket_number) as n FROM preset_bingo_cards')?.n ?? 0
  const soldRows = query('SELECT draw_id, COUNT(*) as sold FROM tickets WHERE ticket_number IS NOT NULL GROUP BY draw_id')
  const soldMap = Object.fromEntries(soldRows.map(r => [r.draw_id, r.sold]))
  const TZ = 'Asia/Nicosia'
  function localToUtc(draw_date, draw_time) {
    const t = draw_time.length === 5 ? draw_time + ':00' : draw_time
    // Parse the stored local time as UTC, then find the real offset for Asia/Nicosia at that date
    const probe = new Date(`${draw_date}T${t}Z`)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(probe).reduce((a, p) => { a[p.type] = p.value; return a }, {})
    const tzDate = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
    const offsetMs = probe - tzDate
    return new Date(probe.getTime() + offsetMs).toISOString()
  }

  const addAvail = draws => draws.map(d => {
    const utcIso = (d.draw_date && d.draw_time) ? localToUtc(d.draw_date, d.draw_time) : null
    const utcDate = utcIso ? new Date(utcIso) : null
    return {
      ...d,
      // Override draw_date/draw_time with UTC values so any version of the portal JS works
      draw_date: utcDate ? utcDate.toISOString().slice(0, 10) : d.draw_date,
      draw_time: utcDate ? utcDate.toISOString().slice(11, 19) : d.draw_time,
      scheduled_utc: utcIso,
      available_tickets: presetTotal > 0 ? presetTotal - (soldMap[d.id] ?? 0) : null,
      total_tickets: presetTotal || null,
    }
  })

  res.json({ regular: addAvail(regular), special: addAvail(special) })
})

// GET /api/user-portal/tickets
router.get('/tickets', requireUserAuth, (req, res) => {
  const tickets = query(
    `SELECT t.*, d.title as draw_title, d.draw_date, d.draw_time, d.timezone, d.status as draw_status
     FROM tickets t
     JOIN draws d ON d.id = t.draw_id
     WHERE t.user_id = ?
     ORDER BY t.created_at DESC LIMIT 50`,
    [req.user.user_id]
  )
  res.json(tickets)
})

// GET /api/user-portal/transactions
router.get('/transactions', requireUserAuth, (req, res) => {
  const txns = query(
    `SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    [req.user.user_id]
  )
  res.json(txns)
})

// POST /api/user-portal/sell-points — sell points back to the user's agent
router.post('/sell-points', requireUserAuth, (req, res) => {
  const { user_id } = req.user
  const { points } = req.body

  if (!points || points <= 0) return res.status(400).json({ error: 'Points must be greater than 0' })

  const user = queryOne('SELECT id, points, agent_id FROM users WHERE id = ?', [user_id])
  if ((user?.points ?? 0) < points) {
    return res.status(400).json({ error: `Insufficient points. You have ${user?.points ?? 0}` })
  }
  if (!user.agent_id) {
    return res.status(400).json({ error: 'Your account is not linked to an agent' })
  }

  const agentUser = queryOne('SELECT id, name, points FROM users WHERE id = ?', [user.agent_id])
  if (!agentUser) return res.status(400).json({ error: 'Agent not found' })

  run('UPDATE users SET points = points - ? WHERE id = ?', [points, user_id])
  run('UPDATE users SET points = points + ? WHERE id = ?', [points, user.agent_id])

  const newBalance = (user.points - points)
  insert('INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [user_id, 'points_sold', -points, newBalance, `Points sold back to ${agentUser.name}`])
  insert('INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [user.agent_id, 'points_bought', points, ((agentUser.points ?? 0) + points),
     `Points bought back from player`])

  res.json({ ok: true, remaining_points: newBalance, agent_name: agentUser.name })
})

// POST /api/user-portal/buy/:drawId — buy ticket(s) for any draw (regular or special)
// Each draw has its own independent pool of 2000 tickets; sold tickets are never reused within a draw.
router.post('/buy/:drawId', requireUserAuth, (req, res) => {
  const drawId = parseInt(req.params.drawId)
  const qty    = Math.max(1, Math.min(10, parseInt(req.body.quantity) || 1))

  const draw = queryOne("SELECT * FROM draws WHERE id = ? AND status = 'scheduled'", [drawId])
  if (!draw) return res.status(404).json({ error: 'Draw not available for purchase' })

  const totalCost = (draw.ticket_price ?? 1) * qty
  const user = queryOne('SELECT id, points FROM users WHERE id = ?', [req.user.user_id])
  if (!user) return res.status(404).json({ error: 'User not found' })
  if ((user.points ?? 0) < totalCost) {
    return res.status(400).json({ error: `Insufficient points. Need ${totalCost}, have ${user.points ?? 0}` })
  }

  const presetTotal = queryOne('SELECT COUNT(DISTINCT ticket_number) as n FROM preset_bingo_cards')?.n ?? 0

  if (presetTotal > 0) {
    const soldForDraw = queryOne(
      'SELECT COUNT(*) as n FROM tickets WHERE draw_id = ? AND ticket_number IS NOT NULL',
      [drawId]
    )?.n ?? 0
    if (presetTotal - soldForDraw < qty) {
      return res.status(400).json({ error: `Only ${presetTotal - soldForDraw} tickets remaining for this draw` })
    }
  }

  const tickets = []

  try {
    transaction(({ run: tRun, query: tQuery }) => {
      for (let i = 0; i < qty; i++) {
        if (presetTotal > 0) {
          // Pick lowest ticket_number not yet used for THIS draw
          const avail = tQuery(
            `SELECT pc.ticket_number
             FROM preset_bingo_cards pc
             WHERE pc.ticket_number NOT IN (
               SELECT t.ticket_number FROM tickets t
               WHERE t.draw_id = ? AND t.ticket_number IS NOT NULL
             )
             GROUP BY pc.ticket_number HAVING COUNT(*) = 6
             ORDER BY pc.ticket_number ASC LIMIT 1`,
            [drawId]
          )
          if (!avail.length) throw new Error('No tickets available for this draw')

          const tNum  = avail[0].ticket_number
          const cards = tQuery(
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
            [user.id, drawId, tNum, JSON.stringify(cardData), draw.ticket_price]
          )
          const tid = tQuery('SELECT last_insert_rowid() as id')[0].id
          tickets.push({ id: tid, ticket_number: tNum, cards: cardData })
        } else {
          // Fallback: random 15-number ticket when no preset pool exists
          const pool = Array.from({ length: 90 }, (_, k) => k + 1)
          for (let j = pool.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [pool[j], pool[k]] = [pool[k], pool[j]]
          }
          const numbers = pool.slice(0, 15).sort((a, b) => a - b)
          tRun(
            `INSERT INTO tickets (user_id, draw_id, numbers, purchase_price, status) VALUES (?,?,?,?,'active')`,
            [user.id, drawId, JSON.stringify(numbers), draw.ticket_price]
          )
          const tid = tQuery('SELECT last_insert_rowid() as id')[0].id
          tickets.push({ id: tid, numbers })
        }
      }

      tRun('UPDATE users SET points = points - ? WHERE id = ?', [totalCost, user.id])
      tRun(
        'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
        [user.id, 'ticket_purchase', -totalCost, (user.points - totalCost),
         `${qty} ticket${qty > 1 ? 's' : ''} for "${draw.title}"`]
      )
    })
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  res.json({ ok: true, tickets, cost: totalCost, remaining_points: user.points - totalCost })
})

export default router
