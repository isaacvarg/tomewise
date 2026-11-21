# Mockups

Throwaway HTML mockups from the design sessions of 2026-11-21. Open either file in a browser. They are the visual reference for v1, not app code.

- [home.html](./home.html): the home screen (heatmap, subjects, due today, streak, Start) on two phones and a desktop window.
- [drill-runner.html](./drill-runner.html): a playable Morse listening drill and its end-of-session summary, on two phones and a desktop window.

Both pages render the same markup in the two built-in themes planned for v1 (ADR 0012):

- **Paper**, taken from the Morse `teach` workspace's stylesheet.
- **Meadow**, a nature theme with leaf-shaped heatmap cells, rolling hills and a small theme script (leaves rising from Start and from correct answers).

The `--t-*` tokens and `.tome-*` class names in these files are the first draft of the theme contract. When the real themes are built, start from the token values here.
