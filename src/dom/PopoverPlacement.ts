export interface PopoverVerticalPlacementInput {
  readonly anchorTop: number
  readonly anchorBottom: number
  readonly popoverHeight: number
  readonly viewportHeight: number
  readonly gap?: number
  readonly viewportPadding?: number
}

export interface PopoverVerticalPlacement {
  readonly openAbove: boolean
  readonly maxHeight: number
}

/**
 * Chooses the side with enough room for the popover, preferring the configured
 * below-anchor position when both sides are equivalent. The returned height is
 * always constrained to the visible viewport and can be applied as max-height.
 */
export function resolvePopoverVerticalPlacement(
  input: PopoverVerticalPlacementInput,
): PopoverVerticalPlacement {
  const viewportHeight = nonNegative(input.viewportHeight)
  const gap = nonNegative(input.gap ?? 7)
  const viewportPadding = nonNegative(input.viewportPadding ?? 8)
  const anchorTop = clamp(nonNegative(input.anchorTop), 0, viewportHeight)
  const anchorBottom = clamp(nonNegative(input.anchorBottom), 0, viewportHeight)
  const popoverHeight = nonNegative(input.popoverHeight)

  const spaceAbove = Math.max(0, anchorTop - gap - viewportPadding)
  const spaceBelow = Math.max(0, viewportHeight - anchorBottom - gap - viewportPadding)
  const openAbove = popoverHeight > spaceBelow && spaceAbove > spaceBelow
  const availableHeight = openAbove ? spaceAbove : spaceBelow

  return {
    openAbove,
    maxHeight: Math.max(1, Math.floor(availableHeight)),
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
