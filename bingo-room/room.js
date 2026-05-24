import { gsap }          from 'gsap'
import { DrumPhysics3D } from '/bingo-room/DrumPhysics3D.js'
import { CallCard }      from '/bingo-room/CallCard.js'
import { Announcer }     from '/bingo-room/Announcer.js'
import { COL_COLORS }    from '/bingo-room/bingoLogic.js'

// ── DOM refs ──────────────────────────────────────────────────────────────
const drumEl        = document.getElementById('drum')
const machineEl     = document.getElementById('lottery-machine')
const ballEl        = document.getElementById('current-ball')
const calledEl      = document.getElementById('called-numbers')
const timerBarEl    = document.getElementById('drum-timer-bar')
const countdownFill = document.getElementById('room-countdown-fill')
const statusTextEl  = document.getElementById('status-text')
const liveDot       = document.getElementById('live-dot')
const cardGridEl    = document.getElementById('room-card-grid')
const cardDrawEl    = document.getElementById('room-card-draw')
const noTicketEl    = document.getElementById('room-no-ticket')
const lastNumEl     = document.getElementById('room-last-number')
const winBannerEl   = document.getElementById('room-win-banner')

// ── Init ──────────────────────────────────────────────────────────────────
const drum      = new DrumPhysics3D(drumEl, machineEl)
const callCard  = new CallCard(calledEl, ballEl)
const announcer = new Announcer()

let drawing    = false
let paused     = false
let calledSet  = new Set()
let lineWon       = false
let bingoWon      = false
let _socket       = null
let _cdTimer      = null   // next-draw countdown interval
let _drawResults  = null   // stored until ceremony ends
let _pendingBalls = []     // balls received while paused — drained on resume
let _introPlayed   = false  // prevents intro replaying within same draw cycle
let _nextDrawTitle = ''     // stored from 'waiting'/'state' for intro speech

const _token = localStorage.getItem('bp_token') || ''

async function fetchNextDrawTime() {
  try {
    const headers = _token ? { 'Authorization': 'Bearer ' + _token } : {}
    const res  = await fetch('/api/user-portal/available-draws', { headers })
    if (!res.ok) return null
    const data = await res.json()
    const draws = Array.isArray(data) ? data : (data.regular || [])
    const next  = draws
      .filter(d => d.status === 'scheduled')
      .sort((a, b) => {
        const ta = a.scheduled_utc ? new Date(a.scheduled_utc) : a.draw_date ? new Date(a.draw_date + 'T' + a.draw_time + '+03:00') : new Date(a.scheduled_time)
        const tb = b.scheduled_utc ? new Date(b.scheduled_utc) : b.draw_date ? new Date(b.draw_date + 'T' + b.draw_time + '+03:00') : new Date(b.scheduled_time)
        return ta - tb
      })[0]
    if (!next) return null
    return next.scheduled_utc ? new Date(next.scheduled_utc)
      : next.draw_date
      ? new Date(next.draw_date + 'T' + next.draw_time + '+03:00')
      : next.scheduled_time ? new Date(next.scheduled_time) : null
  } catch { return null }
}

function showDrawInProgress() {
  // Show cards but overlay a waiting banner — don't fully block
  renderPlayerCard()
  const banner = document.getElementById('room-waiting-banner')
  if (banner) banner.classList.remove('hidden')
}

function hideWaitingBanner() {
  const banner = document.getElementById('room-waiting-banner')
  if (banner) banner.classList.add('hidden')
  document.getElementById('room-blocked').classList.add('hidden')
  document.querySelector('.room-layout').style.display = ''
}

function showWaitingPanel(nextDrawTime, nextDrawTitle) {
  clearInterval(_cdTimer)
  const panel      = document.getElementById('room-next-draw')
  const titleEl    = document.getElementById('rnd-title')
  const countEl    = document.getElementById('rnd-countdown')
  const calledEl2  = document.getElementById('called-numbers')
  if (!panel) return
  if (titleEl) titleEl.textContent = nextDrawTitle || 'Upcoming Draw'
  if (calledEl2) calledEl2.style.display = 'none'
  panel.classList.remove('hidden')
  statusTextEl.textContent = 'Waiting for draw'
  liveDot.className = 'live-dot'

  if (!nextDrawTime) {
    panel.classList.add('hidden')
    const overlay = document.getElementById('room-nodraw-overlay')
    if (overlay) overlay.classList.remove('hidden')
    return
  }
  document.getElementById('room-nodraw-overlay')?.classList.add('hidden')
  const target = new Date(nextDrawTime).getTime()
  function tick() {
    const diff = Math.max(0, target - Date.now())
    const h  = Math.floor(diff / 3_600_000)
    const m  = Math.floor((diff % 3_600_000) / 60_000)
    const s  = Math.floor((diff % 60_000) / 1_000)
    if (countEl) countEl.textContent = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }
  tick()
  _cdTimer = setInterval(tick, 1000)
}

function hideWaitingPanel() {
  clearInterval(_cdTimer)
  const panel     = document.getElementById('room-next-draw')
  const calledEl2 = document.getElementById('called-numbers')
  if (panel) panel.classList.add('hidden')
  if (calledEl2) calledEl2.style.display = ''
  document.getElementById('room-nodraw-overlay')?.classList.add('hidden')
}

// ── Viewport height fix ───────────────────────────────────────────────────
function setVh() {
  document.documentElement.style.setProperty('--real-vh', window.innerHeight + 'px')
}
setVh()
window.addEventListener('resize', setVh)

// ── Load player card from localStorage (shared across all portal tabs) ─
// Format: { cards: [{row1,row2,row3,code},...], drawTitle: "..." }
let playerCards = null
try {
  const raw = localStorage.getItem('bingoRoomTicket')
  if (raw) playerCards = JSON.parse(raw)
} catch {}

function renderPlayerCard() {
  if (!playerCards || !playerCards.cards?.length) {
    noTicketEl.classList.remove('hidden')
    cardGridEl.innerHTML = ''
    return
  }
  noTicketEl.classList.add('hidden')
  cardDrawEl.textContent = playerCards.drawTitle ?? ''
  cardGridEl.innerHTML = playerCards.cards.map((card, i) => {
    return buildCardTable(card)
  }).join('')
}

function buildCardTable(card) {
  const rows = [card.row1, card.row2, card.row3]
  const trs = rows.map((row, ri) => {
    const tds = row.map(n => {
      if (n === null) return `<td class="blank"></td>`
      const cls = calledSet.has(n) ? 'called' : 'num'
      return `<td class="${cls}" data-n="${n}">${n}</td>`
    }).join('')
    const codeCell = ri === 0
      ? `<td class="card-code-cell" rowspan="3">${card.code ?? ''}</td>`
      : ''
    return `<tr>${tds}${codeCell}</tr>`
  }).join('')
  return `<table class="room-card-grid-table">${trs}</table>`
}

function refreshCardMarks() {
  if (!playerCards) return
  document.querySelectorAll('.room-card-grid-table td[data-n]').forEach(td => {
    const n = Number(td.dataset.n)
    if (calledSet.has(n)) {
      td.className = 'called'
    }
  })
}

function checkWins() {
  if (!playerCards || bingoWon) return
  for (const card of playerCards.cards) {
    if (!lineWon) {
      const rows = [card.row1, card.row2, card.row3]
      for (let ri = 0; ri < rows.length; ri++) {
        const nums = rows[ri].filter(n => n !== null)
        if (nums.every(n => calledSet.has(n))) {
          lineWon = true
          _socket?.emit('line')
          runLineCheck(card, ri)
          return
        }
      }
    }
    const allNums = [...card.row1, ...card.row2, ...card.row3].filter(n => n !== null)
    if (allNums.every(n => calledSet.has(n))) {
      bingoWon = true
      _socket?.emit('bingo')
      runBingoCheck(card)
      return
    }
  }
}

function buildOverlayTable(card, winRowIdx) {
  const rows = [card.row1, card.row2, card.row3]
  const trs = rows.map((row, ri) => {
    const tds = row.map(n => {
      if (n === null) return `<td class="blank"></td>`
      if (ri === winRowIdx) return `<td class="num" data-n="${n}">${n}</td>`
      const cls = calledSet.has(n) ? 'called' : 'num'
      return `<td class="${cls}" data-n="${n}">${n}</td>`
    }).join('')
    const codeCell = ri === 0 ? `<td class="card-code-cell" rowspan="3">${card.code ?? ''}</td>` : ''
    return `<tr>${tds}${codeCell}</tr>`
  }).join('')
  return `<table class="room-card-grid-table overlay-card-table">${trs}</table>`
}

async function runLineCheck(card, rowIdx) {
  paused = true

  // ── Step 1: Flash "LINE!" over the drum ──────────────────────────────────
  const flash = document.createElement('div')
  flash.id = 'line-flash'
  flash.textContent = 'LINE!'
  document.body.appendChild(flash)

  await new Promise(r =>
    gsap.fromTo(flash,
      { opacity: 0, scale: 0.5 },
      { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.6)', onComplete: r }
    )
  )

  announcer.sayText('LINE!')
  await new Promise(r => setTimeout(r, 1600))

  await new Promise(r =>
    gsap.to(flash, { opacity: 0, scale: 1.25, duration: 0.3, ease: 'power2.in', onComplete: () => { flash.remove(); r() } })
  )

  // ── Step 2: Slide card overlay up over the drum ───────────────────────────
  const overlay = document.createElement('div')
  overlay.id = 'line-check-overlay'
  overlay.innerHTML =
    `<div class="lco-title">Checking your card…</div>` +
    buildOverlayTable(card, rowIdx)
  document.body.appendChild(overlay)

  gsap.fromTo(overlay,
    { opacity: 0, y: 40 },
    { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' }
  )

  await new Promise(r => setTimeout(r, 300))

  // ── Animate winning row cells in overlay ─────────────────────────────────
  const overlayRows  = overlay.querySelectorAll('.overlay-card-table tr')
  const overlayWinTds = [...overlayRows[rowIdx].querySelectorAll('td')]
    .filter(td => !td.classList.contains('blank') && !td.classList.contains('card-code-cell'))

  // Also mark the original right-panel cells
  const tables  = document.querySelectorAll('.room-card-grid-table')
  const cardIdx = playerCards.cards.indexOf(card)
  const origTds = tables[cardIdx]
    ? [...tables[cardIdx].querySelectorAll('tr')[rowIdx].querySelectorAll('td')]
        .filter(td => !td.classList.contains('blank'))
    : []

  for (let i = 0; i < overlayWinTds.length; i++) {
    overlayWinTds[i].classList.add('checking')
    await new Promise(r => setTimeout(r, 430))
    overlayWinTds[i].classList.remove('checking')
    overlayWinTds[i].className = 'line-win'
    if (origTds[i]) { origTds[i].classList.remove('checking'); origTds[i].className = 'line-win' }
  }

  // ── Show LINE! banner, then fade overlay out ─────────────────────────────
  await new Promise(r => setTimeout(r, 350))
  showWin('LINE!', 'line')

  await new Promise(r => setTimeout(r, 900))
  await new Promise(r =>
    gsap.to(overlay, { opacity: 0, y: -30, duration: 0.5, ease: 'power2.in', onComplete: r })
  )
  overlay.remove()

  // ── Announcer says "Continuing" then resume ──────────────────────────────
  announcer.sayText('Continuing.', () => { paused = false; drainPendingBalls() })
}

// ── Bingo check ceremony ──────────────────────────────────────────────────

function buildBingoOverlayTable(card) {
  const rows = [card.row1, card.row2, card.row3]
  const trs = rows.map((row, ri) => {
    const tds = row.map(n => {
      if (n === null) return `<td class="blank"></td>`
      return `<td class="num" data-n="${n}">${n}</td>`
    }).join('')
    const codeCell = ri === 0 ? `<td class="card-code-cell" rowspan="3">${card.code ?? ''}</td>` : ''
    return `<tr>${tds}${codeCell}</tr>`
  }).join('')
  return `<table class="room-card-grid-table overlay-card-table">${trs}</table>`
}

async function runBingoCheck(card) {
  paused = true
  announcer.reset()  // cancel any in-progress number call immediately

  // ── Step 1: BINGO! flash ─────────────────────────────────────────────────
  const flash = document.createElement('div')
  flash.id = 'line-flash'
  flash.classList.add('bingo-flash')
  flash.textContent = 'BINGO!'
  document.body.appendChild(flash)

  await new Promise(r =>
    gsap.fromTo(flash,
      { opacity: 0, scale: 0.5 },
      { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.6)', onComplete: r }
    )
  )
  announcer.sayText('BINGO!')
  await new Promise(r => setTimeout(r, 1800))
  await new Promise(r =>
    gsap.to(flash, { opacity: 0, scale: 1.3, duration: 0.3, ease: 'power2.in', onComplete: () => { flash.remove(); r() } })
  )

  // ── Step 2: Card overlay on drum ─────────────────────────────────────────
  const overlay = document.createElement('div')
  overlay.id = 'line-check-overlay'
  overlay.classList.add('bingo-overlay')
  overlay.innerHTML = `<div class="lco-title">Full house — checking card…</div>` + buildBingoOverlayTable(card)
  document.body.appendChild(overlay)

  gsap.fromTo(overlay,
    { opacity: 0, y: 40 },
    { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' }
  )
  await new Promise(r => setTimeout(r, 300))

  // ── Step 3: Check all 3 rows cell by cell ────────────────────────────────
  const cardIdx   = playerCards.cards.indexOf(card)
  const origTable = document.querySelectorAll('.room-card-grid-table')[cardIdx]
  const overlayRows = overlay.querySelectorAll('.overlay-card-table tr')

  // Ensure call card column is visible and any waiting panel is hidden
  calledEl.style.display = ''
  document.getElementById('room-next-draw')?.classList.add('hidden')

  for (let ri = 0; ri < 3; ri++) {
    const oTds = [...overlayRows[ri].querySelectorAll('td')]
      .filter(td => !td.classList.contains('blank') && !td.classList.contains('card-code-cell'))
    const rTds = origTable
      ? [...origTable.querySelectorAll('tr')[ri].querySelectorAll('td')]
          .filter(td => !td.classList.contains('blank') && !td.classList.contains('card-code-cell'))
      : []
    for (let i = 0; i < oTds.length; i++) {
      const num = Number(oTds[i].dataset.n)
      const ccCell = num ? document.querySelector(`.cc-cell[data-n="${num}"]`) : null

      // Force call card visible on every iteration in case something tried to hide it
      calledEl.style.display = ''

      oTds[i].classList.add('checking')
      if (ccCell) {
        ccCell.classList.remove('cc-bingo-checked')
        ccCell.classList.add('cc-bingo-highlight')  // pulse while being checked
      }

      await new Promise(r => setTimeout(r, 600))

      oTds[i].classList.remove('checking')
      oTds[i].className = 'bingo-win'
      if (rTds[i]) rTds[i].className = 'bingo-win'
      if (ccCell) {
        ccCell.classList.remove('cc-bingo-highlight')
        ccCell.classList.add('cc-bingo-checked')  // stays bright green permanently
      }
    }
  }

  // ── Step 4: Show banner, hold 10 s ───────────────────────────────────────
  await new Promise(r => setTimeout(r, 350))
  showWin('BINGO!', 'bingo')
  await new Promise(r => setTimeout(r, 10000))

  // ── Step 5: Congratulations speech ───────────────────────────────────────
  await new Promise(resolve => announcer.sayText('Congratulations to the winners!', resolve))
  await new Promise(r => setTimeout(r, 400))

  // ── Step 6: Fade out overlay ─────────────────────────────────────────────
  winBannerEl.classList.add('hidden')
  await new Promise(r =>
    gsap.to(overlay, { opacity: 0, y: -30, duration: 0.5, ease: 'power2.in', onComplete: () => { overlay.remove(); r() } })
  )

  tryShowDrawResults()
}

// ── Drain balls received during a ceremony pause ─────────────────────────
function drainPendingBalls() {
  if (!_pendingBalls.length) return
  const last = _pendingBalls[_pendingBalls.length - 1]
  calledSet = new Set(last.called)
  refreshCardMarks()
  _pendingBalls = []
  // Play the last missed ball with full tube animation + audio
  drawing = true
  drum.exitBall(
    last.number,
    (num, group, color) => {
      callCard.display(num)
      announcer.announce(num)
      gsap.fromTo(ballEl,
        { scale: 1.4, filter: `drop-shadow(0 0 28px ${color})` },
        { scale: 1,   filter: 'none', duration: 0.55, ease: 'elastic.out(1,0.5)' })
    },
    () => {
      drawing = false
      checkWins()
    }
  )
}

// ── Draw results card ─────────────────────────────────────────────────────

function showDrawResultsCard({ drawTitle, lineWinner, bingoWinner }) {
  const existing = document.getElementById('draw-results-card')
  if (existing) existing.remove()

  const card = document.createElement('div')
  card.id = 'draw-results-card'
  card.innerHTML = `
    <div class="drc-title">Draw Results</div>
    <div class="drc-draw">${drawTitle || 'Draw'}</div>
    <div class="drc-row"><span class="drc-label">Line</span><span class="drc-email">${lineWinner || '—'}</span></div>
    <div class="drc-row"><span class="drc-label">Bingo</span><span class="drc-email">${bingoWinner || '—'}</span></div>
  `
  document.body.appendChild(card)
  gsap.fromTo(card,
    { opacity: 0, y: 40 },
    { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }
  )
  // Auto-dismiss after 12 seconds, then return all users to the main page
  setTimeout(() => {
    gsap.to(card, { opacity: 0, y: -20, duration: 0.5, ease: 'power2.in',
      onComplete: () => {
        localStorage.removeItem('bingoRoomTicket')
        window.location.href = '/user-portal'
      }
    })
  }, 12000)
}

function tryShowDrawResults() {
  if (_drawResults) {
    showDrawResultsCard(_drawResults)
    _drawResults = null
  }
}

// Played on every client that did NOT win — shows the flash + checking overlay
async function runRemoteWinCeremony(type, amount) {
  paused = true

  const flash = document.createElement('div')
  flash.id = 'line-flash'
  if (type === 'bingo') flash.classList.add('bingo-flash')
  flash.textContent = type === 'bingo' ? 'BINGO!' : 'LINE!'
  document.body.appendChild(flash)

  await new Promise(r =>
    gsap.fromTo(flash,
      { opacity: 0, scale: 0.5 },
      { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.6)', onComplete: r }
    )
  )
  announcer.sayText(type === 'bingo' ? 'BINGO!' : 'LINE!')
  await new Promise(r => setTimeout(r, 1800))
  await new Promise(r =>
    gsap.to(flash, { opacity: 0, scale: 1.25, duration: 0.3, ease: 'power2.in',
      onComplete: () => { flash.remove(); r() } })
  )

  const prizeText = amount > 0 ? ` — ${amount} pts` : ''
  const overlay = document.createElement('div')
  overlay.id = 'line-check-overlay'
  if (type === 'bingo') overlay.classList.add('bingo-overlay')
  overlay.innerHTML = `<div class="lco-title">${type === 'bingo' ? 'Full house' : 'Line won'}${prizeText}<br>Checking winner's card…</div>`
  document.body.appendChild(overlay)

  gsap.fromTo(overlay, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' })

  const holdMs = type === 'bingo' ? 9000 : 3500
  await new Promise(r => setTimeout(r, holdMs))

  showWin(type === 'bingo'
    ? (amount > 0 ? `BINGO! +${amount} pts` : 'BINGO!')
    : (amount > 0 ? `LINE! +${amount} pts` : 'LINE!'), type)

  await new Promise(r => setTimeout(r, 1200))
  await new Promise(r =>
    gsap.to(overlay, { opacity: 0, y: -30, duration: 0.5, ease: 'power2.in',
      onComplete: () => { overlay.remove(); r() } })
  )

  if (type === 'line') announcer.sayText('Continuing.', () => { paused = false; drainPendingBalls() })
  else { paused = false; drainPendingBalls(); tryShowDrawResults() }
}

function showNextDrawCountdown(seconds) {
  const el = document.createElement('div')
  el.id = 'bingo-next-draw'
  el.innerHTML = `
    <div class="bnd-label">NEXT DRAW IN</div>
    <div class="bnd-num" id="bnd-num">${seconds}</div>
    <div class="bnd-sublabel">seconds</div>
  `
  document.body.appendChild(el)
  gsap.fromTo(el, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.55, ease: 'back.out(1.4)' })

  let remaining = seconds
  const tick = setInterval(() => {
    remaining--
    const numEl = document.getElementById('bnd-num')
    if (numEl) {
      numEl.textContent = remaining
      gsap.fromTo(numEl, { scale: 1.25, color: '#c4b5fd' }, { scale: 1, color: '#a78bfa', duration: 0.35, ease: 'back.out' })
    }
    if (remaining <= 0) {
      clearInterval(tick)
      gsap.to(el, { opacity: 0, scale: 0.9, duration: 0.5, onComplete: () => {
        el.remove()
        _socket?.emit('reset')
      }})
    }
  }, 1000)
}

function highlightRow(card, rowIdx, cls) {
  const tables = document.querySelectorAll('.room-card-grid-table')
  const cardIdx = playerCards.cards.indexOf(card)
  const table = tables[cardIdx]
  if (!table) return
  const rows = table.querySelectorAll('tr')
  if (rowIdx === -1) {
    rows.forEach(r => r.querySelectorAll('td').forEach(td => { if (!td.classList.contains('blank')) td.className = cls }))
  } else {
    rows[rowIdx]?.querySelectorAll('td').forEach(td => { if (!td.classList.contains('blank')) td.className = cls })
  }
}

function showWin(text, type) {
  winBannerEl.textContent = text
  winBannerEl.className   = `room-win-banner ${type}`
  winBannerEl.classList.remove('hidden')
}

// ── Orientation lock (Android Chrome); CSS overlay handles iOS fallback ──
;(async () => {
  try {
    if (screen.orientation?.lock) await screen.orientation.lock('landscape')
  } catch (_) { /* iOS/unsupported — rotate overlay shown via CSS */ }
})()

// ── Boot drum ─────────────────────────────────────────────────────────────
setTimeout(() => {
  drum.init(Array.from({ length: 90 }, (_, i) => i + 1))
  renderPlayerCard()
  connectSocket()
}, 500)

// ── Socket.io ─────────────────────────────────────────────────────────────
function connectSocket() {
  const socket = io({ transports: ['websocket', 'polling'] })
  _socket = socket

  socket.on('connect', () => {
    liveDot.className = 'live-dot on'
    statusTextEl.textContent = 'Live'
  })
  socket.on('disconnect', () => {
    liveDot.className = 'live-dot off'
    statusTextEl.textContent = 'Reconnecting…'
  })

  // Initial state on connect
  socket.on('state', ({ called, gameOver, phase, nextDrawTime, nextDrawTitle, announcer: annType }) => {
    calledSet = new Set(called)
    if (phase === 'waiting') {
      _nextDrawTitle = nextDrawTitle || 'this draw'
      if (annType) announcer.setType(annType)
      renderPlayerCard()
      showWaitingPanel(nextDrawTime, nextDrawTitle)
      return
    }
    // phase === 'drawing'
    if (called.length > 0 && !gameOver) {
      showDrawInProgress()
      return
    }
    refreshCardMarks()
    checkWins()
    if (gameOver) statusTextEl.textContent = 'Draw ended'
  })

  // Server signals waiting for next draw
  socket.on('waiting', ({ nextDrawTime, nextDrawTitle, announcer: annType }) => {
    _nextDrawTitle = nextDrawTitle || 'this draw'
    _introPlayed   = false        // allow intro for the new draw
    if (annType) announcer.setType(annType)
    gsap.to(announcer._el, { opacity: 0, duration: 0.5 })  // hide announcer between draws
    renderPlayerCard()
    showWaitingPanel(nextDrawTime, nextDrawTitle)
    drum.reset(Array.from({ length: 90 }, (_, i) => i + 1))
  })

  // Countdown tick — update fill bar; trigger announcer intro at T-3s
  socket.on('countdown', ({ remaining, total }) => {
    const pct = remaining / total
    if (countdownFill) countdownFill.style.width = (pct * 100) + '%'

    if (remaining <= 3 && !_introPlayed) {
      _introPlayed = true
      paused = true   // queue any balls the server sends during the intro

      // Fade out the countdown panel
      const panel = document.getElementById('room-next-draw')
      if (panel && !panel.classList.contains('hidden')) {
        gsap.to(panel, {
          opacity: 0, duration: 0.4,
          onComplete: () => { panel.classList.add('hidden'); panel.style.opacity = '' }
        })
      }

      // Fade in announcer (opacity only — idle y-float already running)
      gsap.to(announcer._el, {
        opacity: 1, duration: 0.8, ease: 'power2.out',
        onComplete: () => {
          const title = _nextDrawTitle || 'this draw'
          announcer.sayText(
            `Welcome to ${title}, I will be calling for you. Let's start!`,
            () => { paused = false; drainPendingBalls() }
          )
        }
      })
    }
  })

  // A number is drawn — animate ball
  socket.on('number-drawn', ({ number, called }) => {
    if (paused) { _pendingBalls.push({ number, called }); return }
    if (drawing) return
    drawing   = true
    calledSet = new Set(called)
    if (lastNumEl) lastNumEl.textContent = number
    if (countdownFill) countdownFill.style.width = '100%'

    drum.exitBall(
      number,
      // onReveal — ball reaches tube peak
      (num, group, color) => {
        callCard.display(num)
        if (!paused) announcer.announce(num)
        gsap.fromTo(ballEl,
          { scale: 1.4, filter: `drop-shadow(0 0 28px ${color})` },
          { scale: 1,   filter: 'none', duration: 0.55, ease: 'elastic.out(1,0.5)' })
      },
      // onSettle — ball at rest
      () => {
        refreshCardMarks()
        if (!paused) checkWins()
        drawing = false
      }
    )
  })

  socket.on('game-over', () => {
    statusTextEl.textContent = 'Draw complete'
    if (countdownFill) countdownFill.style.width = '0'
  })

  socket.on('draw-results', (data) => {
    _drawResults = data
    // Clients with no ceremony (no ticket or spectators) show results after a short delay
    if (!playerCards?.cards?.length) {
      setTimeout(() => tryShowDrawResults(), 3000)
    }
  })

  // Broadcast prize announcements to ALL connected clients
  socket.on('prize-awarded', ({ type, amount }) => {
    if (type === 'line') {
      lineWon = true   // stop every client from triggering a second line
      // Local ceremony already running on the winner — show remote version on everyone else
      // Guard: skip if this client is already running its own ceremony (overlay present)
      if (!document.getElementById('line-flash') && !document.getElementById('line-check-overlay')) {
        runRemoteWinCeremony('line', amount)
      }
    } else if (type === 'bingo') {
      bingoWon = true
      if (!document.getElementById('line-flash') && !document.getElementById('line-check-overlay')) {
        runRemoteWinCeremony('bingo', amount)
      }
    }
  })

  socket.on('game-reset', () => {
    calledSet  = new Set()
    lineWon    = false
    bingoWon   = false
    drawing    = false
    paused     = false
    _drawResults  = null
    _pendingBalls = []
    _introPlayed  = false   // new draw cycle — allow intro at T-3s
    winBannerEl.classList.add('hidden')
    if (lastNumEl) lastNumEl.textContent = '—'
    // Clear any lingering bingo-check highlights on the call card
    document.querySelectorAll('.cc-bingo-checked, .cc-bingo-highlight').forEach(el => {
      el.classList.remove('cc-bingo-checked', 'cc-bingo-highlight')
    })
    callCard.reset()
    hideWaitingBanner()
    hideWaitingPanel()
    statusTextEl.textContent = 'Draw starting…'
    renderPlayerCard()
    drum.reset(Array.from({ length: 90 }, (_, i) => i + 1))
    // Fade announcer out — intro will bring her back at T-3s of new countdown
    gsap.to(announcer._el, { opacity: 0, duration: 0.5 })
  })
}
