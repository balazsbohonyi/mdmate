# Phase 4: what was not tested, and how to test it later

Everything below was skipped on purpose or could not be done in the Phase 4 runs. Each entry says why, and how to check it when there is time. The decisions behind them are in [decisions.md](decisions.md).

| # | Gap | Why it was skipped | How to test it |
|---|---|---|---|
| 1 | The parse frontier landing exactly on the end of a table | A mutation of the removal filter survived: no test can put the frontier there on demand. | Open a very large document with many tables in the real app, scroll to the bottom while parsing catches up, and check that no table is missing or drawn twice. |
| 2 | Tables wider than the pane | The wrapper scrolls sideways, but no check looked at a wide table. | Open a table with ten long columns in a narrow pane and scroll it sideways. |
| 3 | The light theme | As in Phase 3, every visual check ran in the dark theme. | Switch to the light theme and look at the table header, borders and inline code. |
