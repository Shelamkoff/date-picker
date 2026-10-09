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
