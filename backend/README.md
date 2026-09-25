# SIH Thermal Shelter — backend

FastAPI service for **SIH Problem Statement 51: Software Based Model Development
for Design of Area Specific Shelter for Thermal Comfort Maintenance**.

---

## What this service is, and what it deliberately is not

The frontend is a **complete, self-contained application**. Every engine —
climate classification, thermal simulation, ISO 7730 PMV/PPD, ASHRAE 55 adaptive
comfort, solar geometry, cost modelling, optimisation — has a verified TypeScript
implementation that runs in the browser in about two milliseconds per candidate.

**Nothing in this service is required for the demo to work.** That is a design
decision, not an oversight: a prototype that needs a Python process and a network
connection to show anything is a prototype that fails in the room it is presented
in.

The service exists because three things genuinely belong on a server:

| Capability | Why it cannot live in the browser |
|---|---|
| **Climate caching** | Resolving a site is a network fetch plus an aggregation over five years of daily reanalysis. Do it once, serve it to everyone. |
| **Persistence** | A saved design that survives a page reload is not something a browser can offer. |
| **Model serving** | Training a gradient-boosted surrogate is CPU-bound, and the artefact is too large to ship to a client. |

### What it deliberately does *not* do

**It does not re-implement the thermal physics.**

`thermal/thermalModel.ts` is 954 lines of quasi-steady-state heat balance,
verified by 70 assertions plus PMV and periodic-response reference checks.
Porting it to Python would create a second authority on thermal performance that
can disagree with the first — and a disagreement between two "correct" answers is
worse than one answer, because it makes both untrustworthy.

So the Python side **consumes** the verified engine's output:

- `scripts/export-catalogue.ts` exports stations, materials and vocabularies to
  JSON. TypeScript stays the single source of truth for *data*.
- `scripts/export-dataset.ts` labels training rows by **running** the verified
  engine. The surrogate therefore learns the truth, not a port's approximation
  of it.

The one exception is `app/climate.py`, which *is* a port of `deriveClimate.ts` and
`classify.ts` — because climate resolution is genuinely a server job. It is
guarded by `tests/test_parity.py`, which compares all 33 stations × 12 months × 9
fields against values captured from the TypeScript engine. A shape check cannot
catch a unit error; that can.

---

## Quick start

```bash
cd backend

# 1 — create the environment
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt      # Windows, core set
# source .venv/bin/activate && pip install -r requirements.txt   # macOS / Linux

# 2 — generate the catalogue and dataset from the TypeScript engine
cd ..
npx tsx scripts/export-catalogue.ts
npx tsx scripts/export-dataset.ts

# 3 — run
cd backend
.venv/Scripts/python run.py
```

- API docs: <http://127.0.0.1:8000/docs>
- Health: <http://127.0.0.1:8000/api/health>

### Why two requirements files

`requirements.txt` is the **core** set: everything needed to start the service
and serve every endpoint except the two that touch a trained model. It is
deliberately small, because a 200 MB scientific stack should not be a prerequisite
for a service whose main job is caching climate data and persisting designs.

`requirements-ml.txt` adds XGBoost, scikit-learn, pandas and joblib for
`POST /api/ml/train` and `POST /api/optimize`. The imports in `app/ml.py` are lazy
for exactly this reason, so the service starts without them and reports
`surrogateReady: false` rather than refusing to boot.

### Train the surrogate (optional)

The service works without a trained model. `POST /api/optimize` returns **503**
until one clears its validation gate — that refusal is the feature, not a bug.

```bash
# from the project root
npx tsx scripts/train-surrogate.ts
```

This posts the exported dataset to `/api/ml/train`, prints held-out R², rank
correlation, MAE and RMSE per target, and reports whether the model passed the
gate. `--rows`, `--trees`, `--depth`, `--lr` and `--test` tune the run.

The dataset is sized for the gate rather than for the exporter: labelling costs
about a second per 1 000 rows, so the default `npx tsx scripts/export-dataset.ts`
writes 12 000 rows in ~12 s and is enough to clear every target. The metrics in
the table below come from 40 000 rows (`--rows 40000`, ~39 s to label).

### Point the frontend at it

```bash
# .env.local in the project root
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

The frontend then delegates climate resolution to this service, and falls back to
its own offline engine the moment the service is unreachable.

### Tests

```bash
cd backend
.venv/Scripts/python -m pytest              # 223 tests: parity, wire contract, gate
.venv/Scripts/python -m pytest tests/test_parity.py -v
```

`test_parity.py` compares the Python climate port against values captured from the
TypeScript engine for all 33 stations × 12 months × 9 fields, plus the Köppen
classifier and the feature contract. `test_api.py` checks the wire shape — the
field names copied from `types/climate.ts`, because the client casts the response
without validation and a renamed field would arrive as `undefined` rather than
raising.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness and capability. `surrogate_ready` is true only when a model actually passed its gate. |
| `POST` | `/api/climate/resolve` | **The endpoint the frontend calls.** `{ location, prefer_live }` → `ClimateData`. |
| `GET` | `/api/climate/resolve/{station_id}` | Convenience GET for a catalogue station. |
| `GET` | `/api/climate/stations` | Every station, optionally filtered by country. |
| `GET` | `/api/climate/countries` | Distinct countries. |
| `GET` | `/api/climate/stations/{station_id}` | Raw monthly normals. |
| `GET` | `/api/climate/nearest` | Nearest station to a coordinate, with distance. |
| `GET` | `/api/climate/preview` | Climate for an arbitrary coordinate (interpolated or synthesised). |
| `GET` | `/api/materials` | Wall, roof, window and insulation assemblies. |
| `GET` | `/api/vocabulary` | The shared mappings: insulation thickness, ACH, roof pitch. |
| `GET` | `/api/requirements/default` | The documented default design programme. |
| `GET` | `/api/ml/contract` | The 42-feature / 3-target contract. |
| `GET` | `/api/ml/registry` | Trained models and their held-out metrics. |
| `POST` | `/api/ml/train` | Fit one booster per target. |
| `POST` | `/api/ml/predict` | Predict all three targets from one feature vector. |
| `POST` | `/api/optimize` | Screen a design neighbourhood with the surrogate. |
| `GET` | `/api/design-space` | The axes the screen endpoint explores, and the space size. |
| `GET`/`POST`/`DELETE` | `/api/designs` | Saved designs. |

---

## The validation gate

A surrogate that has not been checked against held-out physics is worse than no
surrogate, because it is confidently wrong. `app/ml.py` mirrors the gate in
`ml/surrogate.ts` exactly:

| Target | Min rank correlation | Max MAE |
|---|---|---|
| `energy_use_intensity_kwh_m2_yr` | 0.90 | 15 kWh/m²·yr |
| `adaptive_comfort_hours_pct` | 0.90 | 6 % |
| `cost_per_m2_inr` | 0.90 | ₹2,500/m² |

### Why rank correlation and not R²

The gate is **Spearman rank correlation plus MAE**. The surrogate exists to *rank*
candidate designs so the optimiser can pick a winner, and R² measures absolute
fit — which is the wrong instrument for one of the three targets.

`adaptive_comfort_hours_pct` is a count of comfortable hours out of 8 760. It is
bounded to [0, 100], quantised by the thermal model's time resolution, and has
about a quarter of its mass pinned at exactly zero. A squared-error regressor
cannot fit quantisation noise that is not a function of its inputs, so its R² is
capped below 1 no matter how much data it is given. Measured on 40 000 rows:

| rows | energy R² | comfort R² | comfort ρ |
| ---: | --------: | ---------: | --------: |
| 1 500 | 0.875 | 0.762 | — |
| 12 000 | 0.959 | 0.882 | — |
| 40 000 | 0.979 | 0.892 | **0.936** |

The curve is asymptoting just under 0.90 while the ranking is already excellent.
Gating on R² would refuse a model that is good at the only job it has. R² is
still reported on every model so the censoring effect stays visible.

A model must clear **every** target. A screening tool that can rank energy but
not comfort would rank designs by the wrong thing.

The gate is **not configurable by environment variable.** It is part of the model
contract and lives beside `FEATURE_NAMES` in `app/ml.py`, so a deployer cannot
relax it into usefulness. `assert_contract()` also checks the gate against
`data/feature-contract.json`, so the TypeScript and Python copies cannot drift
into disagreement about what "good enough" means.

Failed models are still recorded — with their metrics and `passedGate: false` —
because a failed validation is a result worth reporting, not something to hide.
`POST /api/ml/predict` and `POST /api/optimize` refuse them with a **503** and the
reason intact.

### What `/api/optimize` returns, and why it is not an `OptimizationResult`

The frontend's own optimiser returns a full `OptimizationResult`: parameters, a
complete 40-field `ThermalComfort`, a cost breakdown, a leaderboard.

This endpoint does not, and pretending otherwise would be the most dishonest
thing in the project. Filling a 40-field `ThermalComfort` from three surrogate
predictions would mean **inventing the other 37 fields**.

So the response is narrower and true:

```json
{
  "engine": "ml-surrogate",
  "method": "coordinate-descent",
  "modelId": "…",
  "candidatesEvaluated": 88,
  "spaceSize": 3265920,
  "leaderboard": [
    {
      "id": "screen-1",
      "label": "orientation → 180",
      "parameters": { "…": "…" },
      "predictions": {
        "energy_use_intensity_kwh_m2_yr": 41.2,
        "adaptive_comfort_hours_pct": 71.4,
        "cost_per_m2_inr": 28400
      },
      "errorBars": { "energy_use_intensity_kwh_m2_yr": 2.8, "…": "…" },
      "objective": 0.31,
      "score": 69
    }
  ],
  "disclaimer": "These are surrogate predictions, not simulations. …"
}
```

Note `candidatesEvaluated: 88` against `spaceSize: 3265920`. The search is
coordinate descent, not a full cross product — sweeping one axis at a time finds
the same optimum in a few dozen evaluations, and every axis can be explained.
Reporting both numbers is what stops the service from claiming a search it did
not perform.

---

## Layout

```
backend/
├── app/
│   ├── main.py         FastAPI app, CORS, error handlers, lifespan
│   ├── config.py       Settings from the environment
│   ├── models.py       Wire schemas — camelCase, mirroring types/ in the frontend
│   ├── climate.py      Port of climate/deriveClimate.ts + classify.ts (parity-tested)
│   ├── catalog.py      Stations, materials, vocabulary from the exported JSON
│   ├── units.py        Pressure, wet-bulb, angle helpers
│   ├── db.py           SQLAlchemy 2.0 — SQLite by default, PostgreSQL by config
│   ├── ml.py           Feature contract, XGBoost training, gated inference
│   ├── optimize.py     Design-space enumeration + surrogate screening
│   └── routers/        health, climate, catalogue, ml_routes, optimize, designs
├── data/               Generated. Do not edit by hand.
│   ├── stations.json           ← scripts/export-catalogue.ts
│   ├── materials.json          ← scripts/export-catalogue.ts
│   ├── vocabulary.json         ← scripts/export-catalogue.ts
│   ├── feature-contract.json   ← scripts/export-dataset.ts
│   ├── training-set.json       ← scripts/export-dataset.ts
│   └── climate-fixtures.json   ← scripts/export-dataset.ts
├── tests/
│   ├── test_parity.py  Python climate port vs captured TypeScript output
│   └── test_api.py     Wire-contract tests
├── requirements.txt      Core runtime — starts the service
├── requirements-ml.txt   Adds XGBoost / scikit-learn for the two ML endpoints
├── run.py
└── .env.example
```

---

## Database

Defaults to SQLite so the service runs with no infrastructure:

```
sqlite:///./thermal_shelter.db
```

Point `DATABASE_URL` at PostgreSQL for the deployment topology the architecture
diagram claims:

```
DATABASE_URL=postgresql+psycopg://shelter:shelter@localhost:5432/shelter
```

The repository layer in `db.py` is identical either way — SQLAlchemy 2.0 with a
JSON column type, so there is no branching on dialect. `init_db()` creates the
schema on startup and `seed_stations()` loads the exported catalogue
idempotently.

Three tables:

- `stations` — one row per climatology station, monthly normals as JSON.
- `saved_designs` — the programme plus whatever metrics were recorded with it.
  Metrics are a JSON blob on purpose: they are model *output*, not data the
  service owns, and the shape changes whenever the engine gains a metric.
- `surrogate_models` — one row per (model, target), so the evidence that a model
  earned its place is queryable.

---

## Honesty statement

Every comfort, energy and cost figure produced by this system — in the frontend
or here — is the output of a **simplified quasi-steady-state monthly heat-balance
model**. It is an engineering estimate, not a measurement and not a validated
whole-building simulation.

The surrogate adds a second layer of estimation on top. That is why every
prediction travels with its held-out error bar, and why the physics engine
remains the authority on what any design actually does.
