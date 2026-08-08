export type WheelMotionPhase = 'idle' | 'moving' | 'snapping'

export interface WheelMotionOptions {
  readonly write: (position: number) => void
  readonly requestFrame: (callback: FrameRequestCallback) => void
  readonly responseTime?: number
  readonly epsilon?: number
  readonly reducedMotion?: boolean
}

interface Completion {
  readonly generation: number
  readonly callback: (position: number) => void
}

/**
 * Generation-aware motion controller used by wheel columns.
 * A new input generation always invalidates a pending snap completion.
 */
export class WheelMotion {
  #write: (position: number) => void
  #requestFrame: (callback: FrameRequestCallback) => void
  #responseTime: number
  #epsilon: number
  #reducedMotion: boolean
  #position = 0
  #target = 0
  #generation = 0
  #animationToken = 0
  #lastFrame = 0
  #framePending = false
  #phase: WheelMotionPhase = 'idle'
  #completion: Completion | null = null

  constructor(options: WheelMotionOptions) {
    this.#write = options.write
    this.#requestFrame = options.requestFrame
    this.#responseTime = normalizePositive(options.responseTime, 64)
    this.#epsilon = normalizePositive(options.epsilon, 0.25)
    this.#reducedMotion = options.reducedMotion ?? false
  }

  get position(): number {
    return this.#position
  }

  get target(): number {
    return this.#target
  }

  get generation(): number {
    return this.#generation
  }

  get phase(): WheelMotionPhase {
    return this.#phase
  }

  get isMoving(): boolean {
    return this.#phase !== 'idle'
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.#reducedMotion === reducedMotion) return
    this.#reducedMotion = reducedMotion
    if (reducedMotion && this.isMoving) this.#finishImmediately()
  }

  /** Adopt an externally changed position without writing it back. */
  adopt(position: number): number {
    const next = finiteOr(position, this.#position)
    this.#invalidate()
    this.#position = next
    this.#target = next
    return this.#generation
  }

  /** Set a programmatic position and invalidate every active interaction. */
  reset(position: number, write = true): number {
    const next = finiteOr(position, this.#position)
    this.#invalidate()
    this.#position = next
    this.#target = next
    if (write) this.#write(next)
    return this.#generation
  }

  cancel(): number {
    this.#invalidate()
    this.#target = this.#position
    return this.#generation
  }

  input(delta: number, clamp: (position: number) => number): number {
    if (!Number.isFinite(delta) || delta === 0) return this.#generation

    this.#generation += 1
    this.#completion = null
    this.#phase = 'moving'
    this.#target = finiteOr(clamp(this.#target + delta), this.#target)

    if (this.#reducedMotion) {
      this.#position = this.#target
      this.#write(this.#position)
      this.#phase = 'idle'
      return this.#generation
    }

    this.#ensureAnimation()
    return this.#generation
  }

  snap(
    target: number,
    generation: number,
    onComplete: (position: number) => void,
  ): boolean {
    if (generation !== this.#generation) return false

    this.#target = finiteOr(target, this.#target)
    this.#completion = { generation, callback: onComplete }
    this.#phase = 'snapping'

    if (this.#reducedMotion || Math.abs(this.#target - this.#position) <= this.#epsilon) {
      this.#finishImmediately()
      return true
    }

    this.#ensureAnimation()
    return true
  }

  #invalidate(): void {
    this.#generation += 1
    this.#animationToken += 1
    this.#lastFrame = 0
    this.#framePending = false
    this.#phase = 'idle'
    this.#completion = null
  }

  #ensureAnimation(): void {
    if (this.#framePending) return
    this.#framePending = true
    const token = ++this.#animationToken
    this.#requestFrame(timestamp => {
      this.#framePending = false
      this.#animate(token, timestamp)
    })
  }

  #animate(token: number, timestamp: number): void {
    if (token !== this.#animationToken || this.#phase === 'idle') return

    const elapsed = this.#lastFrame === 0
      ? 16.67
      : Math.min(50, Math.max(1, timestamp - this.#lastFrame))
    this.#lastFrame = timestamp

    const distance = this.#target - this.#position
    if (Math.abs(distance) <= this.#epsilon) {
      this.#finishImmediately()
      return
    }

    const interpolation = 1 - Math.exp(-elapsed / this.#responseTime)
    this.#position += distance * interpolation
    this.#write(this.#position)
    this.#framePending = true
    this.#requestFrame(nextTimestamp => {
      this.#framePending = false
      this.#animate(token, nextTimestamp)
    })
  }

  #finishImmediately(): void {
    const completion = this.#completion
    this.#animationToken += 1
    this.#lastFrame = 0
    this.#framePending = false
    this.#position = this.#target
    this.#write(this.#position)
    this.#phase = 'idle'
    this.#completion = null

    if (completion && completion.generation === this.#generation) {
      completion.callback(this.#position)
    }
  }
}

function normalizePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
