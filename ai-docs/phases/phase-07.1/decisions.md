# Phase 7.1 decisions

Deviations from the plan and choices it left open. The plan's settled decisions (the exclusion list, nested roots, the cap, the status bar, no sidebar filter) are not reopened here.

## Checking the UI (all of Phase 7.1)

- Two places, as in Phase 7: the real debug window `target/debug/mdmate.exe` against my own Vite server, driven over the DevTools port, with `MDMATE_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER` in temp folders so your real settings, session and roots are never touched. And the release perf harness for the numbers.
- The test workspace is `D:\develop\projects` read-only. Anything the checks create or rename goes in a scratch folder under a temp dir that is added as a second root; nothing under `D:\develop\projects` is written.
- Nothing you may have running is stopped. Before the perf run I read what `killStragglers` in `scripts/perf.ts` matches: only `msedgewebview2.exe` processes whose command line contains the harness's own profile folder, so a WebView2 of another app, or of mdmate with its own profile, is not touched.

## What the plan did not foresee

**⚠️ Windows cannot tell us when it dropped events.** The plan says "when Windows drops events (buffer overflow), that root is reconciled again." The `notify` crate (8.2.1, the version in `Cargo.lock`) has no way to say so on Windows: its Windows backend never sets the rescan flag, and a buffer overflow arrives as an empty read that it swallows (the flag exists only in its Linux and macOS backends, which I do honour). So an overflow on Windows is not detectable. What is done instead:

- A flag from the backend, or a watcher error, reconciles the roots (Linux and macOS, and any Windows failure).
- A quiet spell of 64 or more events that matter (not under an excluded folder) reconciles the root they belong to. The Windows buffer is 16 KB and an event takes 12 bytes plus the path in UTF-16, so it holds roughly 30 to 230 events; 64 is a guess that errs toward reading. A false alarm costs one walk; a miss leaves the index wrong until the next walk.
- Whatever slips through is corrected by the reconcile at every start.

What I did not add: a periodic reconcile or one on window focus. Either would walk 100,000 files on a timer for a problem that may never happen. If you see Ctrl+P go stale after a very large change by another program, that is the gap, and a "reconcile when the window regains focus after a burst" is the small next step. Your call.

## P7.1-T1: The index

**Decided: own operations update the index from Rust, not from `ops.ts`.** The plan said `src/features/tree/ops.ts` calls into the index through new commands. The Rust operations are the one place every route passes: rename, move and the rewrite flow all end in `ops::carry_out`, and delete, new file, new folder and copy-on-drop have one function each. Hooking there needs no new command, no extra round trip, and cannot be forgotten by a page path added later. The behaviour is the one the plan asks for (the index holds the new state at once, with no walk).

**Decided: the cache file is written 500 ms after the last change, not synchronously.** The plan says "update the index and its cache at once." The index is updated at once; the cache file (about 10 MB at 100,000 files) is rewritten once after a run of changes, so a 200-file copy is one write and not 200. A crash inside that half second loses only the newest changes, and the reconcile at the next start corrects them. The file is written through a temp file and a rename, so it is never half written.

**Decided: the cache is one binary file per root with a checksum.** Header (magic, format version, exclusion-list signature, the root), the entries, then a hash of everything before it. A file with another version, another exclusion list, another root, a failed checksum or a short read is ignored, and the root is read from scratch. Entries hold path, kind, size and modified time. A test checks that no file content is in it.

**Decided: roots are held as separate sorted lists, innermost wins.** A walk of a root skips the folders of the roots inside it; adding a root drops its files from the root around it; removing one reads its folder again for the root around it.

**Decided: a first index shows files as it finds them.** The plan says Ctrl+P is instant "once the index is built." While a root has no cache and is being read for the first time, what the walk has found so far is already offered (in walk order, not sorted). The link scans and folder search use the index only for a root that has finished its first read; until then they walk, as the plan says for a root "not indexed yet."

**Decided: a folder that cannot be read leaves a cached list alone.** If a root with a loaded cache cannot be listed at all (an unplugged drive), its cached list stays and the root is not marked up to date, so the features keep walking it.

**Decided: a change made while a walk runs is replayed on the walk's result.** Every change mdmate or the watcher reports during a walk goes into a journal, and the finished walk is corrected by re-reading those paths. A walk that started before a rename cannot bring the old name back.

**Decided: the percent follows the plan's rule, and never reaches 100 while a walk runs.** With a cache it is folders entered out of the folders the cache counted; on a first index it is top-level entries finished out of all of them. The rule is the function `walk_share`, with its own tests. The status goes to the page at most ten times a second.

**Decided: the perf harness's fixtures folder is a root for access, not for the index.** `MDMATE_PERF_FIXTURES` is granted in every perf launch so scenarios can read fixture files by path. It holds the 8,001-file `workspace-large`, and indexing it in every run would put a background walk under scenarios that do not ask for one. Scenarios that want a folder indexed grant it with `perf_grant_root`.

**Deviation: the built-in exclusion list now applies to Quick Open and the link scans' walk fallback, so a few existing tests changed.** `build` and `node_modules` fixtures in `links/walk.rs`, the Quick Open test that listed `node_modules`, and the two folder search tests that used a folder named `build` as their ordinary folder. The folder search tests now use `gen`, and keep a `build/i.md` that no search may read.

**Known cost, as the plan says:** a folder of your own named `bin`, `obj`, `out`, `build` or `target` drops out of Ctrl+P and search.

### The scenario `typing-during-indexing` (written before its first run)

- **Claim:** ISC-292, p95 work per key under 16 ms, repeatable by the existing rule over 5 runs.
- **What it is:** the `typing-1mb` scenario, unchanged (same document, same caret, same keys, measured the same way), while Rust indexes `tests/fixtures/generated/workspace-100k`: 100,000 files in 100 areas of 10 folders of 100 files, plus 4,000 files under `node_modules` and `target` that the walk must skip. Generated by `scripts/lib/indexWorkspace.ts` (seeded, deterministic, one short line per file).
- **How the index is kept busy:** the root is granted before the keys start, which starts a first index with no cache. When it ends, a reconcile of the same root starts at once, and so on until the last key. Every key, warm-up keys included, lands while a walk of 100,000 files runs.
- **The page's work is inside the measurement:** the real status bar is mounted and listens to the real status channel, so the Indexing label and its bar are redrawn while the keys land.
- **The run fails** if the bar never showed Indexing, if the index did not hold exactly 100,000 files, or if walks covered less than 90% of the typing window.
- **Two modes**, as for search: `typing-during-indexing` types with `view.dispatch`, `typing-during-indexing-trusted` types real key events through the DevTools port.
- **Recorded, not gated:** the first index time, the number of walks, the share of the window covered, the highest percent the bar showed.

### The scenario `index-times` (written before its first run)

- **What it is:** how long the index takes on `workspace-100k`, in two launches that share one data folder. Printed and saved, never gated.
- **Phase 1, the first index:** no cache. Time from granting the root to the index going quiet (`firstIndexMs`). The cache is written and the run reports.
- **Phase 2, the start-up reconcile:** the same root with the cache the first run left. Time until the index holds the cached list (`cacheAnswerMs`, what Ctrl+P could answer from) and time until the reconcile against the disk ends (`reconcileMs`).
- **Both phases fail** if the index does not hold exactly 100,000 files.

## P7.1-T2: Ctrl+P reads the index

**Decided: `quick.rs` keeps the scorer and loses its own walk.** The scoring rules, the constants and every pinned scoring test are unchanged. What went: the private file list, the 250,000-file cap (the index's million-file cap is the only one now), the rebuild on open, and the `quick_open_refresh` command with its host method on the page side. Opening the picker asks the index and nothing else.

**Decided: a query reads the index lists where they are.** The shared lock is held for the length of one query (scoring 100,000 paths, tens of milliseconds at the most). A change to the index waits that long; typing in the picker never waits for a walk. No copy of the list is made per query.

**Decided: scoring uses several threads from 40,000 files up.** One thread would be fast enough for a few thousand files, and slower than the budget on a million. Below 40,000 files one thread does it all. Above, the files are cut into chunks of 16,384 and up to 8 workers take chunks in turn. A test checks that the many-thread answer equals the one-thread answer.

**Decided: most files are rejected without building their letters.** A file is turned into letters and scored only after a cheap in-order test shows the query's letters are in it. Most of 100,000 files fail that test.

**Decided: the picker follows the index while a folder is read for the first time.** The plan says Ctrl+P is instant "once the index is built"; a picker opened during the first read shows what has been found, and asks again each time the status bar's status changes while it is open, keeping the row the user is on. Changes by another program after the first read are seen the next time the user types or opens the picker, as the watcher delivers them.

**Deviation: an empty query lists files in path order, as before, but across the index's lists, so with several folders open each list is led by its folder's name.** Same as the old behaviour.

### The scenario `quick-open-query` (written before its first run)

- **Claim:** ISC-291, p95 under 50 ms, repeatable by the existing rule over 5 runs.
- **What it is:** from the page asking until the answer is parsed in the page: the whole bridge, the scoring in Rust, and the answer back, on `workspace-100k` (100,000 files, 4,000 more under excluded folders). The index is built first and left idle, so the number is the cost of a query alone.
- **Queries:** 14, as typed into the box on the way to a file, from one letter that matches nearly every file (`a`, `n`) to a folder and a name (`area-42/sub-3/plan`) and one that matches nothing (`zzzq`). Each is asked once per round, 12 timed rounds after one dropped round, 168 timed asks. The headline is the p95 over all of them; the median per query is saved in the run's notes so a slow query can be named.
- **The run fails** if the index did not hold exactly 100,000 files, if a query that must match found nothing, if `zzzq` matched, or if a file under `node_modules` or `target` was ever offered.

## P7.1-T3: Link scans and folder search read the index

**Decided: one function, `walk_indexed`, in `links/walk.rs`.** The rename and move plan, Find File References and folder search each used to call a walk. They now call `walk_indexed(index, root, scope, stop, skip_dir, visit)`: when the index holds the root whole it hands out the list (filtered by the same `Scope::offers` rule), otherwise it walks exactly as before. "Holds whole" means the root has finished its first read (or its cache was reconciled) and was not cut at the file limit. A root that is not ready, or was cut, is walked, so nothing is ever missed because the index was behind.

**Decided: folder search keeps its include and exclude patterns, and they are applied per file.** The walk pruned folders with `skips_folder` to save reading them. A list has no folders to prune, and `keeps_file` already says no to every file inside an excluded folder (a pattern `gen` is compiled as `**/gen` and `**/gen/**`), so the answer is the same and only the saving is gone. The test `a_search_through_the_index_finds_what_a_walk_finds_whatever_the_filters` runs six include and exclude pairs, anchored and not, and compares both ways.

**Deviation: results come in path order, not walk order.** The index lists a root sorted by path. Folder search results and reference lists are ordered the same way as before inside a file; the files themselves now come in path order (the walk gave directory order, which on Windows is also close to path order but is not promised). Tests compare sorted.

**Deviation: the "skipped" count of a search and the unreadable-folder list do not include folders the index could not read.** A walk reports a folder it cannot open; a list has no folder to try. The index keeps its own count of unreadable folders for a root, and a root that could not be listed at all keeps its cache and stays not-ready, so it is walked and reports as before. A folder that becomes unreadable between the index's read and a search is not reported until the next read.

**Known gap, small:** between another program making a file and the watcher's batch (the watcher batches events for 150 ms, and in the real window a file made by another program was in Ctrl+P within about 1 s of its creation), a rename's link scan does not see the new file. The walk it replaces had no such gap. The rename plan is made when the user starts the rename, and the apply step re-checks each file it edits by its hash, so a file the plan missed is simply not rewritten, as if it had been made a moment after the rename.

**Decided: nested roots are handled by going through every root.** The index gives the outer root's list without the files of the root inside it (innermost wins), and the callers already go through every root and keep a set of files seen, so each file is read once. A test with a root and a root inside it checks the result equals a walk.

**Decided: `walk` and `walk_until` stay, for tests only.** Their last real callers moved to `walk_indexed`.

## Results (release build, Windows)

**Perf gates, five runs each, all inside target and repeatable:**

| Scenario | Result | Target |
|---|---|---|
| quick-open-query, ask p95 (100,000 files) | 17.4 ms (16.5 to 18.4) | 50 ms |
| typing-during-indexing, work per key p95 | 6.8 ms (trusted keys 8.7 ms) | 16 ms |
| typing-1mb / trusted | 6.7 / 6.9 ms | 16 ms |
| typing-during-scan | 8.3 ms | 16 ms |
| typing-during-search / trusted | 10.1 / 12.1 ms | 16 ms |
| typing-find-open / typing-outline-open | 11.4 / 6.6 ms | 16 ms |
| startup, open-1mb, tab-switch | 532 ms, 21.8 ms, 15.9 ms | 1500, 100, 50 ms |

**Rerun after the machine was put on its own charger** (five runs each, release build, fixture in the system temp folder):

| Scenario | Result | Target |
|---|---|---|
| control `typing-1mb` p95 | 8.1 ms (first pass 6.7 ms), repeatable | 16 ms |
| quick-open-query, ask p95 | 13.2, 14.6 and 14.8 ms in three sets (runs 12.7 to 16.9) | 50 ms |
| typing-during-indexing p95 | 6.2 ms (5.9 to 6.8), repeatable | 16 ms |
| typing-during-indexing-trusted p95 | 9.2 ms (8.7 to 9.7), repeatable | 16 ms |
| index-times (not gated) | first index 233 ms, cache answered 11.9 ms, reconcile 253 ms | |

The index was reading for 95% of the typing window and finished about 95 walks of the 100,000 files while 300 keys landed. The full web suite passed 1753 of 1753. `quick-open-query` missed the strict "within 10% or 1 ms of the median" rule in all three sets, each time by single runs 1.3 to 2.1 ms off the median on a 14 ms metric that has a 50 ms target; I report it as it is.

**What the slow period was.** For hours the machine ran about 2x slower than in the first pass: the control `typing-1mb` read 18 to 20 ms against 6.7 ms, `quick-open-query` 40 to 47 ms, `typing-during-indexing` 14 to 15 ms and its trusted variant 18 to 20 ms. A reboot, a High performance plan, a fresh WebView profile and the fixture on drive D changed little. To tell the machine from the code I built plain `main` from a temp copy and ran `typing-1mb` on it in the same hour: 12.4 ms, against 12.1 to 14.2 ms for this branch, so Phase 7.1 does not slow typing. The owner then found the laptop had been charging from a phone charger; on its own charger the numbers returned to the first-pass level.

**Recorded, not gated** (`index-times`, 100,000 files): first index 209 ms, the cache answered after 11.9 ms, the start-up reconcile ended after 237 ms. In `typing-during-indexing` the index was reading for 95% of the typing window and finished about 110 walks of the 100,000 files while 300 keys landed.

**Real window** (release build; isolated data folder and WebView2 profile; `D:\develop\projects` (79,456 files) and a scratch root as roots; my own Vite server, stopped after; the script launches the app and samples the page from its first moment):

- First start with no cache (3 launches): the status bar showed Indexing with the percent at 28, 31 and 31. The index of this tree takes about a second in the release build, so each launch caught the label in one or two samples; a first start in the debug build, with the 100,000-file fixture still inside the tree, showed it for 5.0 s (23, 26, 50). The first Ctrl+P after launch had rows 28 to 45 ms after the key.
- Restart with the cache (3 launches): Indexing showed for the reconcile with 39, 47 and 42 percent (again one or two samples each); Ctrl+P first rows 24 to 28 ms after the key, later opens 10 to 13 ms. The same open in the debug build took about 730 ms on the larger tree: that is the unoptimised Rust scorer, not the release cost.
- A file made by another program appeared in Ctrl+P within about 1 s (measured while the larger tree was open). A file renamed through the tree (F2, Enter) showed under its new name and the old name was gone; on the clean tree the rename and its link scan finished in about 2 s.
- Queries `node_modules` ("No file matches"), `target`, `readme`, `cargo.lock` and `alpha` showed no row under `node_modules` or `target`.

**Found while measuring, for the report:**

- The 100,000-file perf fixture must not sit under `tests/fixtures`, which the harness opens as a root (every scan and search of `workspace-large` also walked and read the 100,000 files and the scan scenarios finished no scan), and not under `D:\develop\projects`, where it would slow the owner's own mdmate. It lives in the system temp folder (`mdmate-perf/workspace-100k`); the harness passes the path to the page as the `bigWorkspace` parameter.
- `perf_index_reconcile` and the typing scenario's walk counting were first measured from the page, which counted no-op calls as walks; coverage now comes from Rust's own walking clock, and the scenario fails if a root is unknown.
- A rename of any file (a text file too) scans every Markdown file of every root for links. The index removed the walk, not the reading: with the 100,000-file fixture still inside the tree, one rename took about 160 s in the release build (thousands of generated Markdown files to read), while on `D:\develop\projects` alone it took about 2 s. Reading the files is unchanged by this phase; I did not time the old walk-and-read on either tree. The toast shows progress and Cancel.
