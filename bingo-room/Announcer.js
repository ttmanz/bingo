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

// ── Number-call sound sets ─────────────────────────────────────────────────
// traditional : the full bingo-hall call — 'One fat lady — number eight!'
// numbers     : nicknames dropped, 'number' kept — 'Number 8!'
// plain       : nicknames and 'number' dropped — '8!'
// The digits are spoken as words by the speech engine ('54!' → "fifty-four").
export const CALL_SETS = {
  traditional: n => CALLS[n] || `Number ${n}!`,
  numbers:     n => `Number ${n}!`,
  plain:       n => `${n}!`,
}
export const DEFAULT_CALL_SET = 'traditional'

// ── Video announcers ───────────────────────────────────────────────────────
const VIDEO_SRC = {
  a: '/bingo-room/announcer-a.mp4',
  b: '/bingo-room/announcer-b.mp4',
  c: '/bingo-room/announcer-c.mp4',
  d: '/bingo-room/announcer-d.mp4',
  e: '/bingo-room/announcer-e.mp4',
  f: '/bingo-room/announcer-f.mp4',
  g: '/bingo-room/announcer-g.mp4',
  h: '/bingo-room/announcer-h.mp4',
}

// Per-type timing + keying config.
// Every announcer is a headset presenter who genuinely articulates, so there is
// no mic-raise gesture to choreograph: segStart→segEnd is simply the stretch
// where the mouth is most active, and each clip is generated to finish with the
// mouth closed so idleSeek parks near the end.
// idleSeek  : frame to park on when silent (mouth closed, near the end)
// segStart  : start of the talking stretch played while a number is called
// segEnd    : end of that stretch
// bkThresh  : pixels with max(R,G,B) below this are fully transparent
// bkEdge    : soft anti-alias ramp from bkThresh → bkEdge
// wmMask    : optional [x, y, w, h] as fractions of the frame, cleared before
//             keying to erase a generator watermark. Used where the watermark
//             shares rows with the subject, so it cannot simply be cropped off.
//
// All eight clips key at 8/22: their backgrounds are pure black (measured max
// brightness 0) so a low threshold clears them completely, while anything
// higher eats the black headsets.
const KEY = { bkThresh: 8, bkEdge: 22 }
const TALK = { idleSeek: 4.85, segStart: 0.4, segEnd: 2.4 }
const VIDEO_TIMING = {
  a: { ...TALK, ...KEY },
  b: { ...TALK, ...KEY },
  c: { ...TALK, ...KEY },
  // Watermark sits beside her feet (x681-1037, y1786-1887 of 1080x1920) — it
  // overlaps her rows but not her columns, so mask it rather than crop.
  d: { ...TALK, ...KEY, wmMask: [0.615, 0.920, 0.385, 0.080] },
  e: { ...TALK, ...KEY },
  f: { ...TALK, ...KEY },
  g: { ...TALK, ...KEY },
  h: { ...TALK, ...KEY },
}

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
    this._callSet   = DEFAULT_CALL_SET
    this._voice     = null
    this._speaking  = false
    this._unlocked  = false
    this._speakGen  = 0        // guards stale onerror callbacks

    this._videoKeyRafId  = null    // rAF handle for canvas key loop
    this._videoKeyActive = false
    this._idlePause      = false   // when true: video pauses between speeches
    this._idleSeek       = 4.5    // seconds to seek to when going idle (mic-down pose)
    this._speakSegStart  = 2.4    // seconds — she turns & starts raising mic
    this._speakSegEnd    = 4.4    // seconds — mic fully lowered again
    this._segWatcher     = null   // timeupdate handler ref for cleanup
    this._bkThresh       = 25     // black-key threshold (per type)
    this._bkEdge         = 55     // black-key soft ramp edge
    this._wmMask         = null   // [x,y,w,h] fractions cleared before keying

    speechSynthesis.onvoiceschanged = () => { this._voice = pickVoice() }
    this._voice = pickVoice()

    // Chrome bug: speechSynthesis silently pauses after ~15 s of idle.
    // Periodic resume() keeps it alive so audio never goes missing mid-draw.
    this._synthHeartbeat = setInterval(() => {
      if ('speechSynthesis' in window && !this._speaking) speechSynthesis.resume()
    }, 10000)

    this._build()
    this._unlock()
  }

  // ── Switch announcer type (a–h) ───────────────────────────────────────────
  setType(type) {
    if (!type || !['a','b','c','d','e','f','g','h'].includes(type)) return
    this._el.classList.remove(`announcer-${this._type}`)
    this._type = type
    this._el.classList.add(`announcer-${this._type}`)
    this._applyVideoTiming(type)
    this._buildVideoContent(type)
  }

  // ── Switch number-call sound set (traditional | numbers | plain) ──────────
  setCallSet(name) {
    if (name && CALL_SETS[name]) this._callSet = name
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
    this._wmMask        = t.wmMask   ?? null
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
    this._applyVideoTiming(this._type)
    this._buildVideoContent(this._type)
  }

  // ── Private: build canvas+video content ───────────────────────────────────
  _buildVideoContent(type) {
    this._stopVideoKey()

    this._el.innerHTML = ''

    // Hidden video element — drives the canvas
    const video = document.createElement('video')
    video.src         = VIDEO_SRC[type]
    video.autoplay    = true
    video.loop        = true
    video.muted       = true
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

    this._startVideoKey()

    // Ensure video plays (browser autoplay may be blocked until user interaction)
    const tryPlay = () => video.play().catch(() => {})
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
        // Erase a burnt-in watermark before keying, so it never reaches the ramp
        const m = this._wmMask
        if (m) ctx.clearRect(Math.floor(m[0]*400), Math.floor(m[1]*680),
                             Math.ceil(m[2]*400), Math.ceil(m[3]*680))
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

  // ── Public: say arbitrary text ────────────────────────────────────────────
  sayText(text, onDone) {
    if (this._speaking) speechSynthesis.cancel()
    this._speaking = true
    this._speak(text, () => {
      this._speaking = false
      if (onDone) onDone()
    })
  }

  // ── Public: announce a drawn ball number ──────────────────────────────────
  announce(number) {
    if (this._speaking) speechSynthesis.cancel()
    this._speaking = true
    this._speak(CALL_SETS[this._callSet](number), () => {
      this._speaking = false
    })
  }

  // ── Public: enable idle-pause mode (video pauses between speeches) ────────
  enableIdlePause(idleSeek = 4.5) {
    this._idlePause = true
    this._idleSeek  = idleSeek
    if (!this._speaking) this._parkVideo()
  }

  // ── Public: disable idle-pause mode (video loops freely) ─────────────────
  disableIdlePause() {
    this._idlePause = false
    if (this._video) {
      this._video.loop = true
      this._video.play().catch(() => {})
    }
  }

  // ── Private: seek to idle frame and pause ─────────────────────────────────
  _parkVideo() {
    if (!this._video) return
    this._video.loop = false
    this._video.currentTime = this._idleSeek
    this._video.addEventListener('seeked', () => {
      if (this._idlePause && !this._speaking) this._video?.pause()
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
    // Wake Chrome's speech engine — it pauses silently after ~15 s of idle
    speechSynthesis.resume()

    // If in idle-pause mode, play only the hand-raise→lower segment
    if (this._idlePause && this._video) {
      this._clearSegWatcher()
      this._video.loop = false
      this._video.currentTime = this._speakSegStart

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
      if (this._idlePause) this._parkVideo()
      onEnd()
    }
    const minMs = Math.max(1200, text.split(/\s+/).length * 380)
    let minTimer = setTimeout(done, minMs)
    utt.onend   = () => { clearTimeout(minTimer); done() }
    utt.onerror = () => { /* minTimer handles it */ }
    speechSynthesis.speak(utt)
  }

  reset() {
    speechSynthesis.cancel()
    this._speaking = false
    this._clearSegWatcher()
  }
}
