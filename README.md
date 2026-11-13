# K-map Tutor (agentic)

A web app that solves Karnaugh-map / Boolean minimisation problems and explains them step by step.

The solver is deterministic JavaScript (prime-implicant search + minimal cover) exposed to an LLM as four tools.
The LLM (Groq first, then Gemini) parses the user's input, calls the tools in order, and explains the tool
outputs. It never computes groupings itself. If no key works (missing, quota, network, failed verification),
an offline parser + template explanation is used, so the app always answers.

## Features

- **Agent loop:** `build_kmap` → `find_prime_implicants` → `select_cover` → `verify_equivalence`, shown in the UI as an "Agent trace"
- **Flexible input:** minterms (`Σm(1,3,5,7) d(0)`), plain English, or a Boolean expression such as `A'B + AB'C`
- **2, 3 and 4 variable maps** with Gray-code ordering, wrap-around groups and don't-cares
- **Step-by-step walkthrough** (Back / Next / Play) with groups drawn on the map
- **SOP and POS** minimisation, **NAND-only and NOR-only** forms
- **Logic circuit diagram** and **static-1 hazard check**
- **K-map editor:** click cells to cycle 0 / 1 / X; solved deterministically (no LLM)
- **Practice quiz:** random problems with answer checking and "give up" to reveal the solution
- **Accounts:** register / login (JWT), saved history (last 20), delete chats
- **Export / print as PDF**, light/dark theme, collapsible sidebar

## Tech stack

| Layer    | Tech |
|----------|------|
| Client   | React, Vite, plain CSS |
| Server   | Node.js (ES modules), Express 4, Mongoose (MongoDB) |
| Auth     | bcryptjs password hashing, JSON Web Tokens (7-day expiry) |
| LLMs     | Groq (OpenAI-compatible REST via `fetch`), Google Gemini (`@google/genai`) |

## Project structure

```
DE_PROJECT/
├── README.md                 This file
├── .gitignore                Ignores node_modules, .env, dist
├── client/
│   ├── index.html            Vite entry (stub, see note below)
│   ├── package.json          Client deps (React 18 / Vite 5), stub
│   ├── vite.config.js        Stub config with /api proxy to :5000
│   └── DE-PROJECT/           <-- the actual client app (run it from here)
│       ├── index.html        Vite HTML entry, mounts #root, loads src/main.jsx
│       ├── package.json      React 19, Vite 8, ESLint 10; scripts: dev, build, lint, preview
│       ├── vite.config.js    Vite + React plugin
│       ├── eslint.config.js  ESLint flat config (react-hooks, react-refresh)
│       ├── README.md         Leftover Vite template readme
│       ├── public/
│       │   ├── favicon.svg
│       │   └── icons.svg
│       └── src/
│           ├── main.jsx      Mounts <App/>, imports styles.css
│           ├── App.jsx       App shell: theme hook, API helper, Auth screen, KMapGrid,
│           │                 Solver (sidebar, history, composer, results), session handling
│           ├── extras.jsx    Stepper, TracePanel, Circuit diagram, Extras (POS/NAND/NOR/hazards,
│           │                 export), Editor (click-to-edit map), Quiz
│           ├── layout.css    Main layout: sidebar + centered composer, light/dark themes
│           ├── extras.css    Styles for the extras components (cards, controls, quiz)
│           └── styles.css    Base variables/reset and basic typography
└── server/
    ├── package.json          Scripts: dev, start, test
    ├── index.js              Express app, CORS, routes, error handler, MongoDB connect
    ├── .env.example          Template for environment variables
    ├── .env                  Local secrets (git-ignored)
    ├── middleware/
    │   └── auth.js           Verifies the Bearer JWT and sets req.userId (401 otherwise)
    ├── models/
    │   ├── User.js           { email (unique, lowercase), password (bcrypt hash) }
    │   └── Problem.js        Saved solve: user, prompt, mode, provider, reason, result,
    │                         explanation, trace (+ timestamps)
    ├── routes/
    │   ├── auth.js           POST /register, POST /login
    │   └── kmap.js           Solve, history, editor solve, quiz endpoints
    └── solver/
        ├── kmap.js           Core engine: buildKmap, findPrimeImplicants, selectCover,
        │                     verifyEquivalence, solveDeterministic, templateExplanation
        ├── agent.js          LLM orchestration: tool declarations, system prompt, Groq and
        │                     Gemini loops, retry/timeout, provider fallback, offline fallback
        ├── parse.js          Offline parser for minterm / text input (`parseProblem`)
        ├── extras.js         Boolean-expression parser, POS, NAND/NOR, hazards, walkthrough
        │                     steps, `enrich`, `offlineTrace`, quiz generator and answer checker
        └── test.js           Solver tests (fixed cases, 500 random problems, parser cases)
```

> **Note on `client/`:** the files directly in `client/` (`index.html`, `package.json`, `vite.config.js`)
> are a stub with no `src/`. The real app lives in `client/DE-PROJECT/`. Only that folder needs to be run.

## API

All `/api/kmap/*` routes require `Authorization: Bearer <token>`.

| Method | Path | Body / query | Description |
|--------|------|--------------|-------------|
| POST | `/api/auth/register` | `{ email, password }` (password ≥ 6 chars) | Create account, returns `{ token, email }` |
| POST | `/api/auth/login` | `{ email, password }` | Returns `{ token, email }` |
| POST | `/api/kmap/solve` | `{ prompt }` (max 500 chars) | Agent solve (Groq → Gemini → offline); saves to history |
| GET | `/api/kmap/history` | | Last 20 saved solves, newest first |
| DELETE | `/api/kmap/history/:id` | | Delete one of your own saved solves |
| POST | `/api/kmap/solve-direct` | `{ vars, minterms, dontCares }` | Deterministic solve for the editor (no LLM); saves to history |
| GET | `/api/kmap/quiz` | `?vars=2\|3\|4` (default 3) | Random practice problem |
| POST | `/api/kmap/quiz/check` | `{ vars, minterms, dontCares, expression, giveUp? }` | Check an answer; returns the solution when correct or given up |

Solve responses look like `{ id, prompt, mode: "agent" | "offline" | "direct", provider?, reason?, result, explanation, trace }`.

## Environment variables (`server/.env`)

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default `5000`) |
| `MONGO_URI` | MongoDB connection string (local or Atlas) |
| `JWT_SECRET` | Secret used to sign tokens |
| `GROQ_API_KEY` | Optional. Free key from https://console.groq.com/keys. Tried first |
| `GROQ_MODEL` | Groq model (default `openai/gpt-oss-120b`) |
| `GEMINI_API_KEY` | Optional. Tried after Groq |
| `GEMINI_MODEL` | Gemini model name |

Client: optional `VITE_API_URL` (default `http://localhost:5000`).

## Run

1. Start MongoDB locally (or use an Atlas URI).
2. Server:
   ```
   cd server
   cp .env.example .env     # fill MONGO_URI, JWT_SECRET, GROQ_API_KEY and/or GEMINI_API_KEY
   npm install
   npm run dev
   ```
3. Client (new terminal):
   ```
   cd client/DE-PROJECT
   npm install
   npm run dev
   ```

Scripts: server `dev` (watch), `start`, `test`; client `dev`, `build`, `lint`, `preview`.

## Tests

```
cd server && npm test
```

Runs `solver/test.js`: known minimisation results, empty/full functions, parser cases, and 500 random
problems that must all pass `verifyEquivalence`.

## Security note

`server/.env.example` currently contains what look like real credentials (a MongoDB Atlas URI with
password and a JWT secret). Replace them with placeholders and rotate those secrets.
