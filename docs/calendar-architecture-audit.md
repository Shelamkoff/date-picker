# Date picker architecture and calendar extension audit

Date: 2026-10-09. Baseline: master at 4e10fbb7c66d85b64f177f14a57e26ce76a63de3.

## Scope verified

Reviewed `src/core/calendar.ts`, `controller.ts`, `types.ts`, `format.ts`, the public exports, `src/dom/DatePicker.ts`, `WheelColumn.ts`, `PopoverPlacement.ts`, CSS, README, tests and the CI matrix. This is a framework-independent TypeScript package; do not introduce Vue, React or new runtime dependencies.

## Current architecture

- Good separation between the headless wheel controller and imperative DOM widget. `calendar.ts` provides careful local-time/DST handling, including nonexistent civil minutes, ambiguous local hours and min/max constraint intersection. Preserve this logic rather than replacing it with naive UTC date arithmetic.
- Main maintainability risk: `src/dom/DatePicker.ts` contains DOM creation, option resolution, events, wheel coordination, focus handling, pointer lifecycle and popover positioning in a single ~849-line class. Adding multiple selection states directly there would expand coupled logic and increase wheel-regression risk.
- The original `DatePickerController` is intentionally single-instant/wheel-oriented. Changing its `value: Date|null` to a mixed union would break callers and make time-wheel behavior ambiguous. The calendar-specific value and selection modes belong in a separate model.
- The original UI exposes no calendar grid, date ranges, or multi-date model. These are feature gaps rather than existing bugs.

## Implemented boundaries

1. New `src/core/calendar-selection.ts`: DOM-independent civil-date ordinals, calendar navigation, week layout, disabled-day predicates, min/max, range continuity, range span limits, multi-date deduplication/limit, hover preview, immutable outward values and change suppression.
2. New `src/dom/CalendarDatePicker.ts`: separate DOM calendar rendering/interaction. Shares existing CSS variables, localization formatters and popover positioning helper. Does not import `WheelColumn` or mutate the old widget.
3. New `createDatePickerWidget({ view: 'calendar' | 'wheel' })` typed factory; old `new DatePicker(...)` and `createDatePicker(...)` remain usable unchanged.
4. New unit tests for bounds, changes, defensive copies, reversal, DST dateline skip, invalid values, navigation and multiple selection; demo and README examples for all three modes.

## Invariants and remaining validation

- A calendar selection is a *local civil day* (start of first representable local minute), not a fixed 24-hour interval; compare by Gregorian ordinal, not `getTime()/86400000`.
- Range endpoints cannot cross a disabled or nonexistent local day; min/max and max selection count must be checked before committing. Changes to constraints can invalidate existing selections.
- Recheck wheel behavior under existing Node/timezone and Chromium CI; new calendar DOM should receive dedicated browser interaction and screen-reader audits in Chromium, Firefox and WebKit, especially keyboard roving tabindex, shadow-root focus and pointer/range preview.
- Browser interactions, popup positioning under clipping/portals, RTL, locale-specific week numbering, focus restoration, form-associated semantics and native direct-text entry still need broader acceptance tests; they are not fully guaranteed by headless unit tests. Current calendar does not provide free-text date parsing, week selection, preset ranges, selectable timezone or multi-month panels.
- Maintain the simple `@shelamkoff/date-picker` namespace and design tokens. Prefer further small, tested extraction of popover/focus primitives over an untested rewrite of the wheel mode.

### Browser locale compatibility (confirmed and fixed)

The initial implementation used only `Intl.Locale.prototype.weekInfo`; Chromium 136+ (and other modern engines) instead expose `getWeekInfo()`, so `en-US` calendars silently defaulted to Monday. The calendar now checks `getWeekInfo()` first and uses the older property on runtimes that still implement it. Browser tests explicitly verify `en-US` = Sunday and `en-GB` = Monday. Background: MDN's `Intl.Locale.getWeekInfo()` compatibility note.

## Recheck: 2026-10-09

- Confirmed that the calendar read-only state previously set native `disabled` on all day buttons. Read-only dates now remain keyboard-focusable with `aria-disabled`, while selection remains blocked.
- Confirmed that viewport-induced popover `max-height` persisted into later placements. It is cleared before remeasuring and when the popover closes.
- Confirmed that a throwing user `disabledDate` callback was swallowed by a blanket `catch` during `CalendarSelectionController.update()`, silently discarding the selection. Constraint invalidation now clears an unavailable selection deliberately, while callback exceptions propagate and restore the previous controller options and value.
- The demo now exposes calendar and wheel modes on the primary page, keeps example-specific styling in `demo.css`, serves `src/style.css` directly during development, and versions published CSS/JS assets for Pages.
- Files preserved after cleanup: source, tests, README, CI/Pages workflows, the demo and this audit. There were no tracked build artifacts or obsolete source trees that could safely be removed.

## Re-audit: calendar correctness, i18n, lifecycle and responsive layout

Pass: 2026-10-09. Target branch: `master`. Changes are intentionally confined to the new calendar and its tests/documentation; existing wheel behavior is preserved.

### Confirmed defects fixed

- **Extremal dates:** DOM selection previously synthesized a local noon to build a Date. The maximum ECMAScript date (+275760-09-13T00:00:00.000Z in UTC) is representable only at 00:00, so an enabled calendar cell could reject a click. DOM selection now uses the same `dayInterval` primitive as the headless model. Node and Chromium regressions cover the upper boundary.
- **Atomic configuration:** `CalendarDatePicker.update({ minDate, value })` could apply new bounds, clear the old value, and then throw on an invalid explicit value. The controller now validates proposed bounds and explicit value as one transaction, restoring previous configuration on failure.
- **Today action:** Previously enabled even when today was disallowed or could not be added to a full multiple selection, or could not complete the pending range. Its disabled state now accounts for all current selection rules.
- **Empty actions:** The footer is hidden when both Today and Clear controls are disabled by options (`showToday: false, clearable: false`).
- **ISO week numbering:** For a Sunday-start calendar, calculating the week from Sunday's ISO week assigned the wrong label to most days in the row. ISO week labels now derive from the row's Thursday; accessible labels include the week number.
- **Ambiguous weekday abbreviations:** Taking the first two Unicode code points made every Arabic weekday appear as the identical "ال". Compact labels now choose between short-prefix and CLDR narrow labels based on distinctness.
- **Locale numerals:** Day, year and week numbers were hardcoded as Latin digits even for locales using other numbering systems. These now use the package's cached locale-aware number formatter.
- **Lifecycle:** `CalendarDatePicker.destroy()` detached the element but left its internal DOM listeners active. Retained detached controls could still select dates or throw when clicked. Destroy now unregisters listeners; a browser test dispatches clicks against retained elements.
- **Prior layout pass:** Mobile document overflow, constrained popovers, sticky footer visibility, inline shrinkage, themed text contrast and narrow wheel columns remain protected by the responsive Chromium screenshot/geometry suite.

### Verification and limits

- Unit tests run under Node.js 20 and 22 in UTC, America/New_York, Australia/Lord_Howe, Pacific/Apia and Europe/Paris.
- Chromium interaction checks cover single, inclusive range, multiple, read-only navigation, pending range hover, extreme representable dates, atomic updates, Today availability, keyboard, locale week starts, ISO weeks, Arabic compact labels and lifecycle teardown.
- Responsive Chromium screenshots check widths 320, 375, 768, 900, 1280 px in both themes; a narrow Arabic RTL calendar scenario has been added.
- There are no tracked generated build directories or obsolete copies requiring deletion.
- Not established by these tests: full screen-reader conformance, Firefox/WebKit parity, 200–400% zoom, all possible hostile overflow-ancestor layouts, focus traps/portals, text input, presets, multi-month view or selectable timezones. These remain separate acceptance/release criteria, not confirmed fixes.
