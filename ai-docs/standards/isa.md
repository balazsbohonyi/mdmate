# ISA standard

Read this for any new feature, bug, changed requirement or closed claim.

`ISA.md` at the repo root is mdmate's long-lived record of what must be true and how we prove it. A claim is one testable statement, with one probe that could prove it false.

## One home for each kind of fact

| Fact | Lives in | Rule |
|---|---|---|
| What must be true, its proof, decisions, unknowns | `ISA.md` | The only home of claims |
| Why, who for, user stories | `ai-docs/project.md` | Stories cite claim IDs and never restate them |
| Order of work | `ai-docs/tasks.md`, `ai-docs/phases/` | Tasks list the claims they close and never add requirements |
| How to work | `AGENTS.md`, `ai-docs/standards/` | Rules for agents, no product requirements |
| Change history | Git | `git log -- ISA.md`; the ISA keeps no changelog |

## Shape

- Claims sit in `## Features` blocks. `F0 · Cross-cutting` holds byte-exact, speed, security and portability. `F1` onward are vertical slices with a one-line `Why:` that says what the name doesn't.
- Each claim has one binary probe. Words like "and" joining two checkable things mean it needs splitting.
- Every leaf claim has a `## Test Strategy` row: `isc | type | check | threshold | tool | anchors_to | severity | tier`.
- `anchors_to` is `literal` or `derived: <name>`.
- Cargo and Vitest probes use type `bash`. UI claims use `screenshot`. Claims needing a human verdict use `manual`.
- Probe commands stay free of `|`, which would break the table. Structural checks go in `scripts/check-arch.mjs`.
- Long soak or large benchmarks are `tier: deep`, and only fast rows block work.
- Pure parsing, encoding and rewrite logic gets property tests, since one example proves one input.
- Claims that must hold for the app to do its job are `severity: critical`.

## What changes the ISA

| Event | Edit |
|---|---|
| New feature | Add its block, `Why:`, claims and Test Strategy rows **before code**. Add tasks citing those IDs |
| Later idea taken up | Move it out of `## Out of Scope` with a `## Decisions` row, then treat it as a new feature |
| Bug found | Reopen the claim that should have caught it (`[x]` to `[ ]`). If none covers it, add one. The probe must fail first |
| Probe fails | Ask: is the code wrong or the claim wrong? Wrong code gets fixed. A wrong claim gets a `refined:` Decisions row; softening a claim just to pass is never allowed |
| Claim too big | Split into `ISC-N.1`, `ISC-N.2`. The parent stays as `[container]` |
| Claim no longer wanted | Tombstone: `- [ ] ISC-N: [DROPPED — see Decisions YYYY-MM-DD]` |
| Unknown too vague to test | Add a `- fog:` line in `## Not yet specified`. It later becomes a claim or dies in Decisions |
| Non-obvious choice or dead end | Dated `## Decisions` row. Dead ends get `❌ DEAD END` so nobody retries them |
| Understanding changed | `## Learning` entry with all four parts: conjectured, refuted by, learned, criterion now |
| A word caused real confusion | `## Language` entry with an `_Avoid_:` line |
| Follow-up outside this work | `- [ ]` line in `## Remaining Work` |
| The owner revises the goal | Update `principal_stated_goal` only then, with a `refined:` Decisions row |

**IDs never change.** New claims take the next free number. IDs are never renumbered or reused, including after drops and splits.

Use real ordering only: a trailing `(after: ISC-N)` on a claim marks a true dependency. Most claims need none.

## When it happens

- **Task start:** read the claims the task closes. Run their deterministic probes first. A probe that already passes means the claim is redundant or the probe can't fail.
- **During work:** fold discoveries in as they appear.
- **Claim closes:** only on tool evidence. In one edit, set `[x]`, update `progress: M/N`, and add a one-line `## Verification` stub naming the test or probe. `progress` counts leaf claims, so `[container]` parents are left out.
- **Task end:** `pnpm check` and `pnpm check:rust` green, then compare the diff to the claims. Unclaimed work becomes a new claim or gets removed.
- **Phase end:** rerun all fast probes, rerun speed claims, and review fog.
- **Version release:** every claim for that version closed, fog empty, `phase: complete`. The next version starts by adding claims, which reopens the ISA.

## Who writes

- The primary session is the sole writer. Delegated agents report results and proposed claim edits, and the primary session applies them.
- ISA edits ship in the same commit as the work they describe.
- This file and `ISA.md` hold project content only, since the repo is public.

## What enforces it

`scripts/check-isa.mjs` runs in `pnpm check`. It fails on a wrong `progress` leaf count, duplicate IDs, a leaf claim with no Test Strategy row, or a Test Strategy row with no claim.

Stay with one ISA. A subsystem moves to a child ISA only if the file stops fitting one read, recorded in Decisions.
