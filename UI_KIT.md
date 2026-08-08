# UI kit

Package: `@shelamkoff/ui-kit`.

This package is **optional** and **CSS-only**. It is not the date-picker runtime and is not a dependency of either JavaScript package.

## Token contract

Public custom properties use the collision-resistant `--sui-*` namespace. The main groups are:

- surfaces, lines and text;
- semantic colors;
- control and button colors;
- `sm` / `md` control heights;
- radii and spacing;
- duration, easing and shadows.

## Primitive classes

- `.sui-button`
- `.sui-icon-button`
- `.sui-field`
- `.sui-input`
- `.sui-textarea`
- `.sui-select`
- `.sui-checkbox`
- `.sui-surface`
- `.sui-badge`
- `.sui-spinner`

These are intentionally styling primitives, not framework components.

## Theme scope

Use `.sui-theme` for the default dark palette and `.sui-theme--light` (or `data-sui-theme="light"`) for light mode.

The theme class itself applies the declared UI font stack and text color to its subtree. It does not import remote fonts; applications remain responsible for loading Onest/IBM Plex Mono if they want those exact faces instead of the fallback stack.

The picker remains independent. Its `--sdp-*` variables can optionally read compatible `--sui-*` values when the UI kit is present, but all picker variables also have standalone defaults.
