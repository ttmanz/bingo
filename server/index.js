// ── Catch any crash BEFORE it silently kills the process ─────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason)
})

import express from 'express'
import compression from 'compression'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, getHouseUserId } from './db.js'
import { createGameState, drawNumber, resetGame, getState } from './gameState.js'
import authRoutes        from './routes/auth.js'
import scheduleRoutes    from './routes/schedule.js'
import ticketRoutes      from './routes/tickets.js'
import jackpotRoutes     from './routes/jackpot.js'
import userRoutes        from './routes/users.js'
import agentRoutes       from './routes/agents.js'
import payoutRoutes      from './routes/payouts.js'
import agentAuthRoutes   from './routes/agentAuth.js'
import agentPortalRoutes from './routes/agentPortal.js'
import userAuthRoutes      from './routes/userAuth.js'
import userPortalRoutes    from './routes/userPortal.js'
import specialDrawsRoutes  from './routes/specialDraws.js'
import systemTicketsRoutes from './routes/systemTickets.js'
import importCardsRoutes   from './routes/importCards.js'
import presetCardsRoutes  from './routes/presetCards.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app        = express()
const httpServer = createServer(app)
const io         = new Server(httpServer, {
  cors: { origin: '*' },
  // Tune for many concurrent connections
  pingInterval:  25000,   // how often to ping clients (ms)
  pingTimeout:   20000,   // how long before a silent client is dropped (ms)
  maxHttpBufferSize: 1e5, // 100KB max message — prevents memory abuse
  transports: ['websocket', 'polling'], // prefer WebSocket, polling as fallback
})

// ── Gzip compression for all HTTP responses ───────────────────────────────
// Reduces JS/CSS/HTML payload by ~70%, cuts bandwidth and page load time
app.use(compression({ level: 6, threshold: 1024 }))

app.use(express.json({ limit: '100kb' }))
app.set('etag', false)

// ── Serve static panels ───────────────────────────────────────────────────
const noCache = { etag: false, setHeaders: (res, filePath) => {
  if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
}}

// Belt-and-braces: explicitly serve each index.html with no-cache so
// browsers can never hold a stale copy with an old portal.js version tag
const serveIndex = (dir) => (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.sendFile(join(__dirname, dir, 'index.html'))
}
app.get('/user-portal',            serveIndex('../user-portal'))
app.get('/user-portal/',           serveIndex('../user-portal'))
app.get('/user-portal/index.html', serveIndex('../user-portal'))
app.get('/bingo-room',             serveIndex('../bingo-room'))
app.get('/bingo-room/',            serveIndex('../bingo-room'))
app.get('/bingo-room/index.html',  serveIndex('../bingo-room'))
app.get('/admin',                  serveIndex('../admin'))
app.get('/admin/',                 serveIndex('../admin'))
app.get('/display',                serveIndex('../display'))
app.get('/display/',               serveIndex('../display'))
app.get('/display/index.html',     serveIndex('../display'))

app.use('/',             express.static(join(__dirname, '../landing'),      noCache))
app.use('/admin',        express.static(join(__dirname, '../admin'),        noCache))
app.use('/agent-portal', express.static(join(__dirname, '../agent-portal'), noCache))
app.use('/user-portal',     express.static(join(__dirname, '../user-portal'),  noCache))
app.use('/special-draws',   express.static(join(__dirname, '../special-draws'),noCache))
app.use('/bingo-room',      express.static(join(__dirname, '../bingo-room'),   noCache))
app.use('/display',         express.static(join(__dirname, '../display'),       noCache))
app.use('/terms',           express.static(join(__dirname, '../terms'),         noCache))

// ── API routes ────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes)
app.use('/api/schedule',     scheduleRoutes)
app.use('/api/tickets',      ticketRoutes)
app.use('/api/jackpot',      jackpotRoutes)
app.use('/api/users',        userRoutes)
app.use('/api/agents',       agentRoutes)
app.use('/api/payouts',      payoutRoutes)
app.use('/api/agent-auth',   agentAuthRoutes)
app.use('/api/agent-portal', agentPortalRoutes)
app.use('/api/user-auth',      userAuthRoutes)
app.use('/api/user-portal',    userPortalRoutes)
app.use('/api/special-draws',   specialDrawsRoutes)
app.use('/api/system-tickets',  systemTicketsRoutes)
app.use('/api/import-cards',    importCardsRoutes)
app.use('/api/preset-cards',   presetCardsRoutes)

// ── Auto-expire past scheduled draws ─────────────────────────────────────
import { query as dbQuery, queryOne as dbQueryOne, run as dbRun, insert as dbInsert } from './db.js'
import { setRescheduleCallback, setManualWinCallback } from './gameBridge.js'

const TZ_EXPIRE = 'Asia/Nicosia'

function drawScheduledUtc(d) {
  const t     = d.draw_time.length === 5 ? d.draw_time + ':00' : d.draw_time
  const probe = new Date(`${d.draw_date}T${t}Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_EXPIRE, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false
  }).formatToParts(probe).reduce((a, p) => { a[p.type] = p.value; return a }, {})
  const tzDate = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
  return new Date(probe.getTime() + (probe - tzDate))
}

function voidDrawAndRefund(d) {
  // Refund all active ticket purchases for this draw
  const byUser = dbQuery(
    `SELECT user_id, SUM(purchase_price) as refund FROM tickets
     WHERE draw_id = ? AND status = 'active' GROUP BY user_id`,
    [d.id]
  )
  for (const row of byUser) {
    const user = dbQueryOne('SELECT points FROM users WHERE id = ?', [row.user_id])
    if (!user) continue
    const newBalance = (user.points ?? 0) + row.refund
    dbRun('UPDATE users SET points = points + ? WHERE id = ?', [row.refund, row.user_id])
    dbInsert(
      'INSERT INTO transactions (user_id, type, amount, balance_after, description, draw_id) VALUES (?,?,?,?,?,?)',
      [row.user_id, 'refund', row.refund, newBalance, `Draw "${d.title}" voided — points refunded`, d.id]
    )
  }
  dbRun(`UPDATE tickets SET status = 'voided' WHERE draw_id = ? AND status = 'active'`, [d.id])
  dbRun(`UPDATE draws SET status = 'voided' WHERE id = ?`, [d.id])
}

function expirePastDraws() {
  try {
    const now = new Date()

    // Expire scheduled draws whose time has passed — iterate each in its own try/catch
    // so one draw with a bad date can't crash the entire cleanup pass
    const scheduled = dbQuery(`SELECT id, draw_date, draw_time FROM draws WHERE status = 'scheduled'`)
    for (const d of scheduled) {
      try {
        if (!d.draw_date || !d.draw_time) continue
        if (drawScheduledUtc(d) <= now) {
          dbRun(`UPDATE draws SET status = 'completed' WHERE id = ?`, [d.id])
        }
      } catch (e) { console.error(`[expirePastDraws] draw ${d.id}:`, e.message) }
    }

    // Void running draws stuck > 30 min past their scheduled time (server crash recovery)
    let voidedAny = false
    const running = dbQuery(`SELECT id, title, draw_date, draw_time FROM draws WHERE status = 'running'`)
    for (const d of running) {
      try {
        if (!d.draw_date || !d.draw_time) continue
        if (now - drawScheduledUtc(d) > 30 * 60 * 1000) {
          console.log(`[expirePastDraws] voiding stuck running draw ${d.id} "${d.title}"`)
          voidDrawAndRefund(d)
          voidedAny = true
        }
      } catch (e) { console.error(`[expirePastDraws] running draw ${d.id}:`, e.message) }
    }
    if (voidedAny) scheduleNextDraw()
  } catch (e) { console.error('[expirePastDraws] outer error:', e.message) }
}
setInterval(expirePastDraws, 60_000)

// ── Live draw (Socket.io) ─────────────────────────────────────────────────
const TICK_MS = 100

const game      = createGameState()
let drawTimer   = null
let tickTimer   = null
let waitTimer   = null
let gamePhase   = 'waiting'
let currentDraw = null

const TZ_GAME = 'Asia/Nicosia'
function drawLocalToUtcMs(draw_date, draw_time) {
  const t     = draw_time.length === 5 ? draw_time + ':00' : draw_time
  const probe = new Date(`${draw_date}T${t}Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_GAME, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false
  }).formatToParts(probe).reduce((a, p) => { a[p.type] = p.value; return a }, {})
  // Node.js/ICU bug: hour12:false can return '24' instead of '00' for midnight —
  // the day is already correct (next day), so just map '24' → '00'
  if (parts.hour === '24') parts.hour = '00'
  const tzDate = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
  return probe.getTime() + (probe - tzDate)
}

function getNextScheduledDraw() {
  try {
    return dbQuery(
      `SELECT id, title, draw_date, draw_time, ball_interval, line_prize, full_house_prize, announcer FROM draws
       WHERE status = 'scheduled'
       ORDER BY draw_date ASC, draw_time ASC LIMIT 1`
    )[0] ?? null
  } catch { return null }
}

// ── Per-draw win state ────────────────────────────────────────────────────
let linePrizeAwarded  = false
let bingoPrizeAwarded = false
let lineWinnerEmail   = null
let bingoWinnerEmail  = null

function awardPrize(userId, drawId, ticketId, amount, description) {
  try {
    const user = dbQueryOne('SELECT points FROM users WHERE id = ?', [userId])
    const newPoints = (user?.points ?? 0) + amount
    dbRun('UPDATE users SET points = ? WHERE id = ?', [newPoints, userId])
    dbRun('UPDATE tickets SET prize_amount = prize_amount + ?, paid_out = 1 WHERE id = ?', [amount, ticketId])
    dbInsert(
      'INSERT INTO transactions (user_id, type, amount, balance_after, description, draw_id) VALUES (?,?,?,?,?,?)',
      [userId, 'prize', amount, newPoints, description, drawId]
    )
  } catch (e) {
    console.error('Prize award error:', e)
  }
}

function checkWins(drawId, draw) {
  const called = new Set(game.called)
  let bingoTriggered = false

  console.log(`[checkWins] drawId=${drawId} called.size=${called.size} linePrizeAwarded=${linePrizeAwarded} bingoPrizeAwarded=${bingoPrizeAwarded}`)

  try {
    const tickets = dbQuery(
      "SELECT id, user_id, numbers FROM tickets WHERE draw_id = ? AND status = 'active'",
      [drawId]
    )
    console.log(`[checkWins] tickets found: ${tickets.length}`)

    for (const ticket of tickets) {
      const cards = JSON.parse(ticket.numbers)

      for (const card of cards) {
        const rows = [card.row1, card.row2, card.row3]
        const cardNums = rows.flat().filter(n => n !== null)
        const missingFromCalled = cardNums.filter(n => !called.has(n))

        // LINE: any row fully called — house tickets are never eligible for the line prize
        if (!linePrizeAwarded && ticket.user_id !== getHouseUserId()) {
          for (const row of rows) {
            const nums = row.filter(n => n !== null)
            if (nums.length && nums.every(n => called.has(n))) {
              linePrizeAwarded = true
              const prize = draw.line_prize ?? 0
              if (prize > 0) awardPrize(ticket.user_id, drawId, ticket.id, prize, 'LINE win')
              const lu = dbQueryOne('SELECT email FROM users WHERE id = ?', [ticket.user_id])
              lineWinnerEmail = lu?.email ?? null
              io.emit('prize-awarded', { type: 'line', user_id: ticket.user_id, amount: prize })
              console.log(`LINE win — user ${ticket.user_id}, prize ${prize}`)
              break
            }
          }
        }

        // BINGO: all 15 numbers on this card called
        if (!bingoPrizeAwarded) {
          if (missingFromCalled.length === 0) {
            bingoPrizeAwarded = true
            const prize = draw.full_house_prize ?? 0
            if (prize > 0) awardPrize(ticket.user_id, drawId, ticket.id, prize, 'BINGO win')
            const bu = dbQueryOne('SELECT email FROM users WHERE id = ?', [ticket.user_id])
            bingoWinnerEmail = (ticket.user_id === getHouseUserId()) ? null : (bu?.email ?? null)
            io.emit('prize-awarded', { type: 'bingo', user_id: ticket.user_id, amount: prize })
            console.log(`BINGO win — user ${ticket.user_id}, prize ${prize}`)
            bingoTriggered = true
          } else if (missingFromCalled.length <= 3) {
            console.log(`[checkWins] near-bingo card ${card.code}: missing ${missingFromCalled}`)
          }
        }
      }
      if (bingoTriggered) break
    }
    if (!bingoTriggered) console.log(`[checkWins] no bingo found with ${called.size} balls called`)
  } catch (e) {
    console.error('Win check error:', e)
  }

  return bingoTriggered
}

function scheduleNextDraw() {
  clearTimeout(drawTimer)
  clearTimeout(waitTimer)
  clearInterval(tickTimer)

  const next = getNextScheduledDraw()
  gamePhase   = 'waiting'
  currentDraw = next

  if (!next) {
    io.emit('waiting', { drawId: null, nextDrawTime: null, nextDrawTitle: null })
    waitTimer = setTimeout(scheduleNextDraw, 60_000)
    return
  }

  const startMs = drawLocalToUtcMs(next.draw_date, next.draw_time)

  // Guard against draws with missing/invalid date-time — skip them silently
  if (isNaN(startMs)) {
    console.error(`[scheduleNextDraw] Draw ${next.id} "${next.title}" has invalid date/time (${next.draw_date} ${next.draw_time}) — marking completed and retrying`)
    try { dbRun(`UPDATE draws SET status = 'completed' WHERE id = ?`, [next.id]) } catch {}
    waitTimer = setTimeout(scheduleNextDraw, 500)
    return
  }

  const delay = startMs - Date.now()

  io.emit('waiting', {
    drawId:          next.id,
    nextDrawTime:    new Date(startMs).toISOString(),
    nextDrawTitle:   next.title,
    announcer:       next.announcer ?? null,
    line_prize:      next.line_prize ?? 0,
    full_house_prize: next.full_house_prize ?? 0,
  })

  if (delay <= 0) {
    startDraw(next)
  } else {
    waitTimer = setTimeout(() => startDraw(next), delay)
  }
}

function startDraw(draw) {
  clearTimeout(waitTimer)
  const intervalMs = Math.max(2000, (draw.ball_interval ?? 5) * 1000)
  gamePhase   = 'drawing'
  currentDraw = draw
  linePrizeAwarded  = false
  bingoPrizeAwarded = false
  lineWinnerEmail   = null
  bingoWinnerEmail  = null
  resetGame(game)
  try { dbRun(`UPDATE draws SET status = 'running' WHERE id = ?`, [draw.id]) } catch (e) { console.error('[startDraw] status→running failed:', e.message) }
  io.emit('game-reset', { drawId: draw.id })
  drawNextBall(intervalMs, draw.id)
}

function drawNextBall(intervalMs, drawId) {
  clearTimeout(drawTimer)
  clearInterval(tickTimer)
  let cd = intervalMs

  tickTimer = setInterval(() => {
    cd = Math.max(0, cd - TICK_MS)
    io.emit('countdown', { remaining: cd / 1000, total: intervalMs / 1000 })
  }, TICK_MS)

  drawTimer = setTimeout(() => {
    clearInterval(tickTimer)
    if (game.gameOver) return
    const number = drawNumber(game)
    if (number !== null) {
      io.emit('number-drawn', { number, called: [...game.called] })
      drawNextBall(intervalMs, drawId)
    } else {
      // All balls drawn — check wins first so winner emails are set, then broadcast
      game.gameOver = true
      try { dbRun(`UPDATE draws SET status = 'completed' WHERE id = ?`, [drawId]) } catch (e) { console.error('[drawNextBall] status→completed failed:', e.message) }
      checkWins(drawId, currentDraw)
      io.emit('game-over')
      io.emit('draw-results', {
        drawTitle:        currentDraw?.title ?? '',
        lineWinner:       lineWinnerEmail,
        bingoWinner:      bingoWinnerEmail,
        linePrizeAwarded,
        bingoPrizeAwarded,
      })
      setTimeout(scheduleNextDraw, 5_000)
    }
  }, intervalMs)
}

io.on('connection', (socket) => {
  if (gamePhase === 'waiting' && currentDraw) {
    const startMs = drawLocalToUtcMs(currentDraw.draw_date, currentDraw.draw_time)
    socket.emit('state', {
      ...getState(game), phase: 'waiting',
      drawId:          currentDraw.id,
      nextDrawTime:    new Date(startMs).toISOString(),
      nextDrawTitle:   currentDraw.title,
      announcer:       currentDraw.announcer ?? null,
      line_prize:      currentDraw.line_prize ?? 0,
      full_house_prize: currentDraw.full_house_prize ?? 0,
    })
  } else if (gamePhase === 'waiting') {
    socket.emit('state', { ...getState(game), phase: 'waiting', drawId: null, nextDrawTime: null, nextDrawTitle: null })
  } else {
    // Include the NEXT scheduled draw so the "Draw in Progress" curtain
    // can tell the user when to come back.  getNextScheduledDraw() skips
    // the running draw (status='running') and returns the next 'scheduled' one.
    const afterCurrent = getNextScheduledDraw()
    socket.emit('state', {
      ...getState(game), phase: 'drawing',
      drawId:            currentDraw?.id ?? null,
      drawTitle:         currentDraw?.title ?? '',
      announcer:         currentDraw?.announcer ?? null,
      linePrizeAwarded:  linePrizeAwarded,
      bingoPrizeAwarded: bingoPrizeAwarded,
      nextDrawTime:      afterCurrent
        ? new Date(drawLocalToUtcMs(afterCurrent.draw_date, afterCurrent.draw_time)).toISOString()
        : null,
      nextDrawTitle:     afterCurrent?.title ?? null,
      line_prize:        currentDraw?.line_prize ?? 0,
      full_house_prize:  currentDraw?.full_house_prize ?? 0,
    })
  }

  socket.on('line', () => {
    if (!currentDraw || linePrizeAwarded || game.gameOver) return
    const drawId = currentDraw.id
    const draw   = currentDraw
    const called = new Set(game.called)
    try {
      const tickets = dbQuery(
        "SELECT id, user_id, numbers FROM tickets WHERE draw_id = ? AND status = 'active'",
        [drawId]
      )
      for (const ticket of tickets) {
        if (linePrizeAwarded) break
        const cards = JSON.parse(ticket.numbers)
        for (const card of cards) {
          const rows = [card.row1, card.row2, card.row3]
          for (const row of rows) {
            const nums = row.filter(n => n !== null)
            if (nums.length && nums.every(n => called.has(n))) {
              linePrizeAwarded = true
              const prize = draw.line_prize ?? 0
              if (prize > 0) awardPrize(ticket.user_id, drawId, ticket.id, prize, 'LINE win')
              const lu2 = dbQueryOne('SELECT email FROM users WHERE id = ?', [ticket.user_id])
              lineWinnerEmail = (ticket.user_id === getHouseUserId()) ? null : (lu2?.email ?? null)
              io.emit('prize-awarded', { type: 'line', user_id: ticket.user_id, amount: prize })
              console.log(`LINE win — user ${ticket.user_id}, prize ${prize}`)
              return
            }
          }
        }
      }
    } catch (e) {
      console.error('Line check error:', e)
    }
  })

  socket.on('bingo', () => {
    if (game.gameOver) return
    game.gameOver = true
    clearTimeout(drawTimer)
    clearInterval(tickTimer)
    if (currentDraw) {
      try { dbRun(`UPDATE draws SET status = 'completed' WHERE id = ?`, [currentDraw.id]) } catch {}
      checkWins(currentDraw.id, currentDraw)
    }
    io.emit('game-over')
    io.emit('draw-results', {
      drawTitle:        currentDraw?.title ?? '',
      lineWinner:       lineWinnerEmail,
      bingoWinner:      bingoWinnerEmail,
      linePrizeAwarded,
      bingoPrizeAwarded,
    })
    setTimeout(scheduleNextDraw, 5_000)
  })

  socket.on('reset', () => {
    scheduleNextDraw()
  })
})

// ── Boot ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001

setRescheduleCallback(scheduleNextDraw)

// ── Manual win callback (used by POST /api/system-tickets/give-win) ───────
setManualWinCallback(({ drawId, userId, ticketId, linePrize, bingoPrize, winType }) => {
  if (!currentDraw || currentDraw.id !== drawId) {
    return { error: 'This draw is not currently running' }
  }
  const results = []

  if ((winType === 'line' || winType === 'both') && !linePrizeAwarded) {
    linePrizeAwarded = true
    if (linePrize > 0) awardPrize(userId, drawId, ticketId, linePrize, 'LINE win (manual)')
    const lu = dbQueryOne('SELECT email FROM users WHERE id = ?', [userId])
    lineWinnerEmail = (userId === getHouseUserId()) ? null : (lu?.email ?? null)
    io.emit('prize-awarded', { type: 'line', user_id: userId, amount: linePrize })
    results.push('line')
  } else if (winType === 'line' && linePrizeAwarded) {
    return { error: 'Line prize has already been awarded for this draw' }
  }

  if ((winType === 'bingo' || winType === 'both') && !bingoPrizeAwarded) {
    bingoPrizeAwarded = true
    if (bingoPrize > 0) awardPrize(userId, drawId, ticketId, bingoPrize, 'BINGO win (manual)')
    const bu = dbQueryOne('SELECT email FROM users WHERE id = ?', [userId])
    bingoWinnerEmail = (userId === getHouseUserId()) ? null : (bu?.email ?? null)
    io.emit('prize-awarded', { type: 'bingo', user_id: userId, amount: bingoPrize })
    results.push('bingo')
  } else if (winType === 'bingo' && bingoPrizeAwarded) {
    return { error: 'Full house prize has already been awarded for this draw' }
  }

  return { ok: true, awarded: results }
})

initDb().then(() => {
  scheduleNextDraw()
  httpServer.listen(PORT, () => {
    console.log(`Bingo server  → http://localhost:${PORT}`)
    console.log(`Admin panel   → http://localhost:${PORT}/admin`)
    console.log(`Agent portal  → http://localhost:${PORT}/agent-portal`)
    console.log(`User portal   → http://localhost:${PORT}/user-portal`)
  })
}).catch(err => {
  console.error('DB init failed:', err)
  process.exit(1)
})
