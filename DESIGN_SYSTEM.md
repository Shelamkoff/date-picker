# Design system

The supplied admin theme is treated only as a **visual reference**. Its application structure, selectors, routing and component implementation are not part of these packages.

## Neutral namespace

The optional CSS-only package exposes `--sui-*` variables for:

- surfaces: `--sui-canvas`, `--sui-shell`, `--sui-surface`, `--sui-surface-raised`, `--sui-surface-hover`;
- lines: `--sui-line`, `--sui-line-soft`, `--sui-line-strong`;
- text: `--sui-text`, `--sui-text-soft`, `--sui-muted`, `--sui-faint`;
- semantics: `--sui-positive`, `--sui-negative`, `--sui-warning`, `--sui-info`, `--sui-focus`;
- controls: `--sui-control-bg`, `--sui-control-hover`, control heights and button values;
- geometry: radii and spacing;
- motion and shadows.

The characteristic reference values are preserved, including the dark black/graphite surfaces, green positive accent (`#5fd17a`), Onest UI stack and IBM Plex Mono stack.

## Theme scope

Dark:

```html
<div class="sui-theme">...</div>
```

Light:

```html
<div class="sui-theme sui-theme--light">...</div>
```

or:

```html
<div data-sui-theme="light">...</div>
```

No global `body` reset and no font download are installed by the package.

## Picker-specific theme contract

The standalone vanilla picker exposes `--sdp-*` variables. Its values resolve in this order:

1. explicit `--sdp-*` override;
2. compatible optional `--sui-*` variable;
3. built-in literal fallback based on the reference design.

Therefore the picker works in all three modes:

- by itself;
- inside the optional UI theme;
- with a completely custom consumer theme.

The Vue wrapper adds no visual layer of its own; it uses the vanilla picker stylesheet.
