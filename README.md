# RunForm

RunForm is a local-first running workout analyzer built with Next.js.
It imports workout JSON files, stores them in a local SQLite database, and turns raw training data into readable coaching insights, comparisons, weekly summaries, and shareable reports.

The app is designed for personal use on a local machine:

- workout history is stored locally
- AI review and next-workout planning run through a local Ollama instance
- no cloud backend is required for the current version

## What The App Does

- Imports workout JSON files into a local history
- Builds a dashboard for the latest workout
- Shows calendar-based training history
- Computes training metrics such as intensity, MET load, efficiency, zone profile, weather stress, and recovery trend
- Generates AI-assisted workout review and next-workout planning through Ollama
- Compares two workouts side by side
- Exports visual summary cards and PDF reports

## Main Features

- Latest workout dashboard with core stats
- Heart-rate zone breakdown and effort profile
- Weekly load and recovery summary
- Health and training red flags
- AI explanation of workout quality
- AI-generated next session plan
- Workout comparison mode
- Share card export
- Coach-style PDF export
- Russian and English UI support

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- better-sqlite3 for local storage
- Recharts for data visualization
- Framer Motion for motion and UI transitions
- jsPDF and html-to-image for report export
- Ollama for local LLM-powered analysis
- Tauri scaffolding is included under `src-tauri/` for a future desktop build path

## Requirements

Before running the project, make sure you have:

- Node.js 20+ recommended
- npm
- Ollama installed if you want AI features

Optional for AI:

- a local Ollama model available as `qwen2.5:3b`

The current code calls:

```text
http://localhost:11434/api/generate
```

and defaults to:

```text
qwen2.5:3b
```

## Installation

Install dependencies:

```bash
npm install
```

## Running The App

### Recommended local run

Build and start the production server:

```bash
npm run build
npm run start
```

Then open:

```text
http://localhost:3000
```

### Development mode

You can also run:

```bash
npm run dev
```

Note: in this project, production mode is currently the more reliable local launch path.

### Startup helper script

The repository includes:

```text
scripts/start-workout-app.sh
```

This script:

- checks whether Ollama is responding on `localhost:11434`
- starts Ollama if needed
- checks whether the app is already running on `localhost:3000`
- rebuilds the app when sources changed
- starts the app in production mode

Run it with:

```bash
./scripts/start-workout-app.sh
```

## Ollama Setup

If you want the AI features to work, start Ollama locally:

```bash
ollama serve
```

Make sure the expected model exists:

```bash
ollama list
```

If needed, pull the default model:

```bash
ollama pull qwen2.5:3b
```

Without Ollama, the app still opens, but AI review and AI planning actions will fail with a local error message in the UI.

## Data Storage

RunForm stores imported workouts in a local SQLite database:

```text
data/workouts.db
```

Important:

- this database is intentionally ignored by git
- your local workout history is not committed to the repository
- deleting `data/workouts.db` resets the stored history

## Input Data

The app expects workout JSON with fields such as:

- workout identity and dates
- duration, calories, distance, pace
- average, min, and max intensity
- average METs
- average, min, and max heart rate
- cadence and step count
- heart-rate zones
- weather metadata
- device metadata

Parsing logic lives in:

- [src/lib/parser.ts](/Users/dmitrijsibanov/Desktop/My_projects/RunForm/src/lib/parser.ts)

Database persistence lives in:

- [src/lib/db.ts](/Users/dmitrijsibanov/Desktop/My_projects/RunForm/src/lib/db.ts)
- [src/lib/actions.ts](/Users/dmitrijsibanov/Desktop/My_projects/RunForm/src/lib/actions.ts)

## Available Scripts

```bash
npm run dev
```

Starts the Next.js development server.

```bash
npm run build
```

Builds the production bundle.

```bash
npm run start
```

Starts the production server on port `3000`.

```bash
npm run lint
```

Runs ESLint.

## Project Structure

```text
.
├── data/                    # local SQLite database, ignored by git
├── public/                  # static assets and branding
├── scripts/                 # local startup helpers
├── src/
│   ├── app/                 # Next.js app router entrypoint
│   ├── components/          # dashboard, AI, share, and UI components
│   └── lib/                 # parsing, storage, analytics, translations, Ollama client
└── src-tauri/               # Tauri desktop scaffold
```

## AI And Analytics Modules

Core analysis logic is implemented in:

- [src/lib/ai.ts](/Users/dmitrijsibanov/Desktop/My_projects/RunForm/src/lib/ai.ts)

This module powers:

- intensity score
- running efficiency metrics
- warmup analysis
- zone profile classification
- weather stress estimation
- weekly coach summary
- AI review scaffolding
- predicted next-result summary
- workout comparison summary

The direct Ollama integration is here:

- [src/lib/ollama.ts](/Users/dmitrijsibanov/Desktop/My_projects/RunForm/src/lib/ollama.ts)

## Tauri Status

The repository contains a `src-tauri/` folder and configuration for a desktop shell.
At the moment, the primary documented run path is the Next.js web app.

If you want to evolve the desktop build later, the Tauri scaffolding is already present.

## Current Roadmap

High-level roadmap items are tracked in:

- [TODO.md](/Users/dmitrijsibanov/Desktop/My_projects/RunForm/TODO.md)

Near-term items currently listed there include:

- automatic folder import for workouts
- workout tags and categories

## Verification

The project has been verified locally with:

```bash
npm run build
```

## Notes

- The project is local-first and currently optimized for a single-user desktop workflow
- The startup helper assumes Ollama is reachable at `localhost:11434`
- The default AI model name is hardcoded in the current implementation
- The local database is excluded from version control by `.gitignore`

## License

No license has been defined yet in this repository.
