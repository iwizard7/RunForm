# RunForm Optimization Steps And Rollback Guide

This file documents the optimization work applied to the project in a strictly ordered way.
Each step contains:

- goal
- files changed
- expected result
- how to rollback only that step if needed

The intent is to make selective rollback possible without guessing.

## Before Any Rollback

1. Check the current git status:

```bash
git status
```

2. Inspect commits:

```bash
git log --oneline --decorate -n 20
```

3. If you want to rollback only one logical step, prefer reverting files from that step instead of hard-resetting the whole branch.

## Step 1. Add Rollback Documentation

Goal:

- add a persistent record of every optimization and how to undo it

Files:

- `docs/OPTIMIZATION_STEPS_AND_ROLLBACK.md`

Expected result:

- the project contains an internal migration and rollback guide

Rollback:

```bash
git restore --source=HEAD~1 docs/OPTIMIZATION_STEPS_AND_ROLLBACK.md
```

Or remove only the file:

```bash
rm docs/OPTIMIZATION_STEPS_AND_ROLLBACK.md
```

## Step 2. Consolidate Dashboard Data Loading

Goal:

- replace two separate server reads (`getLatestWorkout` + `getAllWorkouts`) with a single server action
- reduce duplicated SQLite access during refresh

Files expected in this step:

- `src/lib/actions.ts`
- `src/hooks/useWorkoutData.ts`
- `src/app/page.tsx`

Expected result:

- the client refresh path reads history once
- latest workout is derived from the same payload

Rollback:

1. Restore previous action signatures:

```bash
git restore --source=<commit-before-step> src/lib/actions.ts
```

2. Restore page data-loading logic:

```bash
git restore --source=<commit-before-step> src/app/page.tsx
```

3. Remove the hook if it was added only for this step:

```bash
rm -f src/hooks/useWorkoutData.ts
```

## Step 3. Move Ollama Access To The Server Layer

Goal:

- stop calling Ollama directly from the browser
- centralize timeout, error handling, and model selection on the server

Files expected in this step:

- `src/app/api/ollama/route.ts`
- `src/lib/ollama.ts`
- `src/hooks/useAiCoach.ts`
- `src/app/page.tsx`

Expected result:

- the browser talks only to `/api/ollama`
- Ollama host and model are configured server-side

Rollback:

1. Remove the route handler:

```bash
rm -f src/app/api/ollama/route.ts
```

2. Restore the previous browser-side implementation:

```bash
git restore --source=<commit-before-step> src/lib/ollama.ts src/app/page.tsx
```

3. Remove or restore the AI hook:

```bash
rm -f src/hooks/useAiCoach.ts
```

## Step 4. Harden SQLite Initialization And Migrations

Goal:

- create the `data/` directory automatically
- formalize schema migration handling
- add indexes for common reads
- avoid fragile one-off `ALTER TABLE` startup logic

Files expected in this step:

- `src/lib/db.ts`

Expected result:

- fresh clones start cleanly
- DB startup is deterministic
- queries ordered by `start_date` are cheaper

Rollback:

1. Restore the old DB bootstrap:

```bash
git restore --source=<commit-before-step> src/lib/db.ts
```

2. If the migration system created new SQLite metadata tables or indexes and you want to remove them from a local DB, inspect manually first:

```bash
sqlite3 data/workouts.db ".schema"
```

Then drop only the added objects if required.

Important:

- do not delete `data/workouts.db` unless you intentionally want to wipe local history

## Step 5. Replace Weak Fallback UUID Generation

Goal:

- replace `Math.random()` fallback ids with `crypto.randomUUID()`

Files expected in this step:

- `src/lib/parser.ts`

Expected result:

- imported workouts get stable collision-resistant IDs when source JSON does not contain one

Rollback:

```bash
git restore --source=<commit-before-step> src/lib/parser.ts
```

## Step 6. Extract Client Logic Into Hooks And Helper Modules

Goal:

- reduce the amount of non-UI logic inside `src/app/page.tsx`
- separate responsibilities into reusable modules

Files expected in this step:

- `src/hooks/useWorkoutData.ts`
- `src/hooks/useAiCoach.ts`
- `src/hooks/useWorkoutExports.ts`
- `src/lib/home-metrics.ts`
- `src/app/page.tsx`

Expected result:

- page-level component becomes easier to read
- data loading, AI orchestration, exports, and derived metrics become isolated

Rollback:

1. Restore the old page:

```bash
git restore --source=<commit-before-step> src/app/page.tsx
```

2. Remove the extracted modules if you want to fully undo the step:

```bash
rm -f src/hooks/useWorkoutData.ts
rm -f src/hooks/useAiCoach.ts
rm -f src/hooks/useWorkoutExports.ts
rm -f src/lib/home-metrics.ts
```

## Step 7. Verification

After each major step, the expected checks are:

```bash
npm run lint
npm run build
```

Expected result:

- lint passes
- production build passes

Rollback:

- if a step breaks build or lint, restore only the files listed for that step

## Full Rollback

If you decide to rollback the entire optimization batch as one unit:

1. Find the commit immediately before the optimization work:

```bash
git log --oneline --decorate
```

2. Revert the batch with a new commit:

```bash
git revert <start_commit>^..<end_commit>
```

If the optimization batch is a single commit:

```bash
git revert <commit>
```

Avoid destructive rollback unless you explicitly want to discard local work:

```bash
git reset --hard <commit>
```

Use that only if you are sure there are no local changes worth keeping.
