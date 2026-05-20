import { Router } from 'express'
import { query, queryOne, run, insert } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { triggerReschedule } from '../gameBridge.js'

const router = Router()
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

// GET /api/schedule — all entries grouped by day
router.get('/', requireAuth, (req, res) => {
  const rows = query('SELECT * FROM draw_schedule ORDER BY day_of_week, draw_time')
  const grouped = DAYS.map((name, i) => ({
    day: i,
    name,
    draws: rows.filter(r => r.day_of_week === i),
  }))
  res.json(grouped)
})

// POST /api/schedule — create entry
router.post('/', requireAuth, (req, res) => {
  const { day_of_week, draw_time, draw_number, title, ball_interval, ticket_price, full_house_prize, line_prize, timezone } = req.body
  const id = insert(
    'INSERT INTO draw_schedule (day_of_week, draw_time, draw_number, title, ball_interval, ticket_price, full_house_prize, line_prize, timezone) VALUES (?,?,?,?,?,?,?,?,?)',
    [day_of_week, draw_time, draw_number ?? 1, title, ball_interval ?? 5, ticket_price, full_house_prize, line_prize, timezone ?? 'UTC']
  )
  res.json({ id, ...req.body })
})

// PUT /api/schedule/:id — update entry
router.put('/:id', requireAuth, (req, res) => {
  const { draw_time, draw_number, title, ball_interval, ticket_price, full_house_prize, line_prize, enabled, timezone } = req.body
  run(
    'UPDATE draw_schedule SET draw_time=?, draw_number=?, title=?, ball_interval=?, ticket_price=?, full_house_prize=?, line_prize=?, enabled=?, timezone=? WHERE id=?',
    [draw_time, draw_number, title, ball_interval, ticket_price, full_house_prize, line_prize, enabled ?? 1, timezone ?? 'UTC', req.params.id]
  )
  // Propagate time/prize changes to any not-yet-started draw instances for this template
  run(
    `UPDATE draws SET draw_time=?, ball_interval=?, title=?, ticket_price=?, full_house_prize=?, line_prize=?
     WHERE schedule_id=? AND status='scheduled'`,
    [draw_time, ball_interval, title, ticket_price, full_house_prize, line_prize, req.params.id]
  )
  // Reset the server's countdown so it picks up the new time immediately
  triggerReschedule()
  res.json({ ok: true })
})

// DELETE /api/schedule/:id
router.delete('/:id', requireAuth, (req, res) => {
  run('DELETE FROM draw_schedule WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// GET /api/schedule/draws — active draw instances (completed excluded unless ?status=completed)
router.get('/draws', requireAuth, (req, res) => {
  const { status, limit = 50 } = req.query
  const where = status ? 'WHERE d.status = ?' : "WHERE d.status NOT IN ('completed','voided')"
  const params = status ? [status, Number(limit)] : [Number(limit)]
  const rows = query(
    `SELECT d.*, COUNT(t.id) as ticket_count FROM draws d
     LEFT JOIN tickets t ON t.draw_id = d.id
     ${where} GROUP BY d.id ORDER BY d.draw_date ASC, d.draw_time ASC LIMIT ?`,
    params
  )
  res.json(rows)
})

// POST /api/schedule/generate-today — create draw instances for N days from the schedule
router.post('/generate-today', requireAuth, (req, res) => {
  const days = Math.min(Math.max(parseInt(req.body.days) || 1, 1), 30)
  const jackpot = queryOne('SELECT * FROM jackpot WHERE id = 1')
  let created = 0
  const skipped = []

  for (let offset = 0; offset < days; offset++) {
    const row = queryOne(`SELECT date('now', '+${offset} days') as d, ((CAST(strftime('%w', date('now', '+${offset} days')) AS INTEGER) + 6) % 7) as dow`)
    const dateStr = row.d
    const dow = row.dow

    const schedules = query('SELECT * FROM draw_schedule WHERE day_of_week = ? AND enabled = 1', [dow])
    for (const s of schedules) {
      const existing = queryOne(
        "SELECT id FROM draws WHERE schedule_id = ? AND draw_date = ? AND type = 'regular'",
        [s.id, dateStr]
      )
      if (existing) { skipped.push(`${s.title} (${dateStr})`); continue }

      insert(
        `INSERT INTO draws
           (schedule_id, title, draw_date, draw_time, ball_interval, ticket_price,
            full_house_prize, line_prize, jackpot_enabled, jackpot_amount,
            jackpot_ball_count, timezone, type, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'regular','scheduled')`,
        [s.id, s.title, dateStr, s.draw_time, s.ball_interval ?? 5,
         s.ticket_price, s.full_house_prize, s.line_prize,
         jackpot?.enabled ?? 0, jackpot?.amount ?? 0, jackpot?.ball_count ?? 45,
         s.timezone ?? 'UTC']
      )
      created++
    }
  }

  res.json({ ok: true, created, skipped })
})

// DELETE /api/schedule/draws/:id — delete a draw instance
router.delete('/draws/:id', requireAuth, (req, res) => {
  run('DELETE FROM draws WHERE id = ?', [req.params.id])
  triggerReschedule()
  res.json({ ok: true })
})

// POST /api/schedule/draws — create draw instance
router.post('/draws', requireAuth, (req, res) => {
  const { title, draw_date, draw_time, ball_interval, ticket_price, full_house_prize, line_prize, schedule_id, timezone } = req.body
  const jackpot = queryOne('SELECT * FROM jackpot WHERE id = 1')
  const id = insert(
    'INSERT INTO draws (schedule_id, title, draw_date, draw_time, ball_interval, ticket_price, full_house_prize, line_prize, jackpot_enabled, jackpot_amount, jackpot_ball_count, timezone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [schedule_id ?? null, title, draw_date, draw_time, ball_interval ?? 5, ticket_price, full_house_prize, line_prize,
     jackpot?.enabled ?? 0, jackpot?.amount ?? 0, jackpot?.ball_count ?? 45, timezone ?? 'UTC']
  )
  triggerReschedule()
  res.json({ id })
})

export default router
