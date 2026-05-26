import * as CANNON from 'cannon-es'
import * as THREE  from 'three'
import { gsap }   from 'gsap'
import { COL_COLORS, getColumn } from '/bingo-room/bingoLogic.js'

// ── Constants ─────────────────────────────────────────────────────────────
const BALL_VISUAL_R = 8     // DOM clone radius for tube animation (px)
const BALL_PHYS_R   = 6     // cannon-es collision sphere radius
const BALL_3D_R     = 8     // Three.js sphere radius (world units = px)
const DRUM_INNER_R  = 118   // soft containment sphere radius
const DRUM_SIZE     = 290   // drum-sphere CSS size in px (square)
const PERSP         = 185   // camera Z — matches animation-1 perspective depth
const DEG_PER_PX    = 360 / (2 * Math.PI * BALL_VISUAL_R)  // ~7.16 deg/px rolling rate

// Camera vertical FOV so that world-unit distances = pixel distances at z=0
const CAM_FOV = 2 * Math.atan((DRUM_SIZE / 2) / PERSP) * (180 / Math.PI)

// Turbulence & speed limits (cannon-es forces, same as animation 1)
const F_TURB = 150
const V_MIN  = 10
const V_MAX  = 130

// ── Tube tilt: B, D, F tilt 2°; H stays flat ─────────────────────────────
const TAN2 = Math.tan(2 * Math.PI / 180)   // ≈ 0.03492

// ── Tube centre-line waypoints (machine-container coords) ─────────────────
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

// Precomputed rest slots following the tube path (tilted horizontals B, D, F)
const REST_SLOTS = (() => {
  const R = BALL_VISUAL_R
  const s = []
  const add = (cx, cy, sec) => s.push({ left: cx - R, top: cy - R, sec })
  const S = 18
  const wp2y = TUBE_WP[2].y, wp4y = TUBE_WP[4].y, wp6y = TUBE_WP[6].y
  for (let cx = 120 + R; cx <= 530 - R; cx += S) add(cx, 385, 'H')
  for (let cy = 385 - S; cy >= wp6y + R; cy -= S) add(530, cy, 'G')
  for (let cx = 530 - S; cx >= 375 + R; cx -= S) add(cx, Math.round(255 + (cx - 375) * TAN2), 'F')
  for (let cy = 255 - S; cy >= wp4y + R; cy -= S) add(375, cy, 'E')
  for (let cx = 375 + R; cx <= 530 - R; cx += S) add(cx, Math.round(135 + (530 - cx) * TAN2), 'D')
  for (let cy = 135 - S; cy >= wp2y + R; cy -= S) add(530, cy, 'C')
  for (let cx = 530 - S; cx >= 155 + R; cx -= S) add(cx, Math.round(12 + (cx - 155) * TAN2), 'B')
  return s
})()

const CX = 145   // drum physics centre x (290/2)
const CY = 145   // drum physics centre y

export class DrumPhysics3D {
  constructor(drumEl, machineEl) {
    this.drumEl    = drumEl
    this.machineEl = machineEl
    this.entries   = []
    this.animFrame = null
    this.running   = false
    this.drawnCount = 0
    this._kickTimer = null
    this._lastTs    = null
    this._warmup    = false

    this._initPhysics()
    this._initThree()
  }

  // ── Public API ─────────────────────────────────────────────────────────

  init(numbers) {
    numbers.forEach(n => this._spawn(n))
    this._lastTs = performance.now()
    this._warmup = true
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
      this._render3D()
      this.animFrame = requestAnimationFrame(tick)
    }
    this.animFrame = requestAnimationFrame(tick)
  }

  exitBall(number, onReveal, onSettle) {
    const e = this.entries.find(x => x.number === number && !x.exiting)
    if (!e) return this.exitRandomBall(onReveal, onSettle)
    e.exiting = true
    this.world.removeBody(e.body)
    return this._animateExit(e, onReveal, onSettle)
  }

  // onReveal(number, group, color) — fires when ball reaches tube peak
  // onSettle(number, group, color) — fires when ball rests in tray
  exitRandomBall(onReveal, onSettle) {
    const avail = this.entries.filter(e => !e.exiting)
    if (!avail.length) return null

    const e = avail[Math.floor(Math.random() * avail.length)]
    e.exiting = true
    this.world.removeBody(e.body)
    return this._animateExit(e, onReveal, onSettle)
  }

  _animateExit(e, onReveal, onSettle) {

    // Project physics position → machine-container coords (matches animation-1 math)
    const mRect = this.machineEl.getBoundingClientRect()
    const dRect = this.drumEl.getBoundingClientRect()
    // getBoundingClientRect returns scaled viewport coords; clone CSS positions are
    // in the machine's own unscaled coordinate space, so divide by the CSS scale.
    const cssScale = mRect.width / 580   // 580 = machine natural CSS width
    const offX  = (dRect.left - mRect.left) / cssScale
    const offY  = (dRect.top  - mRect.top)  / cssScale
    const p     = e.body.position
    const s     = PERSP / (PERSP - p.z)
    const vs    = Math.max(0.5, Math.min(1.35, s))
    const vr    = BALL_VISUAL_R * vs
    const startL = offX + CX + p.x * s - vr
    const startT = offY + CY - p.y * s - vr

    // DOM clone travels through the tube — rendered using the same ball canvas as the drum
    const ballSrc = this._createBallCanvas(e.number, e.color)
    const cloneCnv = document.createElement('canvas')
    cloneCnv.width = cloneCnv.height = 64
    cloneCnv.getContext('2d').drawImage(ballSrc, 0, 0, 64, 64)

    const clone = document.createElement('div')
    clone.className = 'drum-ball--clone'
    clone.appendChild(cloneCnv)
    clone.style.cssText =
      `left:${startL}px;top:${startT}px;` +
      `transform:scale(${vs});z-index:60;` +
      `box-shadow:0 3px 10px rgba(0,0,0,0.70),0 0 10px ${e.color}66;`
    this.machineEl.appendChild(clone)

    // Hide the Three.js mesh while clone animates
    e.mesh.visible = false

    // Rest slot
    const idx  = this.drawnCount++
    const slot = REST_SLOTS[idx] ?? REST_SLOTS[REST_SLOTS.length - 1]

    const wp = i => ({
      left: TUBE_WP[i].x - BALL_VISUAL_R,
      top:  TUBE_WP[i].y - BALL_VISUAL_R,
    })
    const sec = slot.sec

    const tl = gsap.timeline({
      onComplete: () => {
        clone.remove()
        // Remove Three.js mesh from scene
        this.scene.remove(e.mesh)
        e.mesh.geometry.dispose()
        e.mesh.material.dispose()
        this.entries = this.entries.filter(x => x !== e)

        // Permanent rest ball — same canvas texture as the clone
        const rbCnv = document.createElement('canvas')
        rbCnv.width = rbCnv.height = 64
        rbCnv.getContext('2d').drawImage(ballSrc, 0, 0, 64, 64)

        const rb = document.createElement('div')
        rb.className = 'rest-ball rest-ball--latest'
        rb.appendChild(rbCnv)
        rb.style.cssText =
          `left:${slot.left}px;top:${slot.top}px;` +
          `box-shadow:0 2px 6px rgba(0,0,0,0.60),0 0 10px ${e.color}88;`
        this.machineEl.appendChild(rb)
        setTimeout(() => rb.classList.remove('rest-ball--latest'), 2200)

        onSettle(e.number, e.group, e.color)
      }
    })

    const rot = px => Math.round(px * DEG_PER_PX)

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

    if (sec !== 'B') {
      tl.to(clone, { left: wp(2).left, top: wp(2).top,
                     rotation: `+=${rot(TUBE_WP[2].x - TUBE_WP[1].x)}`,
                     duration: 0.42, ease: 'none' })
    }
    if (sec !== 'B' && sec !== 'C') {
      tl.to(clone, { left: wp(3).left, top: wp(3).top,
                     rotation: `+=${rot(TUBE_WP[3].y - TUBE_WP[2].y)}`,
                     duration: 0.24, ease: 'power2.in' })
    }
    if (sec === 'E' || sec === 'F' || sec === 'G' || sec === 'H') {
      tl.to(clone, { left: wp(4).left, top: wp(4).top,
                     rotation: `-=${rot(TUBE_WP[3].x - TUBE_WP[4].x)}`,
                     duration: 0.28, ease: 'none' })
    }
    if (sec === 'F' || sec === 'G' || sec === 'H') {
      tl.to(clone, { left: wp(5).left, top: wp(5).top,
                     rotation: `+=${rot(TUBE_WP[5].y - TUBE_WP[4].y)}`,
                     duration: 0.24, ease: 'power2.in' })
    }
    if (sec === 'G' || sec === 'H') {
      tl.to(clone, { left: wp(6).left, top: wp(6).top,
                     rotation: `+=${rot(TUBE_WP[6].x - TUBE_WP[5].x)}`,
                     duration: 0.28, ease: 'none' })
    }
    if (sec === 'H') {
      tl.to(clone, { left: wp(7).left, top: wp(7).top,
                     rotation: `+=${rot(TUBE_WP[7].y - TUBE_WP[6].y)}`,
                     duration: 0.30, ease: 'power2.in' })
    }

    const entryL = { H: wp(7).left, G: wp(6).left, F: wp(5).left,
                     E: wp(4).left, D: wp(3).left, C: wp(2).left, B: wp(1).left }[sec]
    const entryT = { H: wp(7).top,  G: wp(6).top,  F: wp(5).top,
                     E: wp(4).top,  D: wp(3).top,  C: wp(2).top,  B: wp(1).top  }[sec]
    const hDist = Math.abs(slot.left - entryL)
    const vDist = Math.abs(slot.top  - entryT)

    if (sec === 'H' || sec === 'F' || sec === 'D' || sec === 'B') {
      const rightward = sec === 'B' || sec === 'F'
      const rotStr    = rightward ? `+=${rot(hDist)}` : `-=${rot(hDist)}`
      if (sec === 'H') {
        tl.to(clone, { left: slot.left, rotation: rotStr,
                       duration: Math.max(0.15, hDist / 600), ease: 'power2.out' })
      } else {
        tl.to(clone, { left: slot.left, top: slot.top, rotation: rotStr,
                       duration: Math.max(0.15, hDist / 600), ease: 'power2.out' })
      }
    } else {
      tl.to(clone, { top: slot.top, rotation: `+=${rot(vDist)}`,
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
    // Clear Three.js scene of ball meshes
    this.entries.forEach(e => {
      this.scene.remove(e.mesh)
      e.mesh.material.map?.dispose()
      e.mesh.material.dispose()
    })
    this.machineEl.querySelectorAll('.rest-ball,.drum-ball--clone').forEach(el => el.remove())
    this.entries    = []
    this.drawnCount = 0
    ;[...this.world.bodies].forEach(b => this.world.removeBody(b))
    this.init(numbers)
  }

  // ── Private: physics init ─────────────────────────────────────────────

  _initPhysics() {
    this.world = new CANNON.World()
    this.world.gravity.set(0, 0, 0)
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

  // ── Private: Three.js init ────────────────────────────────────────────

  _initThree() {
    this.scene  = new THREE.Scene()

    // Perspective camera: FOV matches the PERSP projection used in animation-1
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1.0, 0.1, 2000)
    this.camera.position.set(0, 0, PERSP)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setSize(DRUM_SIZE, DRUM_SIZE)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)   // fully transparent background

    // ── Lighting ──
    // Dim blue-grey ambient so dark sides aren't pure black
    this.scene.add(new THREE.AmbientLight(0x445566, 0.55))

    // Key light: upper-left-front — main highlight
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(-60, 140, 210)
    this.scene.add(key)

    // Fill light: right-lower — softens shadows
    const fill = new THREE.DirectionalLight(0x99aaff, 0.45)
    fill.position.set(130, -70, 100)
    this.scene.add(fill)

    // Rim light: back-bottom — separation from dark bg
    const rim = new THREE.DirectionalLight(0x334466, 0.25)
    rim.position.set(0, -160, -130)
    this.scene.add(rim)

    // Shared ball geometry (all balls share one geometry instance)
    this._geo = new THREE.SphereGeometry(BALL_3D_R, 48, 36)

    // Inject canvas just before the cage-overlay so cage lines render above balls
    const canvas = this.renderer.domElement
    Object.assign(canvas.style, {
      position: 'absolute',
      top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none',
      borderRadius: '50%',
    })
    const cageOverlay = this.drumEl.querySelector('.drum-cage-overlay')
    this.drumEl.insertBefore(canvas, cageOverlay ?? null)
  }

  // ── Private: spawn one ball ───────────────────────────────────────────

  _spawn(number) {
    const group = getColumn(number)
    const color = COL_COLORS[group]

    // cannon-es body — starts in bottom hemisphere so balls settle visually
    const body = new CANNON.Body({
      mass: 1, material: this._mat,
      linearDamping: 0.01, angularDamping: 0.05,
    })
    body.addShape(this._shape)
    let x, y, z
    do {
      x = (Math.random() * 2 - 1) * DRUM_INNER_R * 0.65
      y = -(Math.random())         * DRUM_INNER_R * 0.65
      z = (Math.random() * 2 - 1) * DRUM_INNER_R * 0.65
    } while (x*x + y*y + z*z > (DRUM_INNER_R * 0.65) ** 2)
    body.position.set(x, y, z)
    body.velocity.set(0, 0, 0)
    this.world.addBody(body)

    // Three.js mesh with per-ball canvas texture
    const material = new THREE.MeshPhysicalMaterial({
      map:                 this._createBallTexture(number, color),
      roughness:           0.08,
      metalness:           0.04,
      clearcoat:           1.0,
      clearcoatRoughness:  0.07,
      reflectivity:        0.6,
    })
    const mesh = new THREE.Mesh(this._geo, material)
    // Give each ball a random initial orientation so textures don't all face same way
    mesh.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    )
    this.scene.add(mesh)

    this.entries.push({ body, number, group, color, mesh, exiting: false })
  }

  // ── Private: canvas texture for each ball ────────────────────────────
  // Classic bingo-ball look: coloured sphere + white equatorial stripe + number

  _createBallCanvas(number, color) {
    const S   = 256
    const cnv = document.createElement('canvas')
    cnv.width = cnv.height = S
    const ctx = cnv.getContext('2d')

    // Base colour fill
    ctx.fillStyle = color
    ctx.fillRect(0, 0, S, S)

    // White equatorial stripe
    const bandY1 = Math.round(S * 0.355)
    const bandY2 = Math.round(S * 0.645)
    ctx.fillStyle = 'rgba(255,255,255,0.93)'
    ctx.fillRect(0, bandY1, S, bandY2 - bandY1)

    // Thin colour border lines top & bottom of stripe
    ctx.fillStyle = color + 'cc'
    ctx.fillRect(0, bandY1,     S, 3)
    ctx.fillRect(0, bandY2 - 3, S, 3)

    // Number text centred in the stripe
    const numStr   = String(number)
    const fontSize = numStr.length > 1 ? 72 : 90
    ctx.font         = `900 ${fontSize}px Inter, Arial Black, sans-serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle    = color
    ctx.shadowColor  = 'rgba(0,0,0,0.18)'
    ctx.shadowBlur   = 4
    ctx.fillText(numStr, S / 2, S / 2)
    ctx.shadowBlur   = 0

    // Gloss overlay: radial white gradient at top-left
    const gloss = ctx.createRadialGradient(S * 0.28, S * 0.18, 0, S * 0.28, S * 0.18, S * 0.45)
    gloss.addColorStop(0,    'rgba(255,255,255,0.50)')
    gloss.addColorStop(0.35, 'rgba(255,255,255,0.15)')
    gloss.addColorStop(1,    'rgba(255,255,255,0)')
    ctx.fillStyle = gloss
    ctx.fillRect(0, 0, S, S)

    return cnv
  }

  _createBallTexture(number, color) {
    return new THREE.CanvasTexture(this._createBallCanvas(number, color))
  }

  // ── Private: physics forces (identical to animation-1) ───────────────

  _forces() {
    for (const e of this.entries) {
      if (e.exiting) continue
      const b = e.body
      const p = b.position

      if (this._warmup) {
        b.force.y -= 220
        b.velocity.x *= 0.92
        b.velocity.y *= 0.92
        b.velocity.z *= 0.92
      } else {
        b.force.x += (Math.random() - 0.5) * F_TURB
        b.force.y += (Math.random() - 0.5) * F_TURB
        b.force.z += (Math.random() - 0.5) * F_TURB

        const spd2 = b.velocity.x**2 + b.velocity.y**2 + b.velocity.z**2
        if (spd2 < V_MIN * V_MIN) {
          const boost = V_MIN * 1.8
          b.velocity.x += (Math.random() - 0.5) * boost
          b.velocity.y += (Math.random() - 0.5) * boost
          b.velocity.z += (Math.random() - 0.5) * boost
        }
        if (spd2 > V_MAX * V_MAX) {
          const sc = V_MAX / Math.sqrt(spd2)
          b.velocity.x *= sc; b.velocity.y *= sc; b.velocity.z *= sc
        }
      }

      // Spherical wall spring + elastic reflection
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
          b.velocity.x += (Math.random() - 0.5) * 4
          b.velocity.y += (Math.random() - 0.5) * 4
          b.velocity.z += (Math.random() - 0.5) * 4
        }
      }
    }
  }

  // ── Private: Three.js render ──────────────────────────────────────────

  _render3D() {
    for (const e of this.entries) {
      if (e.exiting) continue
      const p = e.body.position
      e.mesh.position.set(p.x, p.y, p.z)

      // Spin the ball continuously so numbers tumble realistically
      e.mesh.rotation.x += 0.012
      e.mesh.rotation.y += 0.009

      // Balls deep behind drum centre fade slightly (replicates animation-1 opacity)
      const deep = p.z < -DRUM_INNER_R * 0.55
      if (deep !== e._wasDeep) {
        e.mesh.material.opacity    = deep ? 0.28 : 1
        e.mesh.material.transparent = deep
        e._wasDeep = deep
      }
    }
    this.renderer.render(this.scene, this.camera)
  }

  // ── Private: periodic velocity kick (keeps motion chaotic) ───────────

  _kick() {
    for (const e of this.entries) {
      if (e.exiting) continue
      e.body.velocity.x += (Math.random() - 0.5) * 38
      e.body.velocity.y += (Math.random() - 0.5) * 38
      e.body.velocity.z += (Math.random() - 0.5) * 38
    }
  }
}
