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

const IMG = (type, pose) => `/bingo-room/announcers/ann-${type}-${pose}.png`

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
    this._type     = 'a'
    this._voice    = null
    this._speaking = false
    this._unlocked = false

    speechSynthesis.onvoiceschanged = () => { this._voice = pickVoice() }
    this._voice = pickVoice()

    this._build()
    this._idleAnim()
    this._unlock()
  }

  // Switch to a different announcer character (a / b / c / d)
  setType(type) {
    if (!type || !['a','b','c','d'].includes(type)) return
    this._type = type
    this._setImg('closed')
  }

  _setImg(pose) {
    if (this._img) this._img.src = IMG(this._type, pose)
  }

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
    }
    document.addEventListener('click',      handler)
    document.addEventListener('keydown',    handler)
    document.addEventListener('touchstart', handler)
  }

  _build() {
    const el = document.createElement('div')
    el.id        = 'announcer'
    el.className = 'announcer'
    // No speech bubble — image only
    el.innerHTML = `<img class="announcer-img" src="${IMG(this._type, 'closed')}" alt="announcer"/>`
    document.body.appendChild(el)
    this._el  = el
    this._img = el.querySelector('.announcer-img')
  }

  // Gentle idle float — the only continuous animation
  _idleAnim() {
    gsap.to(this._el, {
      y: -6, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1,
    })
  }

  // Say arbitrary text, swap to talking/excited pose, back to closed when done
  sayText(text, onDone) {
    if (this._speaking) speechSynthesis.cancel()
    this._speaking = true
    // Excited pose for BINGO / LINE announcements, talking pose for everything else
    this._setImg(/bingo|line!/i.test(text) ? 'excited' : 'talking')
    this._speak(text, () => {
      this._speaking = false
      this._setImg('closed')
      if (onDone) onDone()
    })
  }

  // Announce a drawn ball number
  announce(number) {
    if (this._speaking) speechSynthesis.cancel()
    this._speaking = true
    this._setImg('talking')
    this._speak(say(number), () => {
      this._speaking = false
      this._setImg('closed')
    })
  }

  _speak(text, onEnd) {
    if (!('speechSynthesis' in window)) { onEnd(); return }
    const utt = new SpeechSynthesisUtterance(text)
    if (!this._voice) this._voice = pickVoice()
    if (this._voice)  utt.voice = this._voice
    utt.pitch = 1.15; utt.rate = 0.88; utt.volume = 1
    utt.onend   = onEnd
    utt.onerror = onEnd
    speechSynthesis.speak(utt)
  }

  reset() {
    speechSynthesis.cancel()
    this._speaking = false
    this._setImg('closed')
  }
}
