import { Router } from 'express'
import { query, queryOne, run, insert } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/payouts — transaction history  (?date=today filters to today)
router.get('/', requireAuth, (req, res) => {
  const { type, user_id, limit = 200, date } = req.query
  const conditions = []
  const params = []
  if (type)           { conditions.push('t.type = ?');    params.push(type) }
  if (user_id)        { conditions.push('t.user_id = ?'); params.push(user_id) }
  if (date === 'today') conditions.push("DATE(t.created_at) = DATE('now','localtime')")
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  params.push(Number(limit))
  const rows = query(
    `SELECT t.*, u.name as user_name FROM transactions t
     JOIN users u ON u.id = t.user_id
     ${where} ORDER BY t.created_at DESC LIMIT ?`,
    params
  )
  res.json(rows)
})

// GET /api/payouts/summary-today — today's stats snapshot
router.get('/summary-today', requireAuth, (req, res) => {
  const today = "DATE(t.created_at) = DATE('now','localtime')"
  const draws = queryOne(
    `SELECT COUNT(DISTINCT t.draw_id) as draws, COUNT(*) as tickets, SUM(ABS(t.amount)) as revenue
     FROM transactions t WHERE t.type = 'ticket_purchase' AND ${today}`
  )
  const prizes = queryOne(
    `SELECT COUNT(*) as count, SUM(t.amount) as total
     FROM transactions t WHERE t.type = 'prize' AND ${today}`
  )
  const deposits = queryOne(
    `SELECT COUNT(*) as count, SUM(t.amount) as total
     FROM transactions t WHERE t.type IN ('deposit','points_received') AND ${today}`
  )
  const withdrawals = queryOne(
    `SELECT COUNT(*) as count, SUM(ABS(t.amount)) as total
     FROM transactions t WHERE t.type = 'withdrawal' AND ${today}`
  )
  res.json({
    draws:       draws?.draws        ?? 0,
    ticketsSold: { count: draws?.tickets    ?? 0, total: draws?.revenue  ?? 0 },
    prizes:      { count: prizes?.count     ?? 0, total: prizes?.total   ?? 0 },
    deposits:    { count: deposits?.count   ?? 0, total: deposits?.total  ?? 0 },
    withdrawals: { count: withdrawals?.count ?? 0, total: withdrawals?.total ?? 0 },
  })
})

// GET /api/payouts/summary — balance and totals (players + agents)
router.get('/summary', requireAuth, (req, res) => {
  const totals = query(
    `SELECT type, SUM(amount) as total, COUNT(*) as count FROM transactions GROUP BY type`
  )

  // Player stats — users with role = 'player'
  const playerBalance = queryOne(
    "SELECT SUM(points) as total FROM users WHERE role = 'player'"
  )
  const pendingPayouts = queryOne(
    "SELECT COUNT(*) as count, SUM(prize_amount) as total FROM tickets WHERE paid_out = 0 AND status != 'active'"
  )
  const playerDeposits = queryOne(
    `SELECT SUM(t.amount) as total FROM transactions t
     JOIN users u ON u.id = t.user_id
     WHERE t.type = 'points_received' AND u.role = 'player'`
  )
  const playerPrizes = queryOne(
    `SELECT SUM(t.amount) as total FROM transactions t
     JOIN users u ON u.id = t.user_id
     WHERE t.type = 'prize' AND u.role = 'player'`
  )

  // Agent stats — users with role IN ('super_agent','master_agent','agent')
  const agentBalance = queryOne(
    "SELECT SUM(points) as total FROM users WHERE role IN ('super_agent','master_agent','agent')"
  )
  const agentPendingPayouts = queryOne(
    `SELECT COUNT(*) as count, SUM(t.prize_amount) as total
     FROM tickets t JOIN users u ON u.id = t.user_id
     WHERE t.paid_out = 0 AND t.status != 'active'
       AND u.role IN ('super_agent','master_agent','agent')`
  )
  const agentDeposits = queryOne(
    `SELECT SUM(t.amount) as total FROM transactions t
     JOIN users u ON u.id = t.user_id
     WHERE t.type = 'points_received' AND u.role IN ('super_agent','master_agent','agent')`
  )
  const agentPrizes = queryOne(
    `SELECT SUM(t.amount) as total FROM transactions t
     JOIN users u ON u.id = t.user_id
     WHERE t.type = 'prize' AND u.role IN ('super_agent','master_agent','agent')`
  )
  const agentSoldBack = queryOne(
    `SELECT SUM(ABS(t.amount)) as total FROM transactions t
     JOIN users u ON u.id = t.user_id
     WHERE t.type = 'points_sold' AND u.role IN ('super_agent','master_agent','agent')`
  )

  res.json({
    totals,
    // Players
    userBalance:    playerBalance?.total   ?? 0,
    pendingPayouts,
    playerDeposits: playerDeposits?.total  ?? 0,
    playerPrizes:   playerPrizes?.total    ?? 0,
    // Agents
    agentBalance:        agentBalance?.total        ?? 0,
    agentPendingPayouts: agentPendingPayouts,
    agentDeposits:       agentDeposits?.total       ?? 0,
    agentPrizes:         agentPrizes?.total         ?? 0,
    agentSoldBack:       agentSoldBack?.total       ?? 0,
  })
})

// POST /api/payouts/deposit — add balance to user
router.post('/deposit', requireAuth, (req, res) => {
  const { user_id, amount, description } = req.body
  const user = queryOne('SELECT * FROM users WHERE id = ?', [user_id])
  if (!user) return res.status(404).json({ error: 'User not found' })
  const newBalance = (user.balance ?? 0) + Number(amount)
  run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user_id])
  insert(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [user_id, 'deposit', amount, newBalance, description ?? 'Manual deposit']
  )
  res.json({ ok: true, balance: newBalance })
})

// POST /api/payouts/withdraw — deduct balance from user
router.post('/withdraw', requireAuth, (req, res) => {
  const { user_id, amount, description } = req.body
  const user = queryOne('SELECT * FROM users WHERE id = ?', [user_id])
  if (!user) return res.status(404).json({ error: 'User not found' })
  const newBalance = (user.balance ?? 0) - Number(amount)
  run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user_id])
  insert(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [user_id, 'withdrawal', -amount, newBalance, description ?? 'Manual withdrawal']
  )
  res.json({ ok: true, balance: newBalance })
})

// POST /api/payouts/prize — pay out a winning ticket
router.post('/prize', requireAuth, (req, res) => {
  const { ticket_id } = req.body
  const ticket = queryOne(
    'SELECT t.*, u.balance FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
    [ticket_id]
  )
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
  if (ticket.paid_out) return res.status(400).json({ error: 'Already paid out' })
  const newBalance = (ticket.balance ?? 0) + ticket.prize_amount
  run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, ticket.user_id])
  run('UPDATE tickets SET paid_out = 1 WHERE id = ?', [ticket_id])
  insert(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description, draw_id) VALUES (?,?,?,?,?,?)',
    [ticket.user_id, 'prize_win', ticket.prize_amount, newBalance, `Prize for ticket #${ticket_id}`, ticket.draw_id]
  )
  res.json({ ok: true, balance: newBalance })
})

export default router
