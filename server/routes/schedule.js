import { Router } from 'express'
import { query, queryOne, run, insert } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

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
  const { day_of_week, draw_time, draw_number, title, ball_interval, ticket_price, full_house_prize, line_prize } = req.body
  const id = insert(
    'INSERT INTO draw_schedule (day_of_week, draw_time, draw_number, title, ball_interval, ticket_price, full_house_prize, line_prize) VALUES (?,?,?,?,?,?,?,?)',
    [day_of_week, draw_time, draw_number ?? 1, title, ball_interval ?? 5, ticket_price, full_house_prize, line_prize]
  )
  res.json({ id, ...req.body })
})

// PUT /api/schedule/:id — update entry
router.put('/:id', requireAuth, (req, res) => {
  const { draw_time, draw_number, title, ball_interval, ticket_price, full_house_prize, line_prize, enabled } = req.body
  run(
    'UPDATE draw_schedule SET draw_time=?, draw_number=?, title=?, ball_interval=?, ticket_price=?, full_house_prize=?, line_prize=?, enabled=? WHERE id=?',
    [draw_time, draw_number, title, ball_interval, ticket_price, full_house_prize, line_prize, enabled ?? 1, req.params.id]
  )
  res.json({ ok: true })
})

// DELETE /api/schedule/:id
router.delete('/:id', requireAuth, (req, res) => {
  run('DELETE FROM draw_schedule WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// GET /api/schedule/draws — all draw instances
router.get('/draws', requireAuth, (req, res) => {
  const { status, limit = 50 } = req.query
  const where = status ? 'WHERE d.status = ?' : ''
  const params = status ? [status, Number(limit)] : [Number(limit)]
  const rows = query(
    `SELECT d.*, COUNT(t.id) as ticket_count FROM draws d
     LEFT JOIN tickets t ON t.draw_id = d.id
     ${where} GROUP BY d.id ORDER BY d.draw_date DESC, d.draw_time DESC LIMIT ?`,
    params
  )
  res.json(rows)
})

// POST /api/schedule/draws — create draw instance
router.post('/draws', requireAuth, (req, res) => {
  const { title, draw_date, draw_time, ball_interval, ticket_price, full_house_prize, line_prize, schedule_id } = req.body
  const jackpot = queryOne('SELECT * FROM jackpot WHERE id = 1')
  const id = insert(
    'INSERT INTO draws (schedule_id, title, draw_date, draw_time, ball_interval, ticket_price, full_house_prize, line_prize, jackpot_enabled, jackpot_amount, jackpot_ball_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [schedule_id ?? null, title, draw_date, draw_time, ball_interval ?? 5, ticket_price, full_house_prize, line_prize,
     jackpot?.enabled ?? 0, jackpot?.amount ?? 0, jackpot?.ball_count ?? 45]
  )
  res.json({ id })
})

export default router
