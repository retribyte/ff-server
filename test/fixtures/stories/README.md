# Story conversion fixtures

Goldens for the TypeScript story converter (`src/story/convert/`), produced by
the reference Python pipeline in ff-site's `archive-to-markdown/`. Regenerate
them with `python3 test/fixtures/stories/build_fixtures.py` whenever the rules
or the manuscripts change, and review the diff (pass a scratch directory as
its argument to compare without overwriting).

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

The one-off `work/` tooling for the regression against the reviewed
manuscripts (described in ff-site's `archive-to-markdown/REVIEW-docx-conversion.md`)
is gone; only `build_fixtures.py` was kept.
