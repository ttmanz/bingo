import { Router } from 'express'
import { query, queryOne, run } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/tickets — all tickets with optional filters
router.get('/', requireAuth, (req, res) => {
  const { draw_id, status, paid_out, limit = 100 } = req.query
  const conditions = []
  const params = []
  if (draw_id)  { conditions.push('t.draw_id = ?');  params.push(draw_id) }
  if (status)   { conditions.push('t.status = ?');   params.push(status) }
  if (paid_out !== undefined) { conditions.push('t.paid_out = ?'); params.push(Number(paid_out)) }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  params.push(Number(limit))
  const rows = query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, d.title as draw_title, d.draw_date
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     JOIN draws d ON d.id = t.draw_id
     ${where} ORDER BY t.created_at DESC LIMIT ?`,
    params
  )
  res.json(rows)
})

// GET /api/tickets/winning — winning tickets only
router.get('/winning', requireAuth, (req, res) => {
  const rows = query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, d.title as draw_title, d.draw_date
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     JOIN draws d ON d.id = t.draw_id
     WHERE t.status != 'active'
     ORDER BY t.created_at DESC LIMIT 200`
  )
  res.json(rows)
})

// PUT /api/tickets/:id/payout — mark ticket as paid out
router.put('/:id/payout', requireAuth, (req, res) => {
  const ticket = queryOne('SELECT * FROM tickets WHERE id = ?', [req.params.id])
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
  if (ticket.paid_out) return res.status(400).json({ error: 'Already paid out' })
  run('UPDATE tickets SET paid_out = 1 WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

export default router
