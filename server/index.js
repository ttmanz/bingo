import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb } from './db.js'
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
const io         = new Server(httpServer, { cors: { origin: '*' } })

app.use(express.json())
app.set('etag', false)

// ── Serve static panels ───────────────────────────────────────────────────
const noCache = { etag: false, setHeaders: (res, path) => {
  if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
}}
app.use('/',             express.static(join(__dirname, '../landing'),      noCache))
app.use('/admin',        express.static(join(__dirname, '../admin'),        noCache))
app.use('/agent-portal', express.static(join(__dirname, '../agent-portal'), noCache))
app.use('/user-portal',     express.static(join(__dirname, '../user-portal'),  noCache))
app.use('/special-draws',   express.static(join(__dirname, '../special-draws'),noCache))
app.use('/bingo-room',      express.static(join(__dirname, '../bingo-room'),   noCache))

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
import { query as dbQuery, run as dbRun } from './db.js'

const TZ_EXPIRE = 'Asia/Nicosia'
function expirePastDraws() {
  try {
    const now = new Date()
    const scheduled = dbQuery(
      `SELECT id, draw_date, draw_time FROM draws WHERE status = 'scheduled'`
    )
    for (const d of scheduled) {
      const t = d.draw_time.length === 5 ? d.draw_time + ':00' : d.draw_time
      const probe = new Date(`${d.draw_date}T${t}Z`)
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ_EXPIRE, year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false
      }).formatToParts(probe).reduce((a, p) => { a[p.type] = p.value; return a }, {})
      const tzDate = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
      const offsetMs = probe - tzDate
      const utc = new Date(probe.getTime() + offsetMs)
      if (utc <= now) {
        dbRun(`UPDATE draws SET status = 'completed' WHERE id = ?`, [d.id])
      }
    }
  } catch {}
}
setInterval(expirePastDraws, 60_000)

// ── Live draw (Socket.io) ─────────────────────────────────────────────────
const DRAW_INTERVAL_MS = 7000
const TICK_MS          = 100

const game      = createGameState()
let drawTimer   = null
let tickTimer   = null
let countdown   = DRAW_INTERVAL_MS

function startCycle() {
  clearTimeout(drawTimer)
  clearInterval(tickTimer)
  countdown = DRAW_INTERVAL_MS

  tickTimer = setInterval(() => {
    countdown = Math.max(0, countdown - TICK_MS)
    io.emit('countdown', { remaining: countdown / 1000, total: DRAW_INTERVAL_MS / 1000 })
  }, TICK_MS)

  drawTimer = setTimeout(() => {
    clearInterval(tickTimer)
    if (game.gameOver) return
    const number = drawNumber(game)
    if (number !== null) {
      io.emit('number-drawn', { number, called: [...game.called] })
      startCycle()
    } else {
      game.gameOver = true
      io.emit('game-over')
    }
  }, DRAW_INTERVAL_MS)
}

io.on('connection', (socket) => {
  socket.emit('state', getState(game))

  socket.on('bingo', () => {
    game.gameOver = true
    clearTimeout(drawTimer)
    clearInterval(tickTimer)
    io.emit('game-over')
  })

  socket.on('reset', () => {
    resetGame(game)
    startCycle()
    io.emit('game-reset')
  })
})

// ── Boot ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001

initDb().then(() => {
  startCycle()
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
