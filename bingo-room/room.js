import { gsap }          from 'gsap'
import { DrumPhysics3D } from '/bingo-room/DrumPhysics3D.js'
import { CallCard }      from '/bingo-room/CallCard.js'
import { Announcer }     from '/bingo-room/Announcer.js?v=7'
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
let _pendingLineCard = null // set when client detects a line; cleared by prize-awarded
let _introPlayed   = false  // prevents intro replaying within same draw cycle
let _nextDrawTitle = ''     // stored from 'waiting'/'state' for intro speech
let _curtainFaded  = false  // guards the 00:00 curtain lift — reset each waiting cycle
let _wasWatchingDrawId = sessionStorage.getItem('bingo_watching_draw') || null  // survives page nav within session
function _setWatchingDraw(id) {
  _wasWatchingDrawId = id ? String(id) : null
  if (id) sessionStorage.setItem('bingo_watching_draw', String(id))
  else     sessionStorage.removeItem('bingo_watching_draw')
}
let _lateEntry = false  // true when user is blocked (late, no ticket) — suppresses curtain-lift logic
let _ceremonyActive = false // true while a bingo check ceremony is running; blocks waiting curtain
let _firstBallCalled = false  // gates the walk-in zoom — fires once per draw
let _announcerZoomed = false  // true while announcer is at zoom scale
let _serverTicketCheckPending = false  // true while _refreshCardsFromServer is in flight
let _pendingWaiting = null             // 'waiting' payload stored during a bingo ceremony
let _gameOverAt     = 0               // timestamp of last game-over — used to guard waiting curtain

const _token = localStorage.getItem('bp_token') || ''
const _previewMode = new URLSearchParams(location.search).has('preview')

// Decode user_id from the JWT payload (no signature verify needed — server owns that)
function _decodeJwtPayload(token) {
  try { return JSON.parse(atob(token.split('.')[1])) } catch { return null }
}
const _myUserId = _token ? (_decodeJwtPayload(_token)?.user_id ?? null) : null

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

// Apply a deferred 'waiting' payload — called either directly from the socket handler
// (no ceremony running) or by ceremony-end code after _pendingWaiting was stored.
function _applyWaiting({ drawId, nextDrawTime, nextDrawTitle, annType }) {
  _nextDrawTitle      = nextDrawTitle || 'this draw'
  _setWatchingDraw(drawId)       // mark that this user is in the room for this draw's start
  _lateEntry          = false    // new draw waiting phase — reset late-entry flag
  _introPlayed        = false
  _curtainFaded       = false
  _firstBallCalled    = false
  if (_announcerZoomed) {
    _announcerZoomed = false
    gsap.set(announcer._el, { scale: 1, transformOrigin: 'center bottom' })
  }
  announcer.disableIdlePause()
  loadCardsForDraw(drawId)
  drum.reset(Array.from({ length: 90 }, (_, i) => i + 1))
  if (annType) { announcer.setType(annType); updateStageScale() }
  if (!_previewMode) gsap.to(announcer._el, { opacity: 0, duration: 0.5 })
  renderPlayerCard()
  showWaitingPanel(nextDrawTime, nextDrawTitle)
}

function showDrawInProgress(nextDrawTime, nextDrawTitle) {
  // Cover the room with the curtain — user arrived mid-draw, show next draw info
  const blocked = document.getElementById('room-blocked')
  if (blocked) {
    const inner = blocked.querySelector('.room-blocked-inner')
    if (inner) {
      const nextTime = nextDrawTime
        ? new Date(nextDrawTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null
      inner.innerHTML = `
        <img src="/bingo-room/bm.png" alt="" style="width:120px;height:auto;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">
        <h2 class="room-blocked-title">Draw in Progress</h2>
        <p class="room-blocked-msg">This draw is underway.<br>Please wait for the next one.</p>
        ${nextDrawTitle || nextTime ? `<div class="room-blocked-next"><span class="rbn-label">${nextDrawTitle || 'Next draw'}</span><span class="rbn-time">${nextTime || '—'}</span></div>` : ''}
        <a href="/user-portal" class="room-blocked-btn" style="margin-top:16px">← Back to Portal</a>
      `
    }
    blocked.style.opacity = '1'
    blocked.classList.remove('hidden')
  }
  // CRITICAL: mark curtain as "intentionally shown for mid-draw block".
  // Without this, the ball-interval countdown handler (remaining <= 0) would
  // immediately lift the curtain because _curtainFaded is false on fresh page load.
  _curtainFaded = true
  renderPlayerCard()
}

function hideWaitingBanner() {
  const banner = document.getElementById('room-waiting-banner')
  if (banner) banner.classList.add('hidden')
  // NOTE: do NOT hide room-blocked here — the countdown T=0 handler lifts
  // the curtain via gsap fade-out so the announcer appears cleanly after it.
  document.querySelector('.room-layout').style.display = ''
}

function showWaitingPanel(nextDrawTime, nextDrawTitle) {
  if (_previewMode) return  // preview mode — never block the stage view
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
    document.getElementById('room-nodraw-overlay')?.classList.add('hidden')
    // No next draw — show the full blocking curtain with a clear message.
    // This keeps the room hidden (nothing to see) and gives the user a back button.
    const blocked2 = document.getElementById('room-blocked')
    if (blocked2) {
      const inner2 = blocked2.querySelector('.room-blocked-inner')
      if (inner2) {
        inner2.innerHTML = `
          <img src="/bingo-room/bm.png" alt="" style="width:120px;height:auto;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">
          <h2 class="room-blocked-title">No Draws Scheduled</h2>
          <p class="room-blocked-msg">There are no upcoming draws at the moment.<br>Check back soon!</p>
          <a href="/user-portal" class="room-blocked-btn" style="margin-top:16px">← Back to Portal</a>
        `
      }
      blocked2.style.opacity = '1'
      blocked2.classList.remove('hidden')
    }
    return
  }
  document.getElementById('room-nodraw-overlay')?.classList.add('hidden')

  // ── Draw the curtain while waiting for the next draw to start ────────────
  const blocked = document.getElementById('room-blocked')
  if (blocked) {
    const inner = blocked.querySelector('.room-blocked-inner')
    if (inner) {
      inner.innerHTML = `
        <img src="/bingo-room/bm.png" alt="" style="width:140px;height:auto;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">
        <h2 class="room-blocked-title">${nextDrawTitle || 'Upcoming Draw'}</h2>
        <p class="room-blocked-msg" style="margin-bottom:4px">Starting in</p>
        <div id="curtain-countdown-display" style="font-size:64px;font-weight:900;color:#a78bfa;letter-spacing:-.02em;line-height:1;margin:10px 0 6px;font-variant-numeric:tabular-nums;">--:--</div>
      `
    }
    blocked.style.opacity = '1'
    blocked.classList.remove('hidden')
  }

  const target = new Date(nextDrawTime).getTime()
  function tick() {
    const diff = Math.max(0, target - Date.now())
    const h  = Math.floor(diff / 3_600_000)
    const m  = Math.floor((diff % 3_600_000) / 60_000)
    const s  = Math.floor((diff % 60_000) / 1_000)
    const timeStr = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    if (countEl) countEl.textContent = timeStr
    // Also drive the on-curtain countdown, but hand off to the server's
    // per-ball countdown events in the final 10 s.  Beyond 10 s the client
    // clock is accurate enough; within 10 s the server's 'countdown' events
    // take over and "DRAW STARTING!" fires at remaining≤3 — avoiding any
    // clock-skew jump-back artefact.
    if (!_introPlayed && diff > 10_000) {
      const ccEl2 = document.getElementById('curtain-countdown-display')
      if (ccEl2) ccEl2.textContent = timeStr
    }
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

// ── Stage scaling: fit the 580×460 machine into whatever screen is available ─
// The machine uses transform:scale(--stage-scale); we compensate the announcer
// position via JS because it lives in body (outside the machine stacking context).
function _announcerNaturalPos() {
  if (!announcer?._el) return null
  // Per-type natural position/size. ox/oy are offsets from the machine bounding rect.
  // side: 'right' → pinned to drum-col right edge (avoids call-card overlap)
  //       'left'  → ox from machine left edge
  const POS = {
    a: { side: 'right', ox: 836, oy: 150, w: 200, h: 340, dx:   0 },
    b: { side: 'right', ox: 836, oy:  90, w: 170, h: 289, dx:   0, ms: 1.00 },  // compact size, same on mobile+desktop
    c: { side: 'right', ox: 836, oy: 150, w: 200, h: 340, dx:   0 },
    d: { side: 'right', ox: 836, oy: 150, w: 200, h: 340, dx: -20 },
    e: { side: 'right', ox: 836, oy: 110, w: 200, h: 340, dx:   0, ms: 0.80 },  // raised 40px
    f: { side: 'right', ox: 836, oy: 150, w: 200, h: 340, dx:   0, ms: 0.80 },
    g: { side: 'right', ox: 836, oy: 150, w: 200, h: 340, dx:   0, ms: 0.80 },
  }
  return POS[announcer._type] ?? POS.a
}

// ── Announcer positioning ─────────────────────────────────────────────────
// Extracted so it can be called from both updateStageScale() and the scroll
// listener. The announcer is position:fixed so its viewport coords must be
// re-derived whenever the machine moves (resize OR scroll on mobile).
function _positionAnnouncer(scale) {
  const np = _announcerNaturalPos()
  if (!np || !announcer?._el) return
  const machine = document.getElementById('lottery-machine')
  const drumCol = document.querySelector('.room-drum-col')
  if (!machine || !drumCol) return

  const mRect   = machine.getBoundingClientRect()
  const colRect = drumCol.getBoundingClientRect()
  const el      = announcer._el
  const isLeft  = np.side === 'left'
  const ms      = (scale < 0.95 && np.ms) ? np.ms : 1
  const annW    = Math.round(np.w * scale * ms)
  const annH    = Math.round(np.h * scale * ms)
  const dx      = np.dx ?? 0

  if (scale >= 0.95) {
    // Desktop — use natural unscaled sizes; position in viewport coordinates
    const desktopTop = Math.round(mRect.top + np.oy) + 'px'
    if (isLeft) {
      el.style.left   = Math.round(mRect.left + np.ox + dx) + 'px'
      el.style.top    = desktopTop
      el.style.width  = np.w + 'px'
      el.style.height = np.h + 'px'
    } else {
      // Right-side: pin to drum column's right edge (avoids call-card overlap)
      el.style.left   = Math.round(colRect.right - np.w - 16 + dx) + 'px'
      el.style.top    = desktopTop
      el.style.width  = np.w + 'px'
      el.style.height = np.h + 'px'
    }
  } else {
    // Mobile — scale relative to machine rect
    if (isLeft) {
      el.style.left = Math.round(mRect.left + np.ox * scale + dx * scale) + 'px'
      el.style.top  = Math.round(mRect.top  + np.oy * scale) + 'px'
    } else {
      // Right-side: feet near machine base, clamped to viewport
      el.style.left = Math.round(mRect.right + 4 + dx * scale) + 'px'
      el.style.top  = Math.round(Math.min(
        mRect.bottom - annH * 1.1,
        window.innerHeight - annH - 4
      )) + 'px'
    }
    el.style.width  = annW + 'px'
    el.style.height = annH + 'px'
  }
}

function updateStageScale() {
  const drumCol = document.querySelector('.room-drum-col')
  const machine = document.getElementById('lottery-machine')
  const scaler  = machine?.parentElement   // .machine-scaler
  if (!drumCol || !machine || !scaler) return

  // Scale constrained by available width AND height (minus 52px topbar)
  const availW = drumCol.clientWidth
  const availH = Math.max(1, window.innerHeight - 52)
  const scale  = Math.max(0.3, Math.min(1, availW / 580, availH / 460))

  document.documentElement.style.setProperty('--stage-scale', scale)
  scaler.style.width  = Math.round(580 * scale) + 'px'
  scaler.style.height = Math.round(460 * scale) + 'px'
  scaler.style.marginLeft = ''

  // Reposition the announcer after layout settles (position:fixed, viewport coords)
  requestAnimationFrame(() => _positionAnnouncer(scale))
}

// On mobile the machine scrolls with page content; re-pin the announcer
// (position:fixed) on every scroll tick so she tracks the machine.
// Throttled to one rAF per scroll event to avoid layout thrashing.
let _scrollRafId = null
window.addEventListener('scroll', () => {
  if (_scrollRafId) return
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null
    const scale = parseFloat(
      document.documentElement.style.getPropertyValue('--stage-scale')
    ) || 1
    if (scale < 0.95) _positionAnnouncer(scale)
  })
}, { passive: true })

updateStageScale()

// ── Preview mode: show the full stage without needing an active draw ──────
// Visit /bingo-room?preview to see the layout (announcer, machine, call card)
if (_previewMode) {
  document.getElementById('room-blocked')?.classList.add('hidden')
  document.getElementById('room-nodraw-overlay')?.classList.add('hidden')
  document.querySelector('.room-layout')?.style.setProperty('display', '')
  announcer._el.style.setProperty('opacity', '1', 'important')
  announcer.setType(new URLSearchParams(location.search).get('ann') || localStorage.getItem('bp_ann_type') || 'a')
  updateStageScale()
  // Seek the announcer video to the idle-pose frame (mic down, standing)
  // so the keying loop has a visible frame to display rather than black.
  const _seekPreviewIdle = () => {
    const v = announcer._video
    if (!v) return
    const doSeek = () => { v.loop = false; v.currentTime = 4.5; v.addEventListener('seeked', () => v.pause(), { once: true }) }
    if (v.readyState >= 1) doSeek()
    else v.addEventListener('loadedmetadata', doSeek, { once: true })
  }
  _seekPreviewIdle()
  setTimeout(_seekPreviewIdle, 600)   // retry once in case video element wasn't ready
}

// ── Announcer zoom helpers ────────────────────────────────────────────────
// Called once on first ball: cinematic zoom in, then freeze video at standing frame
function _zoomAnnouncerIn() {
  if (_announcerZoomed) return
  _announcerZoomed = true
  gsap.to(announcer._el, {
    scale: 1.45,
    transformOrigin: 'center bottom',
    duration: 1.5,
    ease: 'power2.inOut',
    onComplete: () => announcer.enableIdlePause()
  })
}

// Called on bingo congrats: zoom back to natural size (video already looping)
function _zoomAnnouncerOut() {
  _announcerZoomed = false
  announcer.disableIdlePause()   // let video loop freely during congratulations walk
  return gsap.to(announcer._el, {
    scale: 1,
    transformOrigin: 'center bottom',
    duration: 1.5,
    ease: 'power2.inOut'
  })
}

// On iOS Safari, scrolling causes the address bar to show/hide which fires 'resize'
// with only a small innerHeight change and NO innerWidth change. That would reposition
// the announcer based on scroll-adjusted mRect.top, making her appear to scroll.
// Fix: only reposition on genuine resizes (viewport width changes, or height changes a lot).
let _lastResizeW = window.innerWidth
let _lastResizeH = window.innerHeight
window.addEventListener('resize', () => {
  setVh()
  const dW = Math.abs(window.innerWidth  - _lastResizeW)
  const dH = Math.abs(window.innerHeight - _lastResizeH)
  _lastResizeW = window.innerWidth
  _lastResizeH = window.innerHeight
  // iOS scroll fires a resize with dW=0, dH≈50. Genuine resize has dW>0 or large dH.
  if (dW > 0 || dH > 80) updateStageScale()
})

// ── Load player cards from localStorage for a specific draw ──────────────
// New format (bingoRoomTickets): { [drawId]: { cards, drawTitle } }
// Legacy format (bingoRoomTicket): { cards, draw_id, drawTitle }
let playerCards = null   // set by loadCardsForDraw() once we know the draw_id
let _currentDrawId = null

function loadCardsForDraw(drawId) {
  _currentDrawId = drawId
  if (!drawId) { playerCards = null; return }
  const key = String(drawId)
  try {
    // New per-draw store (preferred)
    const store = JSON.parse(localStorage.getItem('bingoRoomTickets') || '{}')
    if (store[key]?.cards?.length) {
      playerCards = store[key]
      return
    }
    // Legacy single-draw store — only use if draw_id matches
    const legacy = JSON.parse(localStorage.getItem('bingoRoomTicket') || '{}')
    if (String(legacy.draw_id) === key && legacy.cards?.length) {
      playerCards = legacy
      return
    }
  } catch {}
  playerCards = null
  // Nothing in localStorage — ticket may have been bought on another device or
  // localStorage was cleared. Fetch from server; show neutral "checking" state
  // until the answer comes back so we never flash a false "no ticket" message.
  _serverTicketCheckPending = true
  _refreshCardsFromServer(drawId)
}

// Cross-tab update: when the user buys tickets in the portal tab while the
// bingo room is already open, the portal writes to localStorage and the browser
// fires a 'storage' event in this tab.  Pick it up and show the cards immediately
// without waiting for the next socket event.
window.addEventListener('storage', (e) => {
  if (e.key !== 'bingoRoomTickets') return
  if (!_currentDrawId) return
  // Already have cards — nothing to update
  if (playerCards?.cards?.length) return
  try {
    const store = JSON.parse(e.newValue || '{}')
    const key   = String(_currentDrawId)
    if (!store[key]?.cards?.length) return
    playerCards = store[key]
    _serverTicketCheckPending = false
    renderPlayerCard()
    refreshCardMarks()
    // If a draw is already underway and the curtain is up, lift it now
    const blocked   = document.getElementById('room-blocked')
    const isBlocked = blocked && !blocked.classList.contains('hidden')
    if (isBlocked && calledSet.size > 0) _enterMidDraw(calledSet.size)
  } catch {}
})

async function _refreshCardsFromServer(drawId) {
  // Helper: clear pending flag and re-render if we're still on the same draw
  const _done = () => {
    if (String(_currentDrawId) !== String(drawId)) return
    _serverTicketCheckPending = false
    renderPlayerCard()
  }
  try {
    const headers = _token ? { Authorization: 'Bearer ' + _token } : {}
    const res = await fetch('/api/user-portal/tickets', { headers })
    if (!res.ok) { _done(); return }
    const tickets = await res.json()
    // Filter tickets for this specific draw
    const drawTickets = tickets.filter(t => String(t.draw_id) === String(drawId))
    if (!drawTickets.length) { _done(); return }
    // Build flat card list — preset tickets store card objects with row1/row2/row3
    const allCards = []
    let drawTitle = ''
    for (const t of drawTickets) {
      try {
        const raw = t.numbers
        // numbers may arrive as a string (DB column) or already-parsed object (some API paths)
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (Array.isArray(parsed) && parsed.length && parsed[0]?.row1) {
          allCards.push(...parsed)
        }
      } catch {}
      if (!drawTitle && t.draw_title) drawTitle = t.draw_title
    }
    if (!allCards.length) { _done(); return }
    // Guard against race: ensure we're still on the same draw
    if (String(_currentDrawId) !== String(drawId)) return
    const data = { cards: allCards, drawTitle }
    // Cache in localStorage for this draw
    try {
      const store = JSON.parse(localStorage.getItem('bingoRoomTickets') || '{}')
      store[String(drawId)] = data
      localStorage.setItem('bingoRoomTickets', JSON.stringify(store))
    } catch {}
    playerCards = data
    _serverTicketCheckPending = false
    if (calledSet.size > 0) {
      // Draw is in progress — switch from next-draw panel to live view
      _enterMidDraw(calledSet.size)
    } else {
      // Draw not active yet — just render the ticket normally
      renderPlayerCard()
      refreshCardMarks()
    }
  } catch { _done() }
}

function renderPlayerCard() {
  if (!playerCards || !playerCards.cards?.length) {
    if (_serverTicketCheckPending) {
      // Server check still in flight — show neutral state, not "no ticket"
      noTicketEl.innerHTML =
        '<div class="room-no-ticket-icon">🎟️</div>' +
        '<p style="color:var(--muted,#aaa);font-size:14px">Looking for your tickets…</p>'
    } else {
      noTicketEl.innerHTML =
        '<div class="room-no-ticket-icon">🎟️</div>' +
        '<p>You don\'t have a ticket for the current draw.</p>' +
        '<a href="/user-portal" class="btn-room-buy">Buy Tickets →</a>'
    }
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
          paused = true   // pause immediately; ceremony starts once prize-awarded confirms winner
          _socket?.emit('line')
          _pendingLineCard = { card, rowIdx: ri }  // ceremony deferred — see prize-awarded handler
          // Safety: if prize-awarded never arrives (server race / no response), unfreeze after 7s
          setTimeout(() => {
            if (_pendingLineCard) {
              console.warn('[bingo] prize-awarded timeout — resuming draw')
              _pendingLineCard = null
              paused = false
              drainPendingBalls()
            }
          }, 7000)
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
  // Safety: no matter what crashes inside, always unfreeze after 30s
  const _safetyTimer = setTimeout(() => {
    if (paused) {
      console.warn('[bingo] runLineCheck safety timeout — forcing resume')
      paused = false; drainPendingBalls()
    }
  }, 30000)

  try {
  gsap.to(announcer._el, { opacity: 0, duration: 0.25 })  // hide announcer so it doesn't show over overlay

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
  // Fade her back in — she was hidden at ceremony start so the overlay was unobstructed
  gsap.to(announcer._el, { opacity: 1, duration: 0.4, ease: 'power2.out' })
  announcer.sayText('Continuing.', () => {
    clearTimeout(_safetyTimer)
    paused = false
    drainPendingBalls()
  })
  } catch(err) {
    console.error('[bingo] runLineCheck error — forcing resume:', err)
    clearTimeout(_safetyTimer)
    paused = false
    drainPendingBalls()
  }
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
  _ceremonyActive = true   // block the 'waiting' curtain during this ceremony
  const _ownDrawId = _currentDrawId  // capture now — 'waiting' event may update it during ceremony
  paused = true
  announcer.reset()  // cancel any in-progress number call immediately
  gsap.to(announcer._el, { opacity: 0, duration: 0.25 })  // hide announcer so it doesn't show over overlay

  // Safety: if anything inside throws, still close out the ceremony
  const _safetyTimer = setTimeout(() => {
    console.warn('[bingo] runBingoCheck safety timeout — forcing ceremony end')
    _ceremonyActive = false
    tryShowDrawResults(_ownDrawId)
  }, 45000)

  try {

  // ── Step 1: BINGO! flash — wait for speech before moving on ─────────────
  const flash = document.createElement('div')
  flash.id = 'line-flash'
  flash.classList.add('bingo-flash')
  flash.textContent = 'BINGO!'
  document.body.appendChild(flash)

  // Animate flash in, then await the speech — flash holds until she finishes
  await new Promise(r =>
    gsap.fromTo(flash,
      { opacity: 0, scale: 0.5 },
      { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.6)', onComplete: r }
    )
  )
  // Wait for "BINGO!" speech to fully complete before overlay appears
  await new Promise(resolve => announcer.sayText('BINGO!', resolve))
  await new Promise(r => setTimeout(r, 300))   // brief pause after speech
  await new Promise(r =>
    gsap.to(flash, { opacity: 0, scale: 1.3, duration: 0.3, ease: 'power2.in', onComplete: () => { flash.remove(); r() } })
  )

  // ── Step 2: Card overlay on drum ─────────────────────────────────────────
  const overlay = document.createElement('div')
  overlay.id = 'line-check-overlay'
  overlay.classList.add('bingo-overlay')
  overlay.innerHTML = `<div class="lco-title">Full house — checking card…</div>` + buildBingoOverlayTable(card)
  document.body.appendChild(overlay)

  await new Promise(r =>
    gsap.fromTo(overlay,
      { opacity: 0, y: 40 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', onComplete: r }
    )
  )
  await new Promise(r => setTimeout(r, 300))

  // ── Step 3: Check all 3 rows cell by cell (silent — no speech during check) ─
  const cardIdx   = playerCards.cards.indexOf(card)
  const origTable = document.querySelectorAll('.room-card-grid-table')[cardIdx]
  const overlayRows = overlay.querySelectorAll('.overlay-card-table tr')

  // Ensure call card column is visible and any waiting panel is hidden
  calledEl.style.display = ''
  document.getElementById('room-next-draw')?.classList.add('hidden')

  // Build per-row td arrays including blank cells so column index stays aligned.
  // Card-code-cell (rowspan=3 at end) is excluded; blank cells are kept for alignment.
  const allORows = []
  const allRRows = []
  for (let ri = 0; ri < 3; ri++) {
    allORows.push([...overlayRows[ri].querySelectorAll('td')]
      .filter(td => !td.classList.contains('card-code-cell')))
    allRRows.push(origTable
      ? [...origTable.querySelectorAll('tr')[ri].querySelectorAll('td')]
          .filter(td => !td.classList.contains('card-code-cell'))
      : [])
  }
  const numCols = allORows[0].length  // 9 columns on a 90-ball card

  // Column-major sweep: column 0 top→bottom, column 1 top→bottom, …
  for (let ci = 0; ci < numCols; ci++) {
    for (let ri = 0; ri < 3; ri++) {
      const oTd = allORows[ri][ci]
      const rTd = allRRows[ri]?.[ci]
      if (!oTd || oTd.classList.contains('blank')) continue   // blank cell — skip

      const num = Number(oTd.dataset.n)
      const ccCell = num ? document.querySelector(`.cc-cell[data-n="${num}"]`) : null

      calledEl.style.display = ''   // keep call card visible throughout

      oTd.classList.add('checking')
      if (ccCell) {
        ccCell.classList.remove('cc-bingo-checked')
        ccCell.classList.add('cc-bingo-highlight')
      }

      await new Promise(r => setTimeout(r, 600))

      oTd.classList.remove('checking')
      oTd.className = 'bingo-win'
      if (rTd && !rTd.classList.contains('blank')) rTd.className = 'bingo-win'
      if (ccCell) {
        ccCell.classList.remove('cc-bingo-highlight')
        ccCell.classList.add('cc-bingo-checked')
      }
    }
  }

  // ── Step 4: Show BINGO! banner — hold 5 s with ALL overlays still visible ─
  await new Promise(r => setTimeout(r, 350))
  showWin('BINGO!', 'bingo')
  await new Promise(r => setTimeout(r, 5000))

  // ── Step 5: Fade out overlay AND banner together — clean simultaneous exit ─
  gsap.to(winBannerEl, { opacity: 0, duration: 0.5, ease: 'power2.in',
    onComplete: () => { winBannerEl.classList.add('hidden'); winBannerEl.style.opacity = '' }
  })
  await new Promise(r =>
    gsap.to(overlay, { opacity: 0, y: -30, duration: 0.5, ease: 'power2.in', onComplete: () => { overlay.remove(); r() } })
  )
  await new Promise(r => setTimeout(r, 300))   // brief clear pause — screen is clean

  // ── Step 6: Announcer appears only after all overlays are gone ────────────
  _zoomAnnouncerOut()   // unfreeze video (walk loop) + zoom back to 1×
  await new Promise(r =>
    gsap.to(announcer._el, { opacity: 1, duration: 0.6, ease: 'power2.out', onComplete: r })
  )
  await new Promise(r => setTimeout(r, 400))   // let her settle before speaking

  await new Promise(resolve => announcer.sayText('Congratulations to all the winners!', resolve))
  await new Promise(r => setTimeout(r, 500))

  // ── Step 7: Fade announcer out → show results ────────────────────────────
  await new Promise(r =>
    gsap.to(announcer._el, { opacity: 0, duration: 0.8, ease: 'power2.in', onComplete: r })
  )

  _ceremonyActive = false  // ceremony complete
  clearTimeout(_safetyTimer)
  // Apply any 'waiting' event that was deferred during the ceremony
  if (_pendingWaiting) { const pw = _pendingWaiting; _pendingWaiting = null; _applyWaiting(pw) }
  tryShowDrawResults(_ownDrawId)
  } catch(err) {
    console.error('[bingo] runBingoCheck error — forcing ceremony end:', err)
    clearTimeout(_safetyTimer)
    _ceremonyActive = false
    if (_pendingWaiting) { const pw = _pendingWaiting; _pendingWaiting = null; _applyWaiting(pw) }
    tryShowDrawResults(_ownDrawId)
  }
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
      if (!_firstBallCalled) { _firstBallCalled = true; _zoomAnnouncerIn() }
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

function showDrawResultsCard({ drawTitle, lineWinner, bingoWinner, linePrizeAwarded, bingoPrizeAwarded }, completedDrawId) {
  const existing = document.getElementById('draw-results-card')
  if (existing) existing.remove()

  // null winner means the house/system ticket won (email is withheld).
  // Distinguish that from "nobody won" using the awarded flags.
  const lineDisplay  = lineWinner  || '—'
  const bingoDisplay = bingoWinner || (bingoPrizeAwarded ? 'Undisclosed email' : '—')

  const card = document.createElement('div')
  card.id = 'draw-results-card'
  card.innerHTML = `
    <div class="drc-title">Draw Results</div>
    <div class="drc-draw">${drawTitle || 'Draw'}</div>
    <div class="drc-row"><span class="drc-label">Line</span><span class="drc-email">${lineDisplay}</span></div>
    <div class="drc-row"><span class="drc-label">Bingo</span><span class="drc-email">${bingoDisplay}</span></div>
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
        // Remove only the COMPLETED draw's tickets from storage.
        // Use completedDrawId (captured at draw-results time), NOT _currentDrawId
        // which may already have been updated to the next draw by the 'waiting' event.
        const drawIdToClear = completedDrawId ?? _currentDrawId
        try {
          if (drawIdToClear) {
            const store = JSON.parse(localStorage.getItem('bingoRoomTickets') || '{}')
            delete store[String(drawIdToClear)]
            localStorage.setItem('bingoRoomTickets', JSON.stringify(store))
          }
          // Only clear legacy key if it's for the completed draw
          try {
            const legacy = JSON.parse(localStorage.getItem('bingoRoomTicket') || '{}')
            if (!legacy.draw_id || String(legacy.draw_id) === String(drawIdToClear)) {
              localStorage.removeItem('bingoRoomTicket')
            }
          } catch {}
        } catch {}
        window.location.href = '/user-portal'
      }
    })
  }, 12000)
}

function tryShowDrawResults(completedDrawId) {
  if (_drawResults) {
    showDrawResultsCard(_drawResults, completedDrawId ?? _currentDrawId)
    _drawResults = null
  }
}

// Played on every client that did NOT win — shows the flash + checking overlay
async function runRemoteWinCeremony(type, amount) {
  // _ceremonyActive is already set in the prize-awarded handler before this is called (bingo).
  // Keep the guard here as a safety net for line wins (which don't need it but it's harmless).
  const _ownDrawId = _currentDrawId  // capture now — 'waiting' event may update it during ceremony
  paused = true
  gsap.to(announcer._el, { opacity: 0, duration: 0.25 })  // hide announcer so it doesn't show over overlay

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

  if (type === 'line') {
    // ── Line: short hold, banner, fade overlay, resume ───────────────────────
    await new Promise(r => setTimeout(r, 3500))
    showWin(amount > 0 ? `LINE! +${amount} pts` : 'LINE!', 'line')
    await new Promise(r => setTimeout(r, 1200))
    await new Promise(r =>
      gsap.to(overlay, { opacity: 0, y: -30, duration: 0.5, ease: 'power2.in',
        onComplete: () => { overlay.remove(); r() } })
    )
    gsap.to(announcer._el, { opacity: 1, duration: 0.4, ease: 'power2.out' })
    announcer.sayText('Continuing.', () => { paused = false; drainPendingBalls() })

  } else {
    // ── Bingo observer ceremony — mirrors runBingoCheck timing exactly ──────
    // Winner's check: 15 non-blank cells × 600 ms = 9 000 ms
    // Then 5 000 ms banner hold, then overlay+banner fade simultaneously,
    // then announcer + congratulations.
    // We replicate those durations so ALL screens clear at the same moment.
    const CHECK_MS = 9000   // matches 15 cells × 600 ms in runBingoCheck
    const HOLD_MS  = 5000

    try {
      // Hold the "Checking winner's card…" overlay for the full check duration
      await new Promise(r => setTimeout(r, CHECK_MS))

      // Win banner appears — same moment winner's check ends and their banner shows
      showWin(amount > 0 ? `BINGO! +${amount} pts` : 'BINGO!', 'bingo')
      await new Promise(r => setTimeout(r, HOLD_MS))   // 5 s hold — banner + overlay both visible

      // Fade overlay AND banner simultaneously (mirrors runBingoCheck step 5)
      gsap.to(winBannerEl, { opacity: 0, duration: 0.5, ease: 'power2.in',
        onComplete: () => { winBannerEl.classList.add('hidden'); winBannerEl.style.opacity = '' }
      })
      await new Promise(r =>
        gsap.to(overlay, { opacity: 0, y: -30, duration: 0.5, ease: 'power2.in',
          onComplete: () => { overlay.remove(); r() }
        })
      )
      await new Promise(r => setTimeout(r, 300))   // brief clear pause — screen is clean

      // Announcer appears + congratulations (mirrors runBingoCheck step 6)
      paused = false
      drainPendingBalls()
      await new Promise(r =>
        gsap.to(announcer._el, { opacity: 1, duration: 0.5, ease: 'power2.out', onComplete: r })
      )
      _zoomAnnouncerOut()
      await new Promise(r => setTimeout(r, 400))

      await new Promise(resolve => announcer.sayText('Congratulations to all the winners!', resolve))
      await new Promise(r => setTimeout(r, 500))

      await new Promise(r =>
        gsap.to(announcer._el, { opacity: 0, duration: 0.8, ease: 'power2.in', onComplete: r })
      )
    } catch (err) {
      console.error('[bingo] runRemoteWinCeremony error — recovering', err)
      // Clean up any leftover overlay elements so they don't block the UI
      document.getElementById('line-check-overlay')?.remove()
      if (winBannerEl) { winBannerEl.classList.add('hidden'); winBannerEl.style.opacity = '' }
      paused = false
    }
    _ceremonyActive = false
    // Apply any 'waiting' event that was deferred during the ceremony
    if (_pendingWaiting) { const pw = _pendingWaiting; _pendingWaiting = null; _applyWaiting(pw) }
    tryShowDrawResults(_ownDrawId)
  }
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

// ── Mid-draw entry: player has tickets for the running draw ───────────────
// Called when (re-)joining during a live draw instead of showing the curtain.
function _enterMidDraw(calledCount, annType) {
  // Ensure the call card is visible (showWaitingPanel hides it; this covers both
  // the "rejoined mid-draw from scratch" case and any timing where hideWaitingPanel
  // wasn't explicitly called before _enterMidDraw).
  hideWaitingPanel()

  _curtainFaded = true   // no curtain to fade
  _introPlayed  = true   // suppress the T-3s paused=true / curtain-lift path for this draw
  _lateEntry    = false  // entering live draw — no longer blocked
  paused        = false
  drawing       = false  // drum is idle — next number-drawn event must not be skipped

  // Dismiss the blocking curtain if it snuck up
  const blocked = document.getElementById('room-blocked')
  if (blocked) { blocked.classList.add('hidden'); blocked.style.opacity = '' }

  // Restore the room layout in case it was hidden
  const layout = document.querySelector('.room-layout')
  if (layout) layout.style.display = ''

  // Set announcer type (suppress speech mid-draw — just show her silently)
  if (annType) { announcer.setType(annType); updateStageScale() }
  gsap.set(announcer._el, { opacity: 1 })

  // Restore the called-numbers board silently (no animation)
  if (calledSet.size > 0) callCard.restore(Array.from(calledSet))

  // Render cards with already-called numbers marked
  renderPlayerCard()
  refreshCardMarks()
  checkWins()

  // Drain any balls that arrived while paused (shouldn't normally have any,
  // but guard against race between countdown T-3 and mid-draw entry)
  drainPendingBalls()

  // Update status bar
  if (statusTextEl) statusTextEl.textContent = 'Live'
  if (liveDot)      liveDot.className = 'live-dot on'

  // Show the catch-up banner only for users who have a ticket (ticketless watchers
  // don't need "X balls marked on your ticket" since they have no ticket)
  if (playerCards) {
    const banner = document.getElementById('room-midraw-banner')
    if (banner) {
      const txt = banner.querySelector('.rmb-text')
      if (txt) txt.textContent = calledCount > 0
        ? `Draw in progress — ${calledCount} ball${calledCount !== 1 ? 's' : ''} already called and marked on your ticket`
        : 'Draw in progress — your ticket is ready'
      banner.classList.remove('hidden')
      setTimeout(() => banner.classList.add('hidden'), 8000)
    }
  }
}

// ── Boot drum ─────────────────────────────────────────────────────────────
setTimeout(() => {
  drum.init(Array.from({ length: 90 }, (_, i) => i + 1))
  renderPlayerCard()
  if (!_previewMode) connectSocket()
}, 500)

// ── Tab visibility / bfcache return ──────────────────────────────────────────
// When the user switches back to this tab (or unlocks their phone), bring the
// call card and ticket marks in sync with the live calledSet — socket events
// kept the data current even while the tab was hidden.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && calledSet.size > 0) {
    drawing = false  // animations may have been throttled while hidden — unblock the pipeline
    callCard.restore(Array.from(calledSet))
    refreshCardMarks()
  }
})

// When the browser restores the page from bfcache (back/forward navigation)
// show a "Please Refresh" overlay rather than trusting the frozen JS state.
// After the forced reload, sessionStorage restores _wasWatchingDrawId so the
// user correctly rejoins the live draw (or sees the right curtain).
;(function () {
  const overlay     = document.getElementById('refresh-overlay')
  const refreshBtn  = document.getElementById('refresh-btn')
  const countdownEl = document.getElementById('refresh-countdown')
  if (!overlay || !refreshBtn) return

  let _cdInterval = null

  function showRefreshOverlay() {
    overlay.classList.remove('hidden')
    // 8-second auto-reload countdown
    let secs = 8
    countdownEl.textContent = `Auto-refreshing in ${secs}s…`
    _cdInterval = setInterval(() => {
      secs--
      if (secs <= 0) {
        clearInterval(_cdInterval)
        location.reload()
      } else {
        countdownEl.textContent = `Auto-refreshing in ${secs}s…`
      }
    }, 1000)
  }

  refreshBtn.addEventListener('click', () => {
    clearInterval(_cdInterval)
    location.reload()
  })

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) showRefreshOverlay()
  })
})()

// ── Announcer intro at draw start (shared by curtain-fade and no-curtain paths) ─
function _sayIntro() {
  const title = _nextDrawTitle || 'this draw'
  announcer.sayText(
    `Welcome to ${title}, I will be calling for you. Let's start!`,
    () => { paused = false; drainPendingBalls() }
  )
}

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
  socket.on('state', ({ called, gameOver, phase, drawId, nextDrawTime, nextDrawTitle, announcer: annType, linePrizeAwarded: lpa, bingoPrizeAwarded: bpa }) => {
    calledSet = new Set(called)
    if (phase === 'waiting') {
      _nextDrawTitle     = nextDrawTitle || 'this draw'
      _setWatchingDraw(drawId)       // user is in room before draw start — allow ticket-less watching
      if (annType) { announcer.setType(annType); updateStageScale() }
      loadCardsForDraw(drawId)
      renderPlayerCard()
      callCard.reset()
      showWaitingPanel(nextDrawTime, nextDrawTitle)
      return
    }
    // phase === 'drawing'
    lineWon  = lpa ?? false
    bingoWon = bpa ?? false
    loadCardsForDraw(drawId)
    if (called.length > 0 && !gameOver) {
      if (annType) { announcer.setType(annType); updateStageScale() }
      // Always enter a running draw — no reason to block someone returning to the room
      _enterMidDraw(called.length, annType)
      return
    }
    if (calledSet.size > 0) callCard.restore(Array.from(calledSet))
    refreshCardMarks()
    checkWins()
    if (gameOver) statusTextEl.textContent = 'Draw ended'
  })

  // Server signals waiting for next draw
  socket.on('waiting', ({ drawId, nextDrawTime, nextDrawTitle, announcer: annType }) => {
    // Guard: if a bingo ceremony is running on ANY client (winner or observer), suppress
    // the curtain entirely — it would abruptly interrupt the ceremony overlay.
    // Also suppress for 35 s after game-over when bingo was won, because the observer
    // ceremony (_ceremonyActive) may have already finished while the winner's longer
    // ceremony (runBingoCheck) is still running on another device.
    const msSinceGameOver = _gameOverAt ? (Date.now() - _gameOverAt) : Infinity
    if (_ceremonyActive || (bingoWon && msSinceGameOver < 35000)) {
      _pendingWaiting = { drawId, nextDrawTime, nextDrawTitle, annType }
      return   // applied by _applyPendingWaiting() when ceremony ends
    }
    _applyWaiting({ drawId, nextDrawTime, nextDrawTitle, annType })
  })

  // Countdown tick — update fill bar; at T-3 fade in announcer; at T=0 lift curtain
  socket.on('countdown', ({ remaining, total }) => {
    const pct = remaining / total
    if (countdownFill) countdownFill.style.width = (pct * 100) + '%'

    // Keep curtain countdown display in sync with server seconds —
    // but stop once _introPlayed is set (T≤3) so "DRAW STARTING!" isn't overwritten.
    const ccEl = document.getElementById('curtain-countdown-display')
    if (ccEl && remaining > 0 && !_introPlayed) {
      const cm = Math.floor(remaining / 60)
      const cs = remaining % 60
      ccEl.textContent = cm > 0
        ? `${String(cm).padStart(2,'0')}:${String(cs).padStart(2,'0')}`
        : `00:${String(cs).padStart(2,'0')}`
    }

    // T-3s: queue balls and hide the waiting panel — but keep announcer hidden until curtain lifts
    if (remaining <= 3 && !_introPlayed) {
      _introPlayed = true
      paused = true   // queue any balls the server sends during the curtain transition

      // Replace numeric countdown with a non-numeric indicator so clock-skew
      // (client ~4s ahead of server) never shows phantom extra seconds to the user.
      if (ccEl) {
        ccEl.textContent = 'DRAW STARTING!'
        ccEl.style.fontSize = ''   // let CSS control size (may have been shrunk for long times)
      }

      // Fade out the room-next-draw panel (behind the curtain, but hide it cleanly)
      const panel = document.getElementById('room-next-draw')
      if (panel && !panel.classList.contains('hidden')) {
        gsap.to(panel, {
          opacity: 0, duration: 0.4,
          onComplete: () => { panel.classList.add('hidden'); panel.style.opacity = '' }
        })
      }
      // Un-hide the call card (showWaitingPanel hid it while waiting for the draw)
      const calledEl3 = document.getElementById('called-numbers')
      if (calledEl3) calledEl3.style.display = ''
      // Announcer fades in AFTER the curtain lifts (see T=0 block below)
    }

    // At 00:00: lift the curtain, then fade in announcer so she never shows over the curtain
    if (remaining <= 0 && !_curtainFaded) {
      _curtainFaded = true
      const blocked = document.getElementById('room-blocked')
      if (blocked && !blocked.classList.contains('hidden')) {
        gsap.to(blocked, {
          opacity: 0, duration: 1.5, ease: 'power2.in',
          onComplete: () => {
            blocked.classList.add('hidden')
            blocked.style.opacity = ''
            gsap.to(announcer._el, { opacity: 1, duration: 0.5, ease: 'power2.out' })
            _sayIntro()
          }
        })
      } else {
        // No curtain — still fade announcer in cleanly before intro
        gsap.to(announcer._el, { opacity: 1, duration: 0.5, ease: 'power2.out' })
        _sayIntro()
      }
    }
  })

  // A number is drawn — animate ball
  socket.on('number-drawn', ({ number, called }) => {
    // Guard: late-entry user is blocked by the next-draw curtain — they are not
    // watching this draw. Silently update calledSet and do nothing else.
    if (_lateEntry) { calledSet = new Set(called); return }

    // Safety: first ball arrives before countdown reaches remaining=0 (server timer
    // race) — the curtain is still up. Lift it and play the intro speech so the
    // announcer always introduces herself at draw start.
    if (!_curtainFaded) {
      _curtainFaded = true
      _introPlayed  = true   // prevent T-3 block from pausing again after this
      paused        = true   // queue this ball until intro finishes
      // Un-hide the call card in case showWaitingPanel hid it during pre-draw waiting
      const calledEl4 = document.getElementById('called-numbers')
      if (calledEl4) calledEl4.style.display = ''
      const blocked = document.getElementById('room-blocked')
      if (blocked && !blocked.classList.contains('hidden')) {
        gsap.to(blocked, {
          opacity: 0, duration: 0.8,
          onComplete: () => {
            blocked.classList.add('hidden')
            blocked.style.opacity = ''
            gsap.to(announcer._el, { opacity: 1, duration: 0.5, ease: 'power2.out' })
            _sayIntro()   // callback: paused=false; drainPendingBalls()
          }
        })
      } else {
        // No curtain — fade announcer in and play intro
        gsap.to(announcer._el, { opacity: 1, duration: 0.5, ease: 'power2.out' })
        _sayIntro()
      }
    }
    if (paused) { _pendingBalls.push({ number, called }); return }
    calledSet = new Set(called)
    if (drawing) return
    drawing = true
    if (lastNumEl) lastNumEl.textContent = number
    if (countdownFill) countdownFill.style.width = '100%'

    drum.exitBall(
      number,
      // onReveal — ball reaches tube peak
      (num, group, color) => {
        callCard.display(num)
        if (!paused) {
          announcer.announce(num)
          if (!_firstBallCalled) { _firstBallCalled = true; _zoomAnnouncerIn() }
        }
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
    _gameOverAt = Date.now()   // timestamp used to suppress 'waiting' curtain during ceremony
    _setWatchingDraw(null)     // clear watching draw — next draw's waiting phase sets a fresh one
  })

  socket.on('draw-results', (data) => {
    _drawResults = data
    // Capture the completed draw's ID RIGHT NOW before the 'waiting' event fires
    // and updates _currentDrawId to the next draw's ID (happens ~5s later).
    const completedDrawId = _currentDrawId
    // Spectators / no-ticket clients show results after 5 s (no ceremony to wait for).
    // Ticket-holders rely on the ceremony calling tryShowDrawResults(); 20 s is a safety net.
    const delay = playerCards?.cards?.length ? 20000 : 5000
    setTimeout(() => tryShowDrawResults(completedDrawId), delay)
  })

  // Broadcast prize announcements to ALL connected clients
  socket.on('prize-awarded', ({ type, amount, user_id }) => {
    if (type === 'line') {
      if (_pendingLineCard) {
        // This client detected a line and is waiting for server confirmation.
        const { card, rowIdx } = _pendingLineCard
        _pendingLineCard = null
        const iWon = _myUserId && String(user_id) === String(_myUserId)
        if (iWon) {
          runLineCheck(card, rowIdx)   // personal winner ceremony
        } else {
          runRemoteWinCeremony('line', amount)  // someone else won; show observer ceremony
        }
      } else if (!lineWon) {
        // This client didn't detect a line locally — just show the observer ceremony
        lineWon = true
        runRemoteWinCeremony('line', amount)
      }
      // if lineWon && !_pendingLineCard: we already ran our ceremony, nothing to do
    } else if (type === 'bingo') {
      if (bingoWon) return
      bingoWon = true
      _ceremonyActive = true   // set synchronously so any 'waiting' arriving after this is suppressed
      runRemoteWinCeremony('bingo', amount)
    }
  })

  socket.on('game-reset', ({ drawId } = {}) => {
    calledSet  = new Set()
    lineWon    = false
    bingoWon   = false
    drawing    = false
    paused     = false
    _drawResults    = null
    _pendingBalls   = []
    _pendingLineCard  = null   // clear any deferred line ceremony
    _pendingWaiting   = null   // clear any deferred 'waiting' payload
    _gameOverAt       = 0      // reset game-over timestamp
    _introPlayed    = false   // new draw cycle — allow intro at T-3s
    _curtainFaded   = false   // allow curtain to lift for the new draw
    _ceremonyActive = false   // reset in case it was still set from a prior ceremony
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
    // Load cards for the new draw, then render
    loadCardsForDraw(drawId ?? _currentDrawId)
    renderPlayerCard()
    drum.reset(Array.from({ length: 90 }, (_, i) => i + 1))
    // Fade announcer out — she fades back in at T=0 when the curtain lifts
    if (!_previewMode) gsap.to(announcer._el, { opacity: 0, duration: 0.5 })
  })
}
