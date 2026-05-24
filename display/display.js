// Big Screen Display — agent-authenticated live bingo draw view

// ── Ball call phrases (same as Announcer.js) ──────────────────────────────
const CALLS = {
  1:'Kelly\'s eye — number one!',   2:'One little duck — number two!',
  3:'Cup of tea — number three!',   4:'Knock at the door — number four!',
  5:'Man alive — number five!',     7:'Lucky seven!',
  8:'One fat lady — number eight!', 11:'Legs eleven!',
  13:'Unlucky for some — thirteen!',21:'Key of the door — twenty one!',
  22:'Two little ducks — twenty two!',88:'Two fat ladies — eighty eight!',
  90:'Top of the shop — ninety!',
}
const callPhrase = n => CALLS[n] || `Number ${n}!`

// ── DOM refs ──────────────────────────────────────────────────────────────
const loginOverlay  = document.getElementById('loginOverlay')
const loginEmail    = document.getElementById('loginEmail')
const loginPassword = document.getElementById('loginPassword')
const loginBtn      = document.getElementById('loginBtn')
const loginError    = document.getElementById('loginError')

const display       = document.getElementById('display')
const dsDrawTitle   = document.getElementById('dsDrawTitle')
const dsStatus      = document.getElementById('dsStatus')
const dsLogout      = document.getElementById('dsLogout')
const dsBallCircle  = document.getElementById('dsBallCircle')
const dsBallNumber  = document.getElementById('dsBallNumber')
const dsBallPhrase  = document.getElementById('dsBallPhrase')
const dsCalledCount = document.getElementById('dsCalledCount')
const dsGrid        = document.getElementById('dsGrid')
const dsLinePrize   = document.getElementById('dsLinePrize')
const dsBingoPrize  = document.getElementById('dsBingoPrize')
const dsNextTime    = document.getElementById('dsNextTime')
const dsWinOverlay  = document.getElementById('dsWinOverlay')
const dsWinText     = document.getElementById('dsWinText')
const dsWinSub      = document.getElementById('dsWinSub')
const dsWinEmoji    = document.getElementById('dsWinEmoji')

// ── Auth ──────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'display-agent-token'

function getToken() { return localStorage.getItem(TOKEN_KEY) }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t) }
function clearToken() { localStorage.removeItem(TOKEN_KEY) }

async function validateToken(token) {
  // Verify the token is still valid (agent portal login endpoint returns profile)
  try {
    const r = await fetch('/api/agent-portal/overview', {
      headers: { Authorization: `Bearer ${token}` }
    })
    return r.ok
  } catch { return false }
}

async function tryAutoLogin() {
  const token = getToken()
  if (!token) return false
  const ok = await validateToken(token)
  if (!ok) { clearToken(); return false }
  return true
}

async function login(email, password) {
  const r = await fetch('/api/agent-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password })
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || 'Login failed')
  return data.token
}

// ── Login UI ──────────────────────────────────────────────────────────────
function showLoginError(msg) {
  loginError.textContent = msg
  loginError.classList.remove('hidden')
}

loginBtn.addEventListener('click', async () => {
  const email = loginEmail.value.trim()
  const pass  = loginPassword.value
  if (!email || !pass) { showLoginError('Please enter your email and password.'); return }
  loginError.classList.add('hidden')
  loginBtn.disabled = true
  loginBtn.textContent = 'Signing in…'
  try {
    const token = await login(email, pass)
    setToken(token)
    showDisplay()
  } catch (e) {
    showLoginError(e.message)
  } finally {
    loginBtn.disabled = false
    loginBtn.textContent = 'Unlock Display'
  }
})

loginPassword.addEventListener('keydown', e => {
  if (e.key === 'Enter') loginBtn.click()
})

dsLogout.addEventListener('click', () => {
  clearToken()
  socket?.disconnect()
  display.classList.add('hidden')
  loginOverlay.classList.remove('hidden')
  loginPassword.value = ''
  loginError.classList.add('hidden')
})

// ── Grid ──────────────────────────────────────────────────────────────────
const cells = {}  // n → td element

function buildGrid() {
  dsGrid.innerHTML = ''
  for (let n = 1; n <= 90; n++) {
    const td = document.createElement('div')
    td.className = 'ds-cell'
    td.textContent = n
    td.dataset.n = n
    dsGrid.appendChild(td)
    cells[n] = td
  }
}

function markCalled(calledArr, newNumber = null) {
  const calledSet = new Set(calledArr)
  for (let n = 1; n <= 90; n++) {
    const td = cells[n]
    if (!td) continue
    if (calledSet.has(n)) {
      td.classList.add('called')
      if (n === newNumber) td.classList.add('new-call')
      else td.classList.remove('new-call')
    } else {
      td.classList.remove('called', 'new-call')
    }
  }
  dsCalledCount.textContent = `${calledArr.length} / 90`
}

function resetGrid() {
  for (let n = 1; n <= 90; n++) cells[n]?.classList.remove('called', 'new-call')
  dsCalledCount.textContent = '0 / 90'
}

// ── Ball display ──────────────────────────────────────────────────────────
function showBall(number) {
  dsBallNumber.textContent = number
  dsBallPhrase.textContent = callPhrase(number)
  dsBallCircle.classList.remove('pop')
  // Force reflow to restart animation
  void dsBallCircle.offsetWidth
  dsBallCircle.classList.add('pop')
}

function resetBall() {
  dsBallNumber.textContent = '–'
  dsBallPhrase.textContent = 'Waiting for draw to start…'
  dsBallCircle.classList.remove('pop')
}

// ── Prizes ────────────────────────────────────────────────────────────────
function pts(amount) {
  if (amount == null || amount === 0) return '–'
  return `${Number(amount).toLocaleString()} pts`
}

function setPrizes(linePrize, bingoPrize) {
  dsLinePrize.textContent  = pts(linePrize)
  dsBingoPrize.textContent = pts(bingoPrize)
}

// ── Status bar ────────────────────────────────────────────────────────────
function setStatus(text, cls = '') {
  dsStatus.textContent = text
  dsStatus.className   = 'ds-status' + (cls ? ' ' + cls : '')
}

// ── Win overlay ───────────────────────────────────────────────────────────
let winTimer = null

function showWin(type, amount) {
  clearTimeout(winTimer)
  const isLine = type === 'line'
  dsWinEmoji.textContent = isLine ? '🎊' : '🎉'
  dsWinText.textContent  = isLine ? 'LINE!' : 'BINGO!'
  dsWinSub.textContent   = amount > 0 ? `Prize: ${pts(amount)}` : ''
  dsWinOverlay.className = `ds-win-overlay${isLine ? ' line' : ''}`
  // Auto-hide after 6s
  winTimer = setTimeout(() => dsWinOverlay.classList.add('hidden'), 6000)
}

// ── Next draw time ────────────────────────────────────────────────────────
function formatTime(isoStr) {
  if (!isoStr) return '–'
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '–' }
}

// ── Socket.io ────────────────────────────────────────────────────────────
let socket = null

function connectSocket() {
  socket = io({ transports: ['websocket'] })

  socket.on('state', data => {
    if (data.phase === 'waiting') {
      dsDrawTitle.textContent = data.nextDrawTitle || 'Bingo24-7'
      dsNextTime.textContent  = formatTime(data.nextDrawTime)
      setPrizes(data.line_prize, data.full_house_prize)
      setStatus('Waiting for next draw…')
      resetBall()
      if (data.called?.length) markCalled(data.called)
    } else {
      dsDrawTitle.textContent = data.drawTitle || 'Bingo24-7'
      setPrizes(data.line_prize, data.full_house_prize)
      setStatus('● LIVE', 'live')
      if (data.called?.length) {
        const last = data.called[data.called.length - 1]
        showBall(last)
        markCalled(data.called, last)
      }
    }
  })

  socket.on('waiting', data => {
    dsDrawTitle.textContent = data.nextDrawTitle || 'Bingo24-7'
    dsNextTime.textContent  = formatTime(data.nextDrawTime)
    setPrizes(data.line_prize, data.full_house_prize)
    setStatus('Waiting for next draw…')
  })

  socket.on('game-reset', () => {
    resetBall()
    resetGrid()
    dsWinOverlay.classList.add('hidden')
    setStatus('● LIVE', 'live')
    dsNextTime.textContent = '–'
  })

  socket.on('number-drawn', ({ number, called }) => {
    showBall(number)
    markCalled(called, number)
    setStatus(`● LIVE — Ball ${called.length}`, 'live')
  })

  socket.on('prize-awarded', ({ type, amount }) => {
    showWin(type, amount)
    setStatus(type === 'line' ? '🎊 LINE!' : '🎉 BINGO!', 'won')
  })

  socket.on('game-over', () => {
    setStatus('Draw complete')
  })

  socket.on('draw-results', ({ drawTitle }) => {
    if (drawTitle) dsDrawTitle.textContent = drawTitle
  })

  socket.on('disconnect', () => setStatus('Reconnecting…'))
  socket.on('connect',    () => {
    if (dsStatus.textContent === 'Reconnecting…') setStatus('Connected')
  })
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function showDisplay() {
  buildGrid()
  loginOverlay.classList.add('hidden')
  display.classList.remove('hidden')
  connectSocket()
}

;(async () => {
  const ok = await tryAutoLogin()
  if (ok) {
    showDisplay()
  }
  // Login overlay remains visible by default — user fills in credentials
})()
