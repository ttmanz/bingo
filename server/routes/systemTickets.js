import { Router } from 'express'
import { query, queryOne, run, insert, transaction, getHouseUserId } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { generateTicketCards } from '../cardGen.js'

const router = Router()

// ── Helpers ───────────────────────────────────────────────────────────────

function createRealTickets(drawId, ticketCount) {
  const houseId = getHouseUserId()
  if (!houseId) throw new Error('House user not found — server not fully initialised yet')

  const cardBatches = generateTicketCards(ticketCount, 'H')
  const ticketIds   = []

  transaction(({ run: tRun, query: tQuery }) => {
    for (const cards of cardBatches) {
      tRun(
        `INSERT INTO tickets (user_id, draw_id, numbers, purchase_price, status)
         VALUES (?,?,?,0,'active')`,
        [houseId, drawId, JSON.stringify(cards)]
      )
      const id = tQuery('SELECT last_insert_rowid() as id')[0].id
      ticketIds.push(id)
    }
  })

  return ticketIds
}

function deleteRealTickets(ticketIdsJson) {
  if (!ticketIdsJson) return
  let ids
  try { ids = JSON.parse(ticketIdsJson) } catch { return }
  if (!Array.isArray(ids) || !ids.length) return
  // Delete in batches of 100 to stay within SQLite parameter limit
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const placeholders = chunk.map(() => '?').join(',')
    run(`DELETE FROM tickets WHERE id IN (${placeholders})`, chunk)
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/system-tickets
router.get('/', requireAuth, (req, res) => {
  const entries = query(
    `SELECT st.*, d.title as draw_title, d.draw_date, d.draw_time
     FROM system_tickets st
     LEFT JOIN draws d ON d.id = st.draw_id
     ORDER BY st.created_at DESC`
  )
  const summary = queryOne(
    `SELECT COUNT(*) as total_entries,
            SUM(ticket_count) as total_tickets,
            SUM(win_amount)   as total_wins
     FROM system_tickets`
  )
  res.json({ entries, summary })
})

// GET /api/system-tickets/draws — all draws for the selector
router.get('/draws', requireAuth, (req, res) => {
  const draws = query(
    `SELECT id, title, draw_date, draw_time, type, status
     FROM draws ORDER BY draw_date DESC, draw_time DESC LIMIT 200`
  )
  res.json(draws)
})

// POST /api/system-tickets — create entry and generate real participatory tickets
router.post('/', requireAuth, (req, res) => {
  const { draw_id, draw_label, ticket_count, win_amount = 0, winning_ticket_ids, notes } = req.body
  if (!ticket_count || ticket_count < 1) {
    return res.status(400).json({ error: 'Ticket count must be at least 1' })
  }
  if (!draw_label) {
    return res.status(400).json({ error: 'Draw label is required' })
  }

  // If a draw_id is given, generate real tickets in the tickets table
  let ticketIds = null
  if (draw_id) {
    // Check the draw is still open (not completed/voided)
    const draw = queryOne('SELECT id, status FROM draws WHERE id = ?', [draw_id])
    if (!draw) return res.status(400).json({ error: 'Draw not found' })
    if (!['scheduled','running'].includes(draw.status)) {
      return res.status(400).json({ error: `Cannot add system tickets to a ${draw.status} draw` })
    }
    try {
      ticketIds = createRealTickets(draw_id, ticket_count)
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  const id = insert(
    `INSERT INTO system_tickets (draw_id, draw_label, ticket_count, win_amount, winning_ticket_ids, notes, ticket_ids)
     VALUES (?,?,?,?,?,?,?)`,
    [draw_id ?? null, draw_label, ticket_count, win_amount ?? 0,
     winning_ticket_ids?.trim() || null, notes ?? null,
     ticketIds ? JSON.stringify(ticketIds) : null]
  )

  res.json({ ok: true, id, tickets_created: ticketIds?.length ?? 0 })
})

// PUT /api/system-tickets/:id — update win amount, ticket count, or notes
router.put('/:id', requireAuth, (req, res) => {
  const row = queryOne('SELECT * FROM system_tickets WHERE id = ?', [req.params.id])
  if (!row) return res.status(404).json({ error: 'Entry not found' })
  const { win_amount, ticket_count, winning_ticket_ids, notes } = req.body

  // If ticket_count changes and we have a linked draw, adjust real tickets
  const newCount = ticket_count !== undefined ? ticket_count : row.ticket_count
  let updatedTicketIds = row.ticket_ids

  if (ticket_count !== undefined && ticket_count !== row.ticket_count && row.draw_id) {
    const draw = queryOne('SELECT id, status FROM draws WHERE id = ?', [row.draw_id])
    if (draw && ['scheduled','running'].includes(draw.status)) {
      const delta = ticket_count - row.ticket_count
      if (delta > 0) {
        // Add more tickets
        try {
          const newIds   = createRealTickets(row.draw_id, delta)
          const existing = row.ticket_ids ? JSON.parse(row.ticket_ids) : []
          updatedTicketIds = JSON.stringify([...existing, ...newIds])
        } catch (e) {
          return res.status(500).json({ error: e.message })
        }
      } else if (delta < 0) {
        // Remove tickets from the end of the list
        const existing = row.ticket_ids ? JSON.parse(row.ticket_ids) : []
        const toRemove = existing.slice(delta) // last |delta| IDs
        const toKeep   = existing.slice(0, existing.length + delta)
        deleteRealTickets(JSON.stringify(toRemove))
        updatedTicketIds = JSON.stringify(toKeep)
      }
    }
  }

  run(
    'UPDATE system_tickets SET win_amount=?, ticket_count=?, winning_ticket_ids=?, notes=?, ticket_ids=? WHERE id=?',
    [
      win_amount         !== undefined ? win_amount         : row.win_amount,
      newCount,
      winning_ticket_ids !== undefined ? (winning_ticket_ids?.trim() || null) : row.winning_ticket_ids,
      notes              !== undefined ? notes              : row.notes,
      updatedTicketIds,
      req.params.id,
    ]
  )
  res.json({ ok: true })
})

// DELETE /api/system-tickets/:id — remove entry and its real tickets
router.delete('/:id', requireAuth, (req, res) => {
  const row = queryOne('SELECT ticket_ids FROM system_tickets WHERE id = ?', [req.params.id])
  if (row) deleteRealTickets(row.ticket_ids)
  run('DELETE FROM system_tickets WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// POST /api/system-tickets/:id/generate — retroactively generate real tickets
// for an existing entry that was created before the participatory feature
router.post('/:id/generate', requireAuth, (req, res) => {
  const row = queryOne('SELECT * FROM system_tickets WHERE id = ?', [req.params.id])
  if (!row) return res.status(404).json({ error: 'Entry not found' })
  if (!row.draw_id) return res.status(400).json({ error: 'No draw linked to this entry' })
  if (row.ticket_ids) return res.status(400).json({ error: 'Real tickets already generated for this entry' })

  const draw = queryOne('SELECT id, status FROM draws WHERE id = ?', [row.draw_id])
  if (!draw) return res.status(400).json({ error: 'Draw not found' })
  if (!['scheduled','running'].includes(draw.status)) {
    return res.status(400).json({ error: `Cannot generate tickets for a ${draw.status} draw` })
  }

  let ticketIds
  try {
    ticketIds = createRealTickets(row.draw_id, row.ticket_count)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  run('UPDATE system_tickets SET ticket_ids = ? WHERE id = ?',
    [JSON.stringify(ticketIds), req.params.id])

  res.json({ ok: true, tickets_created: ticketIds.length })
})

export default router
