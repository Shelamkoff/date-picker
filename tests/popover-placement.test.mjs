import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePopoverVerticalPlacement } from '../dist/dom/PopoverPlacement.js'

test('popover stays below when it fits below the anchor', () => {
  assert.deepEqual(resolvePopoverVerticalPlacement({
    anchorTop: 100,
    anchorBottom: 144,
    popoverHeight: 240,
    viewportHeight: 800,
  }), {
    openAbove: false,
    maxHeight: 641,
  })
})

test('popover chooses the larger side and constrains its height on a short viewport', () => {
  assert.deepEqual(resolvePopoverVerticalPlacement({
    anchorTop: 145,
    anchorBottom: 189,
    popoverHeight: 260,
    viewportHeight: 320,
  }), {
    openAbove: true,
    maxHeight: 130,
  })
})

test('popover remains below when the available spaces are equal', () => {
  assert.deepEqual(resolvePopoverVerticalPlacement({
    anchorTop: 160,
    anchorBottom: 160,
    popoverHeight: 300,
    viewportHeight: 320,
    gap: 0,
    viewportPadding: 0,
  }), {
    openAbove: false,
    maxHeight: 160,
  })
})

test('popover placement tolerates non-finite geometry', () => {
  assert.deepEqual(resolvePopoverVerticalPlacement({
    anchorTop: Number.NaN,
    anchorBottom: Number.POSITIVE_INFINITY,
    popoverHeight: Number.NaN,
    viewportHeight: Number.NaN,
  }), {
    openAbove: false,
    maxHeight: 1,
  })
})
