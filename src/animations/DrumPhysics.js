import * as CANNON from 'cannon-es'
import { gsap } from 'gsap'
import { COL_COLORS, getColumn } from '../utils/bingoLogic.js'

// ── Visual constants ──────────────────────────────────────────────────────
const BALL_VISUAL_R = 8     // px — rendered radius (16 px diam)
const BALL_PHYS_R   = 6     // cannon-es physics radius
const DRUM_INNER_R  = 118   // soft containment sphere radius
const PERSP         = 185   // perspective depth for 3-D projection
const DEG_PER_PX    = 360 / (2 * Math.PI * BALL_VISUAL_R)  // ~7.16 deg/px rolling rate

// Omnidirectional turbulence — no bias, fast chaotic motion
const F_TURB    = 150   // per-frame random force (X, Y, Z equally)
const V_MIN     = 10    // minimum ball speed — boosts sluggish balls
const V_MAX     = 130   // velocity cap to prevent physics instability

// ── Tube tilt: B, D, F tilt 2°; H stays flat ─────────────────────────────
const TAN2 = Math.tan(2 * Math.PI / 180)   // ≈ 0.03492
// B (x=155→530, 375px wide): right end drops 375×TAN2 ≈ 13px
// D (x=530→375, 155px wide): left end drops 155×TAN2  ≈  5px
// F (x=375→530, 155px wide): right end drops 155×TAN2 ≈  5px

// ── Tube centre-line waypoints (machine-container coords) ─────────────────
// Drum wrapper: left 10 px, top 80 px inside .lottery-machine
// Drum centre: (10+145, 80+145) = (155, 225)  Drum top: (155, 80)
const TUBE_WP = [
  { x: 155, y: 100 },   // [0] drum-top exit collar
  { x: 155, y: 12  },   // [1] tube peak  ← REVEAL point
  { x: 530, y: Math.round(12  + (530 - 155) * TAN2) },  // [2] B right end  (~25)
  { x: 530, y: 135 },   // [3] first drop
  { x: 375, y: Math.round(135 + (530 - 375) * TAN2) },  // [4] D left end   (~140)
  { x: 375, y: 255 },   // [5] second drop
  { x: 530, y: Math.round(255 + (530 - 375) * TAN2) },  // [6] F right end  (~260)
  { x: 530, y: 385 },   // [7] final drop
  { x: 120, y: 385 },   // [8] tube end ← ball 0 rests here
]

// Precomputed rest slots following the tube path, starting at tube end (x=120)
const REST_SLOTS = (() => {
  const R = BALL_VISUAL_R
  const s = []
  const add = (cx, cy, sec) => s.push({ left: cx - R, top: cy - R, sec })
  const S = 18   // slot step — ball diameter (16) + 2 px gap
  const wp2y = TUBE_WP[2].y, wp4y = TUBE_WP[4].y, wp6y = TUBE_WP[6].y
  // H: bottom horizontal — flat, enters from WP[7] right, fills left→right
  for (let cx = 120 + R; cx <= 530 - R; cx += S) add(cx, 385, 'H')
  // G: right final vertical — from WP[6]=(530,~260) down to WP[7]=(530,385), fills bottom→top
  for (let cy = 385 - S; cy >= wp6y + R; cy -= S) add(530, cy, 'G')
  // F: third horizontal — tilts right (right end lower), fills right→left
  for (let cx = 530 - S; cx >= 375 + R; cx -= S) add(cx, Math.round(255 + (cx - 375) * TAN2), 'F')
  // E: left second vertical — from WP[4]=(375,~140) down to WP[5]=(375,255), fills bottom→top
  for (let cy = 255 - S; cy >= wp4y + R; cy -= S) add(375, cy, 'E')
  // D: second horizontal — tilts left (left end lower), fills left→right (x=375–530 only)
  for (let cx = 375 + R; cx <= 530 - R; cx += S) add(cx, Math.round(135 + (530 - cx) * TAN2), 'D')
  // C: right first vertical — from WP[2]=(530,~25) down to WP[3]=(530,135), fills bottom→top
  for (let cy = 135 - S; cy >= wp2y + R; cy -= S) add(530, cy, 'C')
  // B: top horizontal — tilts right (right end lower), fills right→left
  for (let cx = 530 - S; cx >= 155 + R; cx -= S) add(cx, Math.round(12 + (cx - 155) * TAN2), 'B')
  return s
})()

// ── Drum physics centre (within the drum-sphere element) ──────────────────
const CX = 145   // 290 / 2
const CY = 145

export class DrumPhysics {
  constructor(drumEl, machineEl) {
    this.drumEl    = drumEl
    this.machineEl = machineEl
    this.entries   = []    // { body, number, group, color, el, exiting }
    this.animFrame = null
    this.running   = false
    this.drawnCount = 0
    this._kickTimer = null
    this._lastTs    = null

    // ── cannon-es world ──
    this.world = new CANNON.World()
    this.world.gravity.set(0, 0, 0)           // zero gravity — custom forces
    this.world.broadphase = new CANNON.NaiveBroadphase()
    this.world.solver.iterations = 10
    this.world.allowSleep = false

    const mat = new CANNON.Material('ball')
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(mat, mat, { friction: 0.01, restitution: 0.95 })
    )
    this._mat   = mat
    this._shape = new CANNON.Sphere(BALL_PHYS_R)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  init(numbers) {
    numbers.forEach(n => this._spawn(n))
    this._lastTs = performance.now()
    this._warmup = true
    // Let balls settle at the bottom for 2 s before turbulence starts
    setTimeout(() => {
      this._warmup = false
      this._kickTimer = setInterval(() => this._kick(), 480)
    }, 2000)
    this.running = true
    const tick = ts => {
      if (!this.running) return
      const dt = Math.min((ts - this._lastTs) / 1000, 0.05)
      this._lastTs = ts
      this._forces()
      this.world.step(1 / 60, dt, 3)
      this._render()
      this.animFrame = requestAnimationFrame(tick)
    }
    this.animFrame = requestAnimationFrame(tick)
  }

  // onReveal(number, group, color) fired when ball reaches tube peak
  // onSettle(number, group, color) fired when ball is at rest in tray
  // Returns drawn number, or null if drum is empty
  exitBall(number, onReveal, onSettle) {
    const avail = this.entries.filter(e => !e.exiting)
    if (!avail.length) return null
    const e = avail.find(e => e.number === number) || avail[Math.floor(Math.random() * avail.length)]
    return this._doExit(e, onReveal, onSettle)
  }

  exitRandomBall(onReveal, onSettle) {
    const avail = this.entries.filter(e => !e.exiting)
    if (!avail.length) return null
    const e = avail[Math.floor(Math.random() * avail.length)]
    return this._doExit(e, onReveal, onSettle)
  }

  _doExit(e, onReveal, onSettle) {
    e.exiting = true
    this.world.removeBody(e.body)

    // ── Project ball's 3-D position to machine-container coords ──
    const mRect  = this.machineEl.getBoundingClientRect()
    const dRect  = this.drumEl.getBoundingClientRect()
    const offX   = dRect.left - mRect.left
    const offY   = dRect.top  - mRect.top
    const p      = e.body.position
    const s      = PERSP / (PERSP - p.z)
    const vs     = Math.max(0.5, Math.min(1.35, s))
    const vr     = BALL_VISUAL_R * vs
    const startL = offX + CX + p.x * s - vr
    const startT = offY + CY - p.y * s - vr

    // ── Clone positioned in machine container ──
    const clone = document.createElement('div')
    clone.className = 'drum-ball--clone'
    clone.innerHTML = e.el.innerHTML
    clone.style.cssText =
      `background:${e.el.style.background};` +
      `border-color:${e.el.style.borderColor};` +
      `box-shadow:${e.el.style.boxShadow};` +
      `left:${startL}px;top:${startT}px;` +
      `transform:scale(${vs});z-index:60;`
    this.machineEl.appendChild(clone)

    gsap.to(e.el, { opacity: 0, scale: 0.2, duration: 0.18 })

    // ── Rest slot — follows tube path, starts at tube end ──
    const idx  = this.drawnCount++
    const slot = REST_SLOTS[idx] ?? REST_SLOTS[REST_SLOTS.length - 1]
    const restL = slot.left
    const restT = slot.top

    const wp = i => ({
      left: TUBE_WP[i].x - BALL_VISUAL_R,
      top:  TUBE_WP[i].y - BALL_VISUAL_R,
    })

    const sec = slot.sec

    // ── GSAP timeline through tube ──
    const tl = gsap.timeline({
      onComplete: () => {
        clone.remove()
        e.el.remove()
        this.entries = this.entries.filter(x => x !== e)

        const rb = document.createElement('div')
        rb.className = 'rest-ball rest-ball--latest'
        rb.innerHTML = clone.innerHTML
        rb.style.background  = e.el.style.background
        rb.style.borderColor = e.el.style.borderColor
        rb.style.boxShadow   =
          `0 2px 6px rgba(0,0,0,0.60),` +
          `inset -2px -3px 5px rgba(0,0,0,0.38),` +
          `inset 1px 1px 3px rgba(255,255,255,0.42),` +
          `0 0 10px ${e.color}88`
        rb.style.left = restL + 'px'
        rb.style.top  = restT + 'px'
        this.machineEl.appendChild(rb)
        setTimeout(() => rb.classList.remove('rest-ball--latest'), 2200)

        onSettle(e.number, e.group, e.color)
      }
    })

    const rot = px => Math.round(px * DEG_PER_PX)  // rotation degrees for pixel distance

    // Always: rise from drum to WP[0], shoot up to WP[1] (reveal)
    tl.to(clone, { left: wp(0).left, top: wp(0).top,
                   scale: 1, rotation: `+=${rot(100)}`, duration: 0.32, ease: 'power2.in' })
      .to(clone, { left: wp(1).left, top: wp(1).top,
                   rotation: `+=${rot(TUBE_WP[0].y - TUBE_WP[1].y)}`,
                   duration: 0.20, ease: 'power3.out',
                   onComplete: () => {
                     gsap.fromTo(clone,
                       { filter: `brightness(3) drop-shadow(0 0 18px ${e.color})` },
                       { filter: 'none', duration: 0.5, ease: 'power2.out' })
                     onReveal(e.number, e.group, e.color)
                   } })

    // Travel along tube only as far as the entry waypoint for this section,
    // then slide directly to the rest slot — never pass through existing balls.
    //
    // Entry waypoints per section:
    //   B → WP[1] (already there)   slide right  to restL
    //   C → WP[2]                   drop down    to restT
    //   D → WP[3] (RIGHT end of D)  slide left   to restL
    //   E → WP[4]                   drop down    to restT
    //   F → WP[5] (LEFT end of F)   slide right  to restL
    //   G → WP[6]                   drop down    to restT
    //   H → WP[7]                   slide left   to restL

    if (sec !== 'B') {
      // Roll right along top horizontal → WP[2] (tilted, so top also changes)
      tl.to(clone, { left: wp(2).left, top: wp(2).top,
                     rotation: `+=${rot(TUBE_WP[2].x - TUBE_WP[1].x)}`,
                     duration: 0.42, ease: 'none' })
    }
    if (sec !== 'B' && sec !== 'C') {
      // Drop down first vertical → WP[3]
      tl.to(clone, { left: wp(3).left, top: wp(3).top,
                     rotation: `+=${rot(TUBE_WP[3].y - TUBE_WP[2].y)}`,
                     duration: 0.24, ease: 'power2.in' })
    }
    if (sec === 'E' || sec === 'F' || sec === 'G' || sec === 'H') {
      // Slide left → WP[4]  (D stops at WP[3] — its entry point)
      tl.to(clone, { left: wp(4).left, top: wp(4).top,
                     rotation: `-=${rot(TUBE_WP[3].x - TUBE_WP[4].x)}`,
                     duration: 0.28, ease: 'none' })
    }
    if (sec === 'F' || sec === 'G' || sec === 'H') {
      // Drop down second vertical → WP[5]
      tl.to(clone, { left: wp(5).left, top: wp(5).top,
                     rotation: `+=${rot(TUBE_WP[5].y - TUBE_WP[4].y)}`,
                     duration: 0.24, ease: 'power2.in' })
    }
    if (sec === 'G' || sec === 'H') {
      // Slide right → WP[6]  (F stops at WP[5] — its entry point)
      tl.to(clone, { left: wp(6).left, top: wp(6).top,
                     rotation: `+=${rot(TUBE_WP[6].x - TUBE_WP[5].x)}`,
                     duration: 0.28, ease: 'none' })
    }
    if (sec === 'H') {
      // Drop down final vertical → WP[7]
      tl.to(clone, { left: wp(7).left, top: wp(7).top,
                     rotation: `+=${rot(TUBE_WP[7].y - TUBE_WP[6].y)}`,
                     duration: 0.30, ease: 'power2.in' })
    }

    // Final move: from entry waypoint to rest slot
    // Tilted horizontals (B, D, F) animate both axes; H (flat) only left; verticals only top
    const entryL = { H: wp(7).left, G: wp(6).left, F: wp(5).left,
                     E: wp(4).left, D: wp(3).left, C: wp(2).left, B: wp(1).left }[sec]
    const entryT = { H: wp(7).top,  G: wp(6).top,  F: wp(5).top,
                     E: wp(4).top,  D: wp(3).top,  C: wp(2).top,  B: wp(1).top  }[sec]
    const hDist = Math.abs(restL - entryL)
    const vDist = Math.abs(restT - entryT)

    if (sec === 'H' || sec === 'F' || sec === 'D' || sec === 'B') {
      const rightward = sec === 'B' || sec === 'F'
      const rotStr    = rightward ? `+=${rot(hDist)}` : `-=${rot(hDist)}`
      if (sec === 'H') {
        tl.to(clone, { left: restL, rotation: rotStr,
                       duration: Math.max(0.15, hDist / 600), ease: 'power2.out' })
      } else {
        tl.to(clone, { left: restL, top: restT, rotation: rotStr,
                       duration: Math.max(0.15, hDist / 600), ease: 'power2.out' })
      }
    } else {
      tl.to(clone, { top: restT, rotation: `+=${rot(vDist)}`,
                     duration: Math.max(0.15, vDist / 600), ease: 'power2.in' })
    }

    return e.number
  }

  stop() {
    this.running = false
    if (this.animFrame)  cancelAnimationFrame(this.animFrame)
    if (this._kickTimer) clearInterval(this._kickTimer)
  }

  reset(numbers) {
    this.stop()
    this.entries.forEach(e => e.el.remove())
    this.machineEl.querySelectorAll('.rest-ball,.drum-ball--clone').forEach(el => el.remove())
    this.entries    = []
    this.drawnCount = 0
    ;[...this.world.bodies].forEach(b => this.world.removeBody(b))
    this.init(numbers)
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _spawn(number) {
    const group = getColumn(number)
    const color = COL_COLORS[group]

    const body = new CANNON.Body({
      mass: 1, material: this._mat,
      linearDamping: 0.01, angularDamping: 0.05,
    })
    body.addShape(this._shape)

    // Start in the bottom hemisphere so balls settle visually before blowing
    let x, y, z
    do {
      x = (Math.random() * 2 - 1) * DRUM_INNER_R * 0.65
      y = -(Math.random())         * DRUM_INNER_R * 0.65   // negative y = bottom
      z = (Math.random() * 2 - 1) * DRUM_INNER_R * 0.65
    } while (x*x + y*y + z*z > (DRUM_INNER_R * 0.65) ** 2)

    body.position.set(x, y, z)
    body.velocity.set(0, 0, 0)
    this.world.addBody(body)

    const el = document.createElement('div')
    el.className = 'drum-ball'
    el.innerHTML = `<span>${number}</span>`
    el.style.background  = `radial-gradient(circle at 35% 28%,
      rgba(255,255,255,0.88) 0%,
      rgba(255,255,255,0.48) 8%,
      ${color}ff 22%,
      ${color}cc 50%,
      ${color}55 75%,
      rgba(0,0,0,0.55) 100%)`
    el.style.borderColor = color + 'bb'
    el.style.boxShadow   =
      `0 3px 8px rgba(0,0,0,0.65),` +
      `inset -2px -3px 6px rgba(0,0,0,0.40),` +
      `inset 1px 1px 4px rgba(255,255,255,0.40),` +
      `0 0 8px ${color}55`
    this.drumEl.appendChild(el)

    this.entries.push({ body, number, group, color, el, exiting: false })
  }

  _forces() {
    for (const e of this.entries) {
      if (e.exiting) continue
      const b = e.body
      const p = b.position

      if (this._warmup) {
        // Settle phase — pull balls downward so they pile up visibly
        b.force.y -= 220
        // Gentle damping so they don't bounce wildly
        b.velocity.x *= 0.92
        b.velocity.y *= 0.92
        b.velocity.z *= 0.92
      } else {
        // ── Omnidirectional turbulence ──
        b.force.x += (Math.random() - 0.5) * F_TURB
        b.force.y += (Math.random() - 0.5) * F_TURB
        b.force.z += (Math.random() - 0.5) * F_TURB

        // ── Minimum speed — boost sluggish balls with a random impulse ──
        const spd2 = b.velocity.x**2 + b.velocity.y**2 + b.velocity.z**2
        if (spd2 < V_MIN * V_MIN) {
          const boost = V_MIN * 1.8
          b.velocity.x += (Math.random() - 0.5) * boost
          b.velocity.y += (Math.random() - 0.5) * boost
          b.velocity.z += (Math.random() - 0.5) * boost
        }

        // ── Velocity cap — prevents instability at extreme speeds ──
        if (spd2 > V_MAX * V_MAX) {
          const scale = V_MAX / Math.sqrt(spd2)
          b.velocity.x *= scale
          b.velocity.y *= scale
          b.velocity.z *= scale
        }
      }

      // ── Hard spherical wall — spring push-back + sharp elastic reflection ──
      const r   = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z)
      const lim = DRUM_INNER_R - BALL_PHYS_R
      if (r > lim) {
        const inv = 1 / r
        const nx = p.x*inv, ny = p.y*inv, nz = p.z*inv
        const over = r - lim
        b.force.x -= nx * over * 320
        b.force.y -= ny * over * 320
        b.force.z -= nz * over * 320
        const vOut = b.velocity.x*nx + b.velocity.y*ny + b.velocity.z*nz
        if (vOut > 0) {
          b.velocity.x -= vOut * nx * 2.0
          b.velocity.y -= vOut * ny * 2.0
          b.velocity.z -= vOut * nz * 2.0
          // small random scatter on bounce — simulates textured drum wall
          b.velocity.x += (Math.random() - 0.5) * 4
          b.velocity.y += (Math.random() - 0.5) * 4
          b.velocity.z += (Math.random() - 0.5) * 4
        }
      }
    }
  }

  _render() {
    for (const e of this.entries) {
      if (e.exiting) continue
      const p  = e.body.position
      const s  = PERSP / (PERSP - p.z)           // perspective scale
      const vs = Math.max(0.5, Math.min(1.4, s))
      const vr = BALL_VISUAL_R * vs
      const sx = CX + p.x * s
      const sy = CY - p.y * s                     // CSS y is inverted

      e.el.style.left      = sx - vr + 'px'
      e.el.style.top       = sy - vr + 'px'
      e.el.style.transform = `scale(${vs})`
      e.el.style.zIndex    = Math.round(p.z + 200)
      // Fade balls far behind the drum centre
      e.el.style.opacity   = p.z < -DRUM_INNER_R * 0.6 ? '0.25' : '1'
    }
  }

  _kick() {
    for (const e of this.entries) {
      if (e.exiting) continue
      // Random kick in all directions — keeps motion chaotic
      e.body.velocity.x += (Math.random() - 0.5) * 38
      e.body.velocity.y += (Math.random() - 0.5) * 38
      e.body.velocity.z += (Math.random() - 0.5) * 38
    }
  }
}
