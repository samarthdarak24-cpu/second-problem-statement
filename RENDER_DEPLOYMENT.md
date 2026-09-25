# Deploying on Render

The backend is a FastAPI service. `render.yaml` at the repo root is a Render
**Blueprint**: it declares the web service, a managed PostgreSQL database, and
every environment variable the service reads. Clicking "New → Blueprint" is the
whole deployment.

The frontend deploys separately on Vercel — see [Connecting the
frontend](#connecting-the-frontend) below.

```
GitHub repo
├── render.yaml          ← Blueprint: web service + database + env vars
├── backend/             ← FastAPI service (this is what Render builds)
│   ├── .env.example     ← every setting, for local development
│   ├── .env.render      ← the same settings, for Render
│   ├── Procfile         ← web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
│   ├── runtime.txt      ← python-3.11.9
│   └── requirements.txt ← core deps, incl. the psycopg PostgreSQL driver
└── frontend/            ← Next.js app (deployed to Vercel, not Render)
```

---

## 1. Blueprint deploy (recommended)

1. Go to <https://dashboard.render.com> → **New +** → **Blueprint**.
2. Connect the repository and select it.
3. Render reads `render.yaml` and shows two resources before you commit to
   anything:
   - **`thermal-shelter-api`** — a Python web service, `rootDir: backend`,
     health check on `/api/health`.
   - **`thermal-shelter-db`** — a managed PostgreSQL 16 database.
4. Edit the one placeholder that Render cannot guess: the `CORS_ORIGINS` value.
   See [Connecting the frontend](#connecting-the-frontend).
5. Click **Apply** and wait for the first build.

`DATABASE_URL` needs no attention. The Blueprint injects it from the database
resource:

```yaml
- key: DATABASE_URL
  fromDatabase:
    name: thermal-shelter-db
    property: connectionString
```

Do not also set `DATABASE_URL` by hand — a manual value overrides the injected
one and points the service at a SQLite file that will not survive a deploy.

### Region and plan

`render.yaml` pins both resources to `singapore` on the free plan. Keep the
service and the database in the **same region** or every query pays a
cross-region round trip. Change both, or neither.

---

## 2. Manual deploy

If you would rather not use the Blueprint:

1. **Create the database** — New + → PostgreSQL. Note the *Internal Database
   URL*.
2. **Create the web service** — New + → Web Service, then set:

   | Field | Value |
   |---|---|
   | Root Directory | `backend` |
   | Runtime | Python 3 |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
   | Health Check Path | `/api/health` |

3. **Add the environment variables** — open `backend/.env.render` and paste its
   contents into Environment → *Add from .env*, then fill in `DATABASE_URL` and
   your real `CORS_ORIGINS`.

---

## 3. Environment variables

`backend/app/config.py` defines **exactly twelve** settings. These are the only
keys that do anything:

| Variable | Default | Notes |
|---|---|---|
| `APP_NAME` | `SIH Thermal Shelter API` | Cosmetic |
| `VERSION` | `1.0.0` | **Not** `APP_VERSION` |
| `DEBUG` | `false` | Keep false in production |
| `DATABASE_URL` | SQLite file | Injected by the Blueprint. Use the `postgresql+psycopg://` scheme |
| `SQL_ECHO` | `false` | Logs every SQL statement — noisy |
| `CORS_ORIGINS` | localhost only | **Comma-separated**, not JSON |
| `OPEN_METEO_BASE` | Open-Meteo archive | Leave as is |
| `OPEN_METEO_TIMEOUT_S` | `20.0` | Live archive request budget |
| `LIVE_PROBE_TIMEOUT_S` | `4.0` | Shorter budget before falling back offline |
| `ENABLE_LIVE_CLIMATE` | `true` | Set `false` for fully deterministic, instant responses |
| `MODEL_DIR` | `./models` | Git-ignored, so empty on a fresh deploy |
| `MIN_TRAIN_ROWS` | `200` | Minimum dataset size before training starts |

`PYTHON_VERSION` is read by Render itself, not by the app.

Anything else — `SECRET_KEY`, `OPTIMIZATION_ALGORITHM`,
`OPTIMIZATION_GENERATIONS`, `CACHE_TYPE`, `SESSION_TIMEOUT_MINUTES`,
`EXPORT_FORMATS`, `ML_SURROGATE_MODEL`, and the rest — configures nothing. The
service ignores unknown keys by design, so they are harmless but misleading.

There is **no secret to set**. The service holds no credentials of its own; the
Open-Meteo API needs no key. If you add one later, use Render's Environment
page rather than a committed file.

---

## 4. Connecting the frontend

Two values have to agree, and getting them wrong is the most common failure:

**On Vercel** (frontend) — set the backend's public URL, with no trailing slash:

```
NEXT_PUBLIC_API_URL=https://thermal-shelter-api.onrender.com
```

This is already declared in `frontend/vercel.json` as a placeholder; override it
in **Project → Settings → Environment Variables** so the committed default is
not used.

**On Render** (backend) — set `CORS_ORIGINS` to the frontend's URL:

```
CORS_ORIGINS=https://your-frontend.vercel.app,http://localhost:3000
```

> **The single most common mistake.** `config.py` splits `CORS_ORIGINS` on
> commas. A JSON array —
> `["https://your-frontend.vercel.app","http://localhost:3000"]` — is not
> parsed into a list; it becomes one malformed origin, and every browser request
> from the dashboard fails its CORS preflight. Use commas, no brackets, no
> quotes.

If you use Vercel preview deployments, add the preview domain too, or those
builds will be blocked while production works.

The frontend does **not** need the backend. With `NEXT_PUBLIC_API_URL` unset the
app runs every engine in the browser. The backend is an upgrade — climate
caching, persistence, surrogate serving — not a dependency.

---

## 5. Verifying the deployment

```bash
# Should return JSON with "status": "ok"
curl https://thermal-shelter-api.onrender.com/api/health

# Interactive API docs
open https://thermal-shelter-api.onrender.com/docs
```

Then confirm the catalogue came through, which proves the database and the
exported JSON both loaded:

```bash
curl https://thermal-shelter-api.onrender.com/api/climate/stations
curl https://thermal-shelter-api.onrender.com/api/materials
```

Finally, load the frontend and check the header. A **Backend** toggle appears
once `NEXT_PUBLIC_API_URL` is set, and the climate panel's provenance chip
should read that the FastAPI service answered.

---

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| CORS errors in the browser, but `curl` works | `CORS_ORIGINS` is a JSON array instead of comma-separated, or the frontend URL is missing |
| `503` from `/api/optimize` | Expected on a fresh deploy. The surrogate gate refused the model, or none is trained — `backend/models/` is git-ignored. Train one, or use the browser engine |
| `503` at startup, `FileNotFoundError` | A catalogue JSON is missing from `backend/data/`. Regenerate with `npx tsx scripts/export-catalogue.ts` |
| `503`, `surrogate-failed-validation-gate` | The trained model did not clear the rank-correlation gate. This is the gate working, not a bug |
| First request after idle takes ~30 s | Free web services spin down when idle and cold-start on the next request |
| Database connection refused | Service and database in different regions, or `DATABASE_URL` set by hand and overriding the injected value |
| `DATABASE_URL` works locally, fails on Render | SQLite path. Use the `postgresql+psycopg://` URL from the Render database page |

Free-plan caveats worth knowing before a demo: web services sleep after a period
of inactivity, and free PostgreSQL instances have a limited lifetime — check
Render's current pricing page for the exact terms. For a live demo, hit
`/api/health` a minute beforehand to wake the service.

---

## 7. What is deliberately not configurable

The surrogate's accuracy gate — minimum Spearman rank correlation and maximum
MAE, per target — lives beside `FEATURE_NAMES` in `backend/app/ml.py`, mirroring
`ml/surrogate.ts` in the frontend. It is **not** an environment variable, so a
deployer cannot relax it into usefulness. Only `MIN_TRAIN_ROWS` is tunable.

A model that fails the gate is recorded with `passedGate: false`, reported as
`surrogateReady: false` by `/api/health`, and refused with HTTP 503 by
`/api/optimize`. `surrogateReady` requires *every* target to pass, because a
model that can rank energy but not comfort would rank designs by the wrong
thing.

---

## 8. Related files

| File | Purpose |
|---|---|
| `render.yaml` | The Blueprint — service, database, env vars |
| `backend/.env.render` | The same settings as a paste-ready template |
| `backend/.env.example` | Local development, every setting documented |
| `backend/Procfile` | Start command (Heroku-style, harmless on Render) |
| `backend/runtime.txt` | Python version pin |
| `frontend/vercel.json` | Vercel build config + `NEXT_PUBLIC_API_URL` placeholder |
| `backend/README.md` | What the service does, and what it deliberately does not |
