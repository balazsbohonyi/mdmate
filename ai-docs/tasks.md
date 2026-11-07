# Tasks

Mark `[x]` only when the task's "Done when" in its phase plan holds. Each task lists the ISA claims it closes; claims live in `ISA.md`.

## Phase 0: Spike and scaffold ([plan](phases/phase-00/plan.md))

- [x] P0-T1: Scaffold Tauri, Vue, Tailwind and shadcn-vue (ISC-169 closes in P0-T3, see decisions)
- [x] P0-T2: Add lint, type and format configs with both gates — closes ISC-22, ISC-23
- [x] P0-T3: Build `scripts/check-arch.mjs` — closes ISC-9, ISC-12, ISC-13, ISC-21, ISC-24, ISC-73 (and ISC-169, see decisions)
- [x] P0-T4: Build `scripts/check-isa.mjs` — supports ISC-22
- [x] P0-T5: Add CI for gates and macOS and Linux compiles — closes ISC-10, ISC-11
- [x] P0-T6: Generate test fixtures — supports all fixture probes
- [x] P0-T7: Build the perf harness and raw IPC file read — supports ISC-4 to ISC-7
- [x] P0-T8: Measure the baseline with throwaway decorations — supports ISC-4, ISC-5, ISC-7
- [x] P0-T9: Answer the fog questions — resolves `## Not yet specified` entries

## Phase 1: Workbench ([plan](phases/phase-01/plan.md))

- [x] P1-T1: Design tokens and built-in theme files — closes ISC-14
- [x] P1-T2: App shell with titlebar, sidebar frame and status bar — closes ISC-25, ISC-26, ISC-27
- [x] P1-T3: Split tree model — closes ISC-28, ISC-29, ISC-30, ISC-31
- [x] P1-T4: Pane rendering and resize handles — closes ISC-34
- [x] P1-T5: Pointer-based tab dragging — closes ISC-32, ISC-33, ISC-176
- [x] P1-T6: Command registry, split shortcuts and sidebar toggle — closes ISC-35, ISC-171, ISC-172

## Phase 2: Documents ([plan](phases/phase-02/plan.md))

- [x] P2-T1: File layer with encoding detection and atomic save — closes ISC-1, ISC-39, ISC-40 (ISC-37 moves to P2-T2, see decisions)
- [x] P2-T2: Host interface and open flow — closes ISC-36, ISC-37, ISC-98, ISC-174
- [x] P2-T3: Master state and follower views — closes ISC-6, ISC-38, ISC-41, ISC-42, ISC-43
- [x] P2-T4: Line-ending preservation and edit isolation — closes ISC-2, ISC-3
- [x] P2-T5: Watcher and conflict handling — closes ISC-44, ISC-45, ISC-46
- [x] P2-T6: Hot exit and session restore — closes ISC-47, ISC-48, ISC-49
- [x] P2-T7: Large-file mode and open speed — closes ISC-5, ISC-8

## Phase 3: Inline preview ([plan](phases/phase-03/plan.md))

- [ ] P3-T1: Inline layer and headings — closes ISC-50, ISC-63
- [ ] P3-T2: Emphasis and inline code — closes ISC-51.1, ISC-51.2, ISC-51.3, ISC-52
- [ ] P3-T3: Links, lists, blockquotes and rules — closes ISC-53, ISC-54, ISC-55, ISC-56
- [ ] P3-T4: Caret reveal — closes ISC-57, ISC-58, ISC-59, ISC-60
- [ ] P3-T5: Source toggle and raw copy — closes ISC-61, ISC-62
- [ ] P3-T6: Typing and startup targets with preview on — closes ISC-4, ISC-7

## Phase 4: Block preview ([plan](phases/phase-04/plan.md))

- [ ] P4-T1: Block layer and tables — closes ISC-64, ISC-65
- [ ] P4-T2: Images — closes ISC-66, ISC-67, ISC-72
- [ ] P4-T3: Frontmatter and checkboxes — closes ISC-68, ISC-69
- [ ] P4-T4: Code highlighting — closes ISC-70, ISC-71

## Phase 5: Links and editing ([plan](phases/phase-05/plan.md))

- [ ] P5-T1: Link guard — closes ISC-16, ISC-17, ISC-18
- [ ] P5-T2: Link navigation — closes ISC-74, ISC-75, ISC-76, ISC-77, ISC-78, ISC-82
- [ ] P5-T3: Broken links and history — closes ISC-79, ISC-80, ISC-81
- [ ] P5-T4: Format commands — closes ISC-83, ISC-84, ISC-85, ISC-86, ISC-87, ISC-88, ISC-89
- [ ] P5-T5: List editing — closes ISC-90, ISC-91, ISC-92, ISC-93, ISC-94
- [ ] P5-T6: Smart paste and single selection — closes ISC-95, ISC-96
- [ ] P5-T7: Drag selected text — closes ISC-177, ISC-178, ISC-179 (spike passed in P0, see decisions)

## Phase 6: Workspace ([plan](phases/phase-06/plan.md))

- [ ] P6-T1: File tree — closes ISC-97, ISC-99, ISC-105, ISC-132
- [ ] P6-T2: File operations — closes ISC-100, ISC-101, ISC-102, ISC-103, ISC-104
- [ ] P6-T3: Text and image tabs — closes ISC-106, ISC-107, ISC-108, ISC-109, ISC-110, ISC-111, ISC-112
- [ ] P6-T4: Link scanner — closes ISC-116, ISC-117, ISC-118, ISC-119, ISC-120, ISC-121, ISC-124
- [ ] P6-T5: Rewrite engine — closes ISC-113, ISC-114, ISC-115, ISC-122, ISC-125, ISC-128
- [ ] P6-T6: Rewrite UI — closes ISC-123, ISC-126, ISC-127, ISC-129, ISC-175
- [ ] P6-T7: Quick open and command palette — closes ISC-130, ISC-131

## Phase 7: Search and outline ([plan](phases/phase-07/plan.md))

- [ ] P7-T1: Find and replace — closes ISC-133, ISC-134, ISC-135, ISC-136
- [ ] P7-T2: Folder search — closes ISC-137, ISC-138, ISC-139, ISC-140
- [ ] P7-T3: Outline panel — closes ISC-141, ISC-142, ISC-143, ISC-144

## Phase 8: Configuration ([plan](phases/phase-08/plan.md))

- [ ] P8-T1: Settings and palette toggles — closes ISC-147, ISC-148, ISC-153
- [ ] P8-T2: Keybindings — closes ISC-149
- [ ] P8-T3: Theme switching and user themes — closes ISC-145, ISC-146, ISC-150, ISC-151, ISC-173
- [ ] P8-T4: Portable mode — closes ISC-152

## Phase 9: Image authoring ([plan](phases/phase-09/plan.md))

- [ ] P9-T1: Paste images — closes ISC-154, ISC-155, ISC-160
- [ ] P9-T2: Drop images — closes ISC-156
- [ ] P9-T3: Resize images — closes ISC-157, ISC-158, ISC-159

## Phase 10: Ship ([plan](phases/phase-10/plan.md))

- [ ] P10-T1: Single instance and launch arguments — closes ISC-161, ISC-162, ISC-163
- [ ] P10-T2: Security review with the hostile fixture — closes ISC-15, ISC-19, ISC-20
- [ ] P10-T3: Installer and file association — closes ISC-164, ISC-165, ISC-166
- [ ] P10-T4: Portable zip and release workflow — closes ISC-167, ISC-168
- [ ] P10-T5: README and final claim sweep — closes ISC-170
