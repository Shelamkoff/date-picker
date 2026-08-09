import test from 'node:test'
import assert from 'node:assert/strict'
import { createMonthFormatter } from '../dist/core/index.js'

test('month formatter supports textual and numeric displays', () => {
  assert.equal(createMonthFormatter('en-US', 'long')(1), 'January')
  assert.equal(createMonthFormatter('en-US', 'short')(1), 'Jan')
  assert.equal(createMonthFormatter('en-US', 'narrow')(1), 'J')
  assert.equal(createMonthFormatter('en-US', 'numeric')(1), '1')
  assert.equal(createMonthFormatter('en-US', '2-digit')(1), '01')
})

test('month formatter keeps locale-specific labels', () => {
  assert.equal(createMonthFormatter('ru-RU', 'long')(1), 'Январь')
  assert.equal(createMonthFormatter('ru-RU', '2-digit')(12), '12')
})
