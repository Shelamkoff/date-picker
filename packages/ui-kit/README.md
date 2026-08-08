# @shelamkoff/ui-kit

Framework-agnostic design tokens and CSS primitives. The visual values are derived from the supplied admin-theme reference, but the package contains no application-specific selectors, routing, components or repository integration.

```css
@import '@shelamkoff/ui-kit';
```

```html
<div class="sui-theme">
  <button class="sui-button">Save</button>
  <input class="sui-control" />
</div>
```

Use `.sui-theme--light` or `data-sui-theme="light"` for the light palette.

The package intentionally does not download fonts. Load `Onest` / `IBM Plex Mono` in the host application if desired, or override `--sui-font-sans` / `--sui-font-mono`.

`aria-disabled="true"` is styled but the CSS-only kit does not suppress activation; application/framework code must handle disabled behavior.
