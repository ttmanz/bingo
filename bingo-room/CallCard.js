import { gsap } from 'gsap'
import { COL_COLORS, getColumn } from '/bingo-room/bingoLogic.js'
import { animateBallDrop } from '/bingo-room/numberBall.js'

const RECENT_MAX = 10

export class CallCard {
  constructor(containerEl, ballEl) {
    this.containerEl = containerEl
    this.ballEl      = ballEl
    this.called      = new Set()
    this.lastCalled  = null
    this._build()
  }

  _build() {
    this.containerEl.innerHTML = `
      <div class="call-card">
        <div class="call-card-header">
          <span class="call-card-title">Called Numbers</span>
          <span class="call-card-counter"><span class="cc-count">0</span>&thinsp;/&thinsp;90</span>
        </div>
        <div class="call-card-grid"></div>
        <div class="call-card-recent">
          <div class="cc-recent-label">RECENT CALLS</div>
          <div class="cc-recent-row"></div>
        </div>
      </div>
    `

    const grid = this.containerEl.querySelector('.call-card-grid')
    for (let n = 1; n <= 90; n++) {
      const el = document.createElement('div')
      el.className = 'cc-cell'
      el.dataset.n = n
      el.textContent = n
      grid.appendChild(el)
    }

    this._countEl  = this.containerEl.querySelector('.cc-count')
    this._recentEl = this.containerEl.querySelector('.cc-recent-row')
  }

  display(number) {
    this.called.add(number)
    this.lastCalled = number

    // ball display
    const group = getColumn(number)
    const color = COL_COLORS[group]
    const numEl = this.ballEl.querySelector('.ball-number')
    if (numEl) numEl.textContent = number
    animateBallDrop(this.ballEl, color)

    // counter
    this._countEl.textContent = this.called.size

    // grid — clear previous last-called, mark new
    this.containerEl.querySelectorAll('.cc-cell.cc-last').forEach(el => el.classList.remove('cc-last'))
    const cell = this.containerEl.querySelector(`.cc-cell[data-n="${number}"]`)
    if (cell) {
      cell.classList.add('cc-called', 'cc-last')
      gsap.fromTo(cell, { scale: 1.35 }, { scale: 1, duration: 0.45, ease: 'back.out(1.4)' })
    }

    // recent calls strip
    const chip = document.createElement('div')
    chip.className = 'cc-recent-chip cc-recent-new'
    chip.textContent = number
    this._recentEl.querySelectorAll('.cc-recent-new').forEach(el => el.classList.remove('cc-recent-new'))
    this._recentEl.insertBefore(chip, this._recentEl.firstChild)
    while (this._recentEl.children.length > RECENT_MAX) {
      this._recentEl.removeChild(this._recentEl.lastChild)
    }
    gsap.fromTo(chip, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(1.7)' })
  }

  reset() {
    this.called.clear()
    this.lastCalled = null
    const numEl = this.ballEl.querySelector('.ball-number')
    if (numEl) numEl.textContent = '--'
    this.ballEl.style.cssText = ''
    this._build()
  }
}
