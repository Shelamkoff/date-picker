import test from 'node:test'
import assert from 'node:assert/strict'
import { WheelMotion } from '../dist/dom/WheelMotion.js'

function createHarness({ reducedMotion = false } = {}) {
  const frames = []
  const writes = []
  let timestamp = 0
  const motion = new WheelMotion({
    write(position) { writes.push(position) },
    requestFrame(callback) { frames.push(callback) },
    responseTime: 32,
    epsilon: 0.01,
    reducedMotion,
  })

  function flush(limit = 500) {
    let count = 0
    while (frames.length) {
      if (count++ > limit) throw new Error('animation did not settle')
      const callback = frames.shift()
      timestamp += 16.67
      callback(timestamp)
    }
  }

  return { motion, writes, frames, flush }
}

test('new input invalidates an older pending snap completion', () => {
  const { motion, flush } = createHarness()
  const completed = []

  const firstGeneration = motion.input(40, value => value)
  motion.snap(40, firstGeneration, value => completed.push(['old', value]))

  const secondGeneration = motion.input(40, value => value)
  assert.notEqual(secondGeneration, firstGeneration)
  motion.snap(80, secondGeneration, value => completed.push(['new', value]))
  flush()

  assert.deepEqual(completed.map(([label]) => label), ['new'])
  assert.equal(Math.round(motion.position), 80)
  assert.equal(motion.phase, 'idle')
})

test('wheel input accumulates while an animation is running', () => {
  const { motion, flush } = createHarness()
  motion.input(20, value => value)
  motion.input(20, value => value)
  motion.input(-5, value => value)
  const generation = motion.generation
  motion.snap(35, generation, () => {})
  flush()
  assert.ok(Math.abs(motion.position - 35) < 0.01)
})

test('reduced motion writes the target immediately', () => {
  const { motion, writes } = createHarness({ reducedMotion: true })
  let completed = false
  const generation = motion.input(40, value => value)
  motion.snap(40, generation, () => { completed = true })
  assert.equal(motion.position, 40)
  assert.equal(writes.at(-1), 40)
  assert.equal(completed, true)
})


test('multiple inputs before the first frame schedule one animation loop', () => {
  const { motion, frames, flush } = createHarness()
  motion.input(10, value => value)
  motion.input(10, value => value)
  motion.input(10, value => value)
  assert.equal(frames.length, 1)
  const generation = motion.generation
  motion.snap(30, generation, () => {})
  flush()
  assert.ok(Math.abs(motion.position - 30) < 0.01)
})
