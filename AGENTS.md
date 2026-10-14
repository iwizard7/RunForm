<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:version-bump-rule -->
# Version Bumping Rule

Whenever you add a new feature or make a significant change to the project during your session, you MUST bump the application version in `package.json`. 
The UI relies on `package.json` to display the current app version.
Use `npm version patch` for small bugfixes or `npm version minor` for new features before you finalize and push your work!
<!-- END:version-bump-rule -->

## Инструменты анализа кодовой базы (Graphify)
В данном проекте доступна утилита Graphify для построения графа знаний и анализа связей в коде.

### Доступные команды:
- `graphify update` — сканирует репозиторий и обновляет граф знаний (строит локальный AST). Результаты сохраняются в папку `graphify-out/`.
- `graphify query "ваш запрос"` — задает семантический вопрос по структуре графа.
- `graphify explain` — генерирует отчет по архитектуре.

### Правила использования:
1. Если пользователь просит "показать архитектуру", "найти скрытые зависимости" или "объяснить логику крупного модуля", сначала обнови граф с помощью `graphify update`.
2. Используй файл `graphify-out/GRAPH_REPORT.md` для получения высокоуровневой справки по проекту.
3. Не загружай весь `graph.json` в контекст, если он превышает лимиты, читай целевые отчеты.
4. После изменения кода выполняй `graphify update`, чтобы граф оставался актуальным.

## Commands

```bash
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"   # required — see the Node 20 note
npm run lint          # eslint (flat config)
npm run test:logic    # full chain: compile + 5 suites
npm run build         # production build
```

- **Node 20 is mandatory**: `.nvmrc` and CI pin 20; `better-sqlite3` is compiled for the Node 20 ABI and fails to load under the shell default (Node 26). `npm run test:logic` resolves the correct binary for the suite processes itself via `test/resolve-node.mjs` (override with `RUNFORM_TEST_NODE`), but run tsc and builds under Node 20 too, to match CI.
- Verify in CI order: `lint → test:logic → build`.
- Run a single suite (compile once, pick the suite):
  ```bash
  npx tsc -p tsconfig.test.json && TEST_NODE=$(node test/resolve-node.mjs) \
    && "$TEST_NODE" --require ./test/alias-hook.cjs .test-build/test/training-load.test.js
  ```
- Suites: `parser` (import parsing, route matching, segments math), `personal-best`, `training-load`, `app-version`, and `db` — the DB suite must go through `test/db-entry.cjs`, which creates a throwaway `RUNFORM_DATA_DIR`; never point tests at the real `data/workouts.db`.
- Adding a new `test/*.test.ts` file requires appending it to the `test:logic` chain in `package.json`; otherwise the suite silently never runs.

## Architecture

- Almost all UI is a single client component: `src/app/page.tsx` (~4.2k lines) — a tab-based SPA (dashboard, history, fitness, plans, routes, chat, settings) inside the App Router. Feature work usually lands here plus a hook in `src/hooks/` (`useWorkoutData`, `useRunFormData`, `useAiCoach`, `useAiExtras`, …) that page.tsx destructures.
- `src/lib/db.ts` — better-sqlite3, WAL, `foreign_keys = ON`. Schema changes go through `applyMigration(N, fn)` (tracked in `schema_migrations`; currently up to 10). Foreign keys cascade: deleting a route or workout removes dependent rows (segments, efforts, personal bests).
- `src/lib/actions.ts` — all `use server` actions; it also owns the row↔client mappers. **Adding a DB column touches several places**: the migration in `db.ts`, the row type, the row→client mapping, `WorkoutData` in `parser.ts`, and import/export parsing if the field comes from Apple Health files.
- **Never re-export types from a `'use server'` file through another module** — Turbopack fails to build the manifest. Import types directly with `import type { … } from '@/lib/actions'`; action *functions* import fine (statically from hooks, or dynamically inside `page.tsx` handlers).
- Pure, tested logic lives in `src/lib/*.ts` (`parser`, `training-load`, `segments`, `race-plan`, `week`, `ai`) and must stay client-safe — no better-sqlite3 imports there.
- AI features call local Ollama (`src/lib/ollama.ts`, default `http://localhost:11434`). Model output is never trusted: extract the JSON from the reply, validate strictly (e.g. `validateRaceSessions`), and retry with a self-correction prompt (the `*_MAX_ATTEMPTS` pattern in `useAiCoach` / `useRacePlan`).
- UI conventions: inline `style={{}}` objects plus `premium-card` / `secondary-text` classes from `globals.css`; lucide-react icons; every user-facing string is bilingual via inline `lang === 'ru' ? … : …` — there is no string catalog, so new UI needs both languages.
- Finishing a feature: bump the version (rule above), sync `src-tauri/tauri.conf.json` `version` with `package.json`, add a `## Changelog` entry in `README.md`, run `graphify update`.

## Data & local deployment

- Data dir resolution (`src/lib/data-dir.ts`): `RUNFORM_DATA_DIR` → `<cwd>/data` → platform user-data folder. The live database is `data/workouts.db` (`/data/` is gitignored).
- The installed copy lives at `~/RunForm` (a separate clone holding the real DB); `RunForm.app` in /Applications runs `scripts/start-workout-app.sh`, which serves Next on `:3000` (launcher log: `/tmp/runform-launcher.log`). Deploy = `git pull` in `~/RunForm`, stop the process on `:3000`, relaunch the app.
- After relaunching, confirm the port actually serves (`lsof -tiTCP:3000` + curl) — restarting has raced before, leaving a hung listener that accepts nothing.
- `docs/` is published to GitHub Pages on push; changes to `docs/**` trigger the deploy workflow.
