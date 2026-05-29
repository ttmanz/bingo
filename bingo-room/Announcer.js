import { gsap } from 'gsap'

// Traditional 90-ball bingo call phrases
const CALLS = {
  1:'Kelly\'s eye — number one!', 2:'One little duck — number two!',
  3:'Cup of tea — number three!', 4:'Knock at the door — number four!',
  5:'Man alive — number five!', 7:'Lucky seven!',
  8:'One fat lady — number eight!', 11:'Legs eleven!',
  13:'Unlucky for some — thirteen!', 21:'Key of the door — twenty one!',
  22:'Two little ducks — twenty two!', 88:'Two fat ladies — eighty eight!',
  90:'Top of the shop — ninety!',
}
const say = n => CALLS[n] || `Number ${n}!`

// ── Video announcers ───────────────────────────────────────────────────────
// Any type listed here uses canvas black-key compositing instead of PNGs.
// Add new types here as their videos are generated and uploaded.
const VIDEO_SRC = {
  a: '/bingo-room/announcer-a.mp4',
  b: '/bingo-room/announcer-b.mp4',
  c: '/bingo-room/announcer-c.mp4',
  d: '/bingo-room/announcer-d.mp4',
  e: '/bingo-room/announcer-e.mp4',
  f: '/bingo-room/announcer-f.mp4',
  g: '/bingo-room/announcer-g.mp4',
}

// Per-type timing + keying config.
// idleSeek  : frame to park on when silent (mic lowered, natural stance)
// segStart  : start of raise gesture (she turns & lifts mic)
// segEnd    : end of lower gesture (mic fully back down)
// bkThresh  : pixels with max(R,G,B) below this are fully transparent
// bkEdge    : soft anti-alias ramp from bkThresh → bkEdge
// Lower bkThresh = more conservative keying (keeps dark clothing). Default 25/55.
const VIDEO_TIMING = {
  a: { idleSeek: 4.5, segStart: 2.4, segEnd: 4.4, bkThresh: 25, bkEdge: 55 },  // blue dress, blonde
  b: { idleSeek: 4.5, segStart: 2.4, segEnd: 4.4, bkThresh: 12, bkEdge: 35 },  // dark plaid skirt — lower threshold to preserve clothing
  c: { idleSeek: 4.5, segStart: 2.4, segEnd: 4.4, bkThresh:  8, bkEdge: 25 },  // dark hair/clothing — very conservative keying
  d: { idleSeek: 4.5, segStart: 2.4, segEnd: 4.4, bkThresh: 25, bkEdge: 55 },  // tune after frame analysis
  e: { idleSeek: 4.5, segStart: 2.4, segEnd: 4.4, bkThresh: 25, bkEdge: 55 },  // tune after frame analysis
  f: { idleSeek: 4.5, segStart: 2.4, segEnd: 4.4, bkThresh: 25, bkEdge: 55 },  // tune after frame analysis
  g: { idleSeek: 4.5, segStart: 2.4, segEnd: 4.4, bkThresh: 25, bkEdge: 55 },  // tune after frame analysis
}

// ── PNG announcers (types b / c / d) ──────────────────────────────────────
const IMG = (type, pose) => `/bingo-room/announcers/ann-${type}-${pose}.png`

// Frame sequences from the announcer-demo tool
// 0 = closed, 1 = talking, 2 = excited
// TICKS_PER_STEP at ~60fps: 6 ticks ≈ 100ms per step — natural speech rhythm
const SEQS = {
  talk: [0,0, 1,1,1, 0,0, 1,1, 0, 1,1,1,1, 0,0,0, 1,1, 0],
  win:  [2,2,2, 1, 2,2, 1, 2,2,2, 1,1, 2,2, 1, 2,2,2],
}
const TICKS_PER_STEP = 6
const POSES = ['closed', 'talking', 'excited']

function pickVoice() {
  const voices = speechSynthesis.getVoices()
  const prefer = ['Samantha','Karen','Moira','Tessa','Victoria',
                  'Google UK English Female','Microsoft Zira','Alice']
  for (const name of prefer) {
    const v = voices.find(v => v.name.includes(name))
    if (v) return v
  }
  return voices.find(v => /en[-_]/i.test(v.lang) && v.name.toLowerCase().includes('female'))
      || voices.find(v => /en[-_]/i.test(v.lang))
      || null
}

export class Announcer {
  constructor() {
    this._type      = 'a'
    this._voice     = null
    this._speaking  = false
    this._unlocked  = false
    this._rafId     = null     // rAF handle for PNG frame sequence
    this._tick      = 0
    this._seq       = null     // current PNG frame sequence
    this._speakGen  = 0        // guards stale onerror callbacks

    this._videoMode      = false   // true when type has a VIDEO_SRC entry
    this._videoKeyRafId  = null    // rAF handle for canvas key loop
    this._videoKeyActive = false
    this._idlePause      = false   // when true: video pauses between speeches
    this._idleSeek       = 4.5    // seconds to seek to when going idle (mic-down standing pose)
    this._speakSegStart  = 2.4    // seconds — she turns & starts raising mic
    this._speakSegEnd    = 4.4    // seconds — mic fully lowered again
    this._segWatcher     = null   // timeupdate handler ref for cleanup
    this._bkThresh       = 25     // black-key threshold (per type, set by _applyVideoTiming)
    this._bkEdge         = 55     // black-key soft ramp edge

    speechSynthesis.onvoiceschanged = () => { this._voice = pickVoice() }
    this._voice = pickVoice()

    this._build()
    this._idleAnim()
    this._unlock()
  }

  // ── Switch announcer type (a / b / c / d) ─────────────────────────────────
  setType(type) {
    if (!type || !['a','b','c','d','e','f','g'].includes(type)) return
    this._el.classList.remove(`announcer-${this._type}`)
    this._type = type
    this._el.classList.add(`announcer-${this._type}`)
    if (type in VIDEO_SRC) {
      this._applyVideoTiming(type)
      this._buildVideoContent(type)
    } else {
      this._buildImgContent(type)
    }
  }

  // ── Private: apply per-type timing config ────────────────────────────────
  _applyVideoTiming(type) {
    const t = VIDEO_TIMING[type]
    if (!t) return
    this._idleSeek      = t.idleSeek
    this._speakSegStart = t.segStart
    this._speakSegEnd   = t.segEnd
    this._bkThresh      = t.bkThresh ?? 25
    this._bkEdge        = t.bkEdge   ?? 55
  }

  // ── Private: image swap (PNG mode only) ───────────────────────────────────
  _setImg(pose) {
    if (this._videoMode) return          // video provides its own frames
    if (this._img) this._img.src = IMG(this._type, pose)
  }

  // ── Private: rAF-based PNG frame sequence ─────────────────────────────────
  _startSeq(seqName) {
    if (this._videoMode) return          // video already has motion
    this._stopSeq()
    this._seq  = SEQS[seqName]
    this._tick = 0
    const step = () => {
      this._tick++
      const seqIdx   = Math.floor(this._tick / TICKS_PER_STEP) % this._seq.length
      const frameIdx = this._seq[seqIdx]
      this._setImg(POSES[frameIdx])
      this._rafId = requestAnimationFrame(step)
    }
    this._rafId = requestAnimationFrame(step)
  }

  _stopSeq() {
    if (this._videoMode) return
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null }
    this._seq  = null
    this._tick = 0
    this._setImg('closed')
  }

  // ── Private: speech unlock ────────────────────────────────────────────────
  _unlock() {
    const handler = () => {
      if (this._unlocked) return
      this._unlocked = true
      const utt = new SpeechSynthesisUtterance('')
      utt.volume = 0
      speechSynthesis.speak(utt)
      document.removeEventListener('click',      handler)
      document.removeEventListener('keydown',    handler)
      document.removeEventListener('touchstart', handler)
      document.removeEventListener('mousemove',  handler)
    }
    document.addEventListener('click',      handler)
    document.addEventListener('keydown',    handler)
    document.addEventListener('touchstart', handler)
    document.addEventListener('mousemove',  handler, { once: true })
  }

  // ── Private: initial DOM build ────────────────────────────────────────────
  _build() {
    const el = document.createElement('div')
    el.id        = 'announcer'
    el.className = `announcer announcer-${this._type}`
    document.body.appendChild(el)
    this._el = el

    if (this._type in VIDEO_SRC) {
      this._applyVideoTiming(this._type)
      this._buildVideoContent(this._type)
    } else {
      this._buildImgContent(this._type)
    }
  }

  // ── Private: build PNG img content ────────────────────────────────────────
  _buildImgContent(type) {
    this._stopVideoKey()
    this._videoMode = false
    this._el.innerHTML = `<img class="announcer-img" src="${IMG(type, 'closed')}" alt="announcer"/>`
    this._img    = this._el.querySelector('.announcer-img')
    this._canvas = null
    this._ctx    = null
    this._video  = null
  }

  // ── Private: build canvas+video content ───────────────────────────────────
  _buildVideoContent(type) {
    this._stopVideoKey()
    this._videoMode = true

    // Remove old content
    this._el.innerHTML = ''

    // Hidden video element — drives the canvas
    const video = document.createElement('video')
    video.src        = VIDEO_SRC[type]
    video.autoplay   = true
    video.loop       = true
    video.muted      = true
    video.playsInline = true
    video.style.display = 'none'

    // Canvas fills the announcer div (sized by room.js updateStageScale)
    const canvas = document.createElement('canvas')
    canvas.className = 'announcer-img'
    canvas.width  = 400   // 2× internal resolution for crispness
    canvas.height = 680

    this._el.appendChild(video)
    this._el.appendChild(canvas)
    this._video  = video
    this._canvas = canvas
    this._ctx    = canvas.getContext('2d', { willReadFrequently: true })
    this._img    = null   // no img element in video mode

    // Start the keying loop
    this._startVideoKey()

    // Ensure video plays (browser autoplay may be blocked until user interaction)
    const tryPlay = () => { if (this._videoMode) video.play().catch(() => {}) }
    if (video.readyState >= 2) tryPlay()
    else video.addEventListener('canplay', tryPlay, { once: true })
    setTimeout(tryPlay, 800)
  }

  // ── Private: black-key canvas compositing loop ────────────────────────────
  _startVideoKey() {
    this._videoKeyActive = true
    const loop = () => {
      if (!this._videoKeyActive) return
      const v = this._video, ctx = this._ctx
      if (v && v.readyState >= 2 && ctx) {
        ctx.drawImage(v, 0, 0, 400, 680)
        const imgData = ctx.getImageData(0, 0, 400, 680)
        const d = imgData.data
        const thresh = this._bkThresh, edge = this._bkEdge
        for (let i = 0; i < d.length; i += 4) {
          const bright = Math.max(d[i], d[i+1], d[i+2])
          if (bright < thresh) {
            d[i+3] = 0
          } else if (bright < edge) {
            d[i+3] = Math.round(255 * (bright - thresh) / (edge - thresh))
          }
        }
        ctx.putImageData(imgData, 0, 0)
      }
      this._videoKeyRafId = requestAnimationFrame(loop)
    }
    this._videoKeyRafId = requestAnimationFrame(loop)
  }

  _stopVideoKey() {
    this._videoKeyActive = false
    if (this._videoKeyRafId) {
      cancelAnimationFrame(this._videoKeyRafId)
      this._videoKeyRafId = null
    }
    if (this._video) {
      this._clearSegWatcher()
      this._video.pause()
      this._video = null
    }
  }

  // No idle animation — announcer stays perfectly still (video provides its own motion)
  _idleAnim() {}

  // ── Public: say arbitrary text ────────────────────────────────────────────
  sayText(text, onDone) {
    if (this._speaking) { speechSynthesis.cancel(); this._stopSeq() }
    this._speaking = true
    this._startSeq(/bingo|line!/i.test(text) ? 'win' : 'talk')
    this._speak(text, () => {
      this._speaking = false
      this._stopSeq()
      if (onDone) onDone()
    })
  }

  // ── Public: announce a drawn ball number ──────────────────────────────────
  announce(number) {
    if (this._speaking) { speechSynthesis.cancel(); this._stopSeq() }
    this._speaking = true
    this._startSeq('talk')
    this._speak(say(number), () => {
      this._speaking = false
      this._stopSeq()
    })
  }

  // ── Public: enable idle-pause mode (video pauses between speeches) ────────
  // Call after walk-in zoom completes. idleSeek = seconds to park on between calls.
  enableIdlePause(idleSeek = 4.5) {
    this._idlePause = true
    this._idleSeek  = idleSeek
    if (!this._speaking) this._parkVideo()
  }

  // ── Public: disable idle-pause mode (video loops freely) ─────────────────
  disableIdlePause() {
    this._idlePause = false
    if (this._video && this._videoMode) {
      this._video.loop = true
      this._video.play().catch(() => {})
    }
  }

  // ── Private: seek to idle frame and pause ─────────────────────────────────
  _parkVideo() {
    if (!this._video || !this._videoMode) return
    this._video.loop = false
    this._video.currentTime = this._idleSeek
    this._video.addEventListener('seeked', () => {
      if (this._idlePause && !this._speaking) this._video.pause()
    }, { once: true })
  }

  // ── Private: remove segment timeupdate watcher ───────────────────────────
  _clearSegWatcher() {
    if (this._segWatcher && this._video) {
      this._video.removeEventListener('timeupdate', this._segWatcher)
    }
    this._segWatcher = null
  }

  _speak(text, onEnd) {
    if (!('speechSynthesis' in window)) { onEnd(); return }

    // If in idle-pause mode, play only the hand-raise→lower segment
    if (this._idlePause && this._video && this._videoMode) {
      this._clearSegWatcher()
      this._video.loop = false
      this._video.currentTime = this._speakSegStart

      // Pause the video once it reaches the end of the lower gesture
      this._segWatcher = () => {
        if (this._video && this._video.currentTime >= this._speakSegEnd) {
          this._clearSegWatcher()
          this._video.pause()
        }
      }
      this._video.addEventListener('timeupdate', this._segWatcher)
      this._video.play().catch(() => {})
    }

    const gen = ++this._speakGen
    const utt = new SpeechSynthesisUtterance(text)
    if (!this._voice) this._voice = pickVoice()
    if (this._voice)  utt.voice = this._voice
    utt.pitch = 1.15; utt.rate = 0.88; utt.volume = 1
    const done = () => {
      if (this._speakGen !== gen) return
      // Park video back to idle frame once speech ends
      if (this._idlePause) this._parkVideo()
      onEnd()
    }
    const minMs = Math.max(1200, text.split(/\s+/).length * 380)
    let minTimer = setTimeout(done, minMs)
    utt.onend   = () => { clearTimeout(minTimer); done() }
    utt.onerror = () => { /* minTimer handles it */ }
    speechSynthesis.speak(utt)
  }

  // ── Public: freeze video at a "standing still" frame ─────────────────────
  freezeVideo(seekTime = 4.0) {
    if (!this._video || !this._videoMode) return
    this._video.loop = false
    this._video.currentTime = seekTime
    this._video.addEventListener('seeked', () => {
      if (this._videoMode) this._video.pause()
    }, { once: true })
  }

  // ── Public: unfreeze — restart video from beginning ───────────────────────
  unfreezeVideo() {
    if (!this._video || !this._videoMode) return
    this._video.loop = true
    this._video.currentTime = 0
    this._video.play().catch(() => {})
  }

  reset() {
    speechSynthesis.cancel()
    this._speaking = false
    this._clearSegWatcher()
    this._stopSeq()
  }
}
