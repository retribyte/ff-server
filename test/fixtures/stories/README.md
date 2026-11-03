# Story conversion fixtures

Goldens for the TypeScript story converter (`src/story/convert/`), produced by
the reference Python pipeline in ff-site's `archive-to-markdown/` on branch
`story-docx-import`. Regenerate them from there whenever the rules change, and
review the diff.

- `docx/<slug>.docx` holds the 23 Google Docs exports from the FF shared Drive
  that have a reviewed story in the archive.
- `docx/<slug>.meta.json` is the metadata each golden was converted with, plus
  the converter's warnings. The color map uses **placeholder** speakers
  (`C<hex>`), so the golden tests conversion, not attribution.
- `docx/<slug>.md` is the expected `story-docx-to-md.py` output.
- `manuscripts/<slug>.md` holds all 37 reviewed story manuscripts
  (`md/stories/`).
- `manuscripts/<slug>.json` is the expected `story-md-to-api.py` payload for
  each manuscript.

`work/` tooling for the regression against the reviewed manuscripts (outside
any repo) is described in ff-site's `archive-to-markdown/REVIEW-docx-conversion.md`.
