# Themes are modular from day one, and the learner's theme wins everywhere

Different learners want very different looks (a calm paper-and-ink style, a cute nature-inspired one), and an open-source project should let contributors make it look however they like. So the look is a swappable **theme** from the first release, not a fixed design with a dark mode bolted on later.

A theme is a folder: `theme.json` (name, author, version), `tokens.css` (colours, fonts, radii, spacing, for both light and dark), and optional extra CSS, JavaScript and assets. Themes may change anything about appearance, layout and behaviour included. Built-in themes ship in the tool (`themes/`), a learner's own themes live in the learning home's `themes/`, and community themes arrive by pull request. The learner picks one in the app and the choice is saved in `tomewise.json`.

The learner's theme applies to the app, the widgets and the lessons. Lessons stay free in layout and content per subject, but take their colours, fonts and decoration from the theme, so the agent styles lessons with theme tokens rather than its own palette.

## Considered options

- Tokens only: safest, but too narrow for a look that needs illustration and different shapes.
- Tokens plus fixed decoration slots, with layout locked: protects the phone layout, but fences contributors in.
- Lessons keep their own look and themes only change the app frame: a theme would stop at the edge of every lesson.
- CSS and assets only, no JavaScript: safer, since theme code runs on the same pages that report results, but it rules out animated or interactive touches contributors will want.

## Consequences

- Because a theme can change layout, nothing in code stops one from breaking the phone layout or contrast; checks and skills catch it instead (below).
- Theme JavaScript runs on every page, including lessons that post events, so a theme is trusted code. The docs say to install only themes you trust, and community themes are reviewed in their pull request.
- The theming skill, a separate `theme-check` skill for the learner's review loop, the `/styleguide` page and `tome theme check` (screenshots at phone and desktop widths in both modes, contrast and overflow checks) together keep themes working.
- The app's and widgets' markup (class names, structure) becomes part of the theme contract and needs the same care as the widget API.
- Two themes ship in v1, Paper (from the Morse workspace's stylesheet) and Meadow (a nature theme), to prove the contract is really modular. Both are mocked up in `docs/mockups/`.
