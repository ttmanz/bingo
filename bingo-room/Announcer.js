import { gsap } from 'gsap'

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
    this._voice    = null
    this._mouthTl  = null
    this._speaking = false
    this._unlocked = false

    speechSynthesis.onvoiceschanged = () => { this._voice = pickVoice() }
    this._voice = pickVoice()

    this._build()
    this._idleAnim()
    this._unlock()
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
    el.id = 'announcer'
    el.className = 'announcer'
    el.innerHTML = `
      <div class="ann-bubble" id="ann-bubble">
        <span class="ann-bubble-num" id="ann-bubble-num"></span>
      </div>
      <img class="announcer-img" src="/announcer.png" alt="announcer"/>
    `
    document.body.appendChild(el)
    this._el        = el
    this._bubble    = el.querySelector('#ann-bubble')
    this._bubbleNum = el.querySelector('#ann-bubble-num')
  }

  _idleAnim() {
    gsap.to(this._el, {
      y: -7, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1,
    })
  }

  sayText(text, onDone) {
    if (this._speaking) speechSynthesis.cancel()
    this._speaking = true
    this._bubbleNum.textContent = text
    gsap.fromTo(this._bubble,
      { opacity: 0, scale: 0.4, y: 12 },
      { opacity: 1, scale: 1,   y: 0, duration: 0.4, ease: 'back.out(1.7)' }
    )
    gsap.timeline()
      .to(this._el, { y: '-=10', duration: 0.2, ease: 'power2.out' })
      .to(this._el, { y: '+=10', duration: 0.3, ease: 'bounce.out' })
    this._speak(text, () => {
      this._speaking = false
      gsap.to(this._bubble, { opacity: 0, scale: 0.75, duration: 0.45, delay: 0.4 })
      if (onDone) onDone()
    })
  }

  announce(number) {
    if (this._speaking) speechSynthesis.cancel()
    this._speaking = true

    this._bubbleNum.textContent = number
    gsap.fromTo(this._bubble,
      { opacity: 0, scale: 0.4, y: 12 },
      { opacity: 1, scale: 1,   y: 0, duration: 0.4, ease: 'back.out(1.7)' }
    )

    gsap.timeline()
      .to(this._el, { y: '-=14', duration: 0.18, ease: 'power2.out' })
      .to(this._el, { y: '+=14', duration: 0.28, ease: 'bounce.out' })

    this._speak(say(number), () => {
      this._speaking = false
      gsap.to(this._bubble, { opacity: 0, scale: 0.75, duration: 0.45, delay: 0.6 })
    })
  }

  _speak(text, onEnd) {
    if (!('speechSynthesis' in window)) { onEnd(); return }
    const utt = new SpeechSynthesisUtterance(text)
    if (!this._voice) this._voice = pickVoice()
    if (this._voice) utt.voice = this._voice
    utt.pitch = 1.15; utt.rate = 0.88; utt.volume = 1
    utt.onend   = onEnd
    utt.onerror = onEnd
    speechSynthesis.speak(utt)
  }

  reset() { speechSynthesis.cancel(); this._speaking = false }
}
