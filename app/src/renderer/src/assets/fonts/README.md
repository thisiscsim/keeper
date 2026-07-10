# Fonts

Drop the Bradford brand font files here (licensed files are not committed by
tooling — add them yourself):

- `Bradford-Regular.woff2` (weight 400)
- `Bradford-Medium.woff2` (weight 500, optional)
- `Bradford-Italic.woff2` (italic 400, optional)

`styles/fonts.css` declares the matching `@font-face` rules; `--font-brand`
falls back to Georgia until the files exist. `.otf`/`.ttf` also work — update
the `src`/`format` in `styles/fonts.css` if you use those instead.

Everything else in the UI uses the system SF Pro stack (`--font-ui`); no files
needed for it.
