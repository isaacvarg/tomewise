# Plain CSS with semantic classes, not Tailwind; widgets in the light DOM

Themes may change anything about how the app looks (ADR 0012), so they need a stable surface to target. Tailwind puts the look in utility classes inside the markup (`class="rounded-xl bg-stone-100 px-4"`), which a theme can only fight one class at a time, and any app update can reshuffle them. So the app and widgets use plain CSS: tokens as CSS custom properties, semantic class names (`.tome-heatmap`, `.tome-subject-card`) and cascade layers (`@layer`), so a theme's rules reliably win over the base styles.

For the same reason, widgets are Lit components rendered in the light DOM rather than shadow DOM. Shadow DOM would wall widgets off from theme CSS except through variables and `::part()`, which undoes "themes may change anything".

## Consequences

- Class names and markup structure are part of the theme contract, documented in the theming docs and covered by the `/styleguide` page.
- Widgets lose shadow DOM's style isolation, so lesson CSS can also reach into them; the teaching skill tells agents to style lessons with theme tokens only.
