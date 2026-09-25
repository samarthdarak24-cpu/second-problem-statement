# Area-Specific Thermal Comfort Shelter Design

**SIH Problem Statement 51** — *Software Based Model Development for Design of Area
Specific Shelter for Thermal Comfort Maintenance.*

A parametric shelter-design tool: pick a site, and the software classifies its
climate, designs an envelope for it, simulates the thermal performance, prices it,
searches the design space for a better answer, and shows you the building in 3D —
with the reasoning behind every decision.

```
INPUT → CLIMATE → ANALYSIS → THERMAL → OPTIMISATION → PARAMETERS → 3D → RESULTS
```

Every stage of that chain is visible in the interface, reports its own duration,
and can be selected to see what it actually did. The chain is the point: a tool
that produces a number without showing where it came from is a tool nobody should
trust.

---

## What it does

| | |
|---|---|
| **Parametric 3D model** | Geometry is built from the design parameters, not loaded from a file. Change the roof pitch and the roof changes. |
| **The three required outputs** | Predicted indoor temperature, thermal energy from solar radiation, and heat flow through the envelope and openings — reported for a representative day, hour by hour, and surfaced before anything else. |
| **Climate analysis engine** | Classifies the site into one of eight climate zones and derives the dominant thermal challenge, then proposes ventilation, insulation, shading, window ratio, orientation and glazing. |
| **Thermal comfort engine** | A monthly quasi-steady-state heat balance with ISO 7730 PMV/PPD for conditioned operation and ASHRAE 55 adaptive comfort for the free-running case. |
| **Optimisation** | Coordinate descent over a curated design neighbourhood, scored on thermal discomfort, energy and cost. |
| **Openings — size *and* position** | The search moves the window-to-wall ratio **and** the facade the glass sits on, choosing between six named distributions (balanced, south-led, south+east, south+west, north-shielded, east+west). Orientation decides where the sun is; the glazing strategy decides where the window is. At Leh in January the two extremes differ by 15 % in solar gain. |
| **Heat flow, per component** | Walls, roof, floor, windows, doors and ventilation, each with its own conductance and its own driving temperature — sol-air for opaque surfaces, outdoor air for glazing and doors, and the **ground** for the floor. |
| **Composite assemblies** | Six multi-layer build-ups (four walls, two roofs), with the U-value, areal mass and daily storage all derived by walking the layer stack — each layer at its own penetration depth. |
| **Phase-change materials** | A PCM layer stores latent heat through the effective heat capacity method. It is **not** assumed to help: outside its melting band it contributes nothing but its sensible heat, so the same assembly helps in Pune (mean 24.5 °C) and does nothing in Leh (5.6 °C). |
| **Before / after** | Every result is compared against conventional local construction — brick walls, RCC roof, single glazing, no insulation. |
| **Nine visualisation modes** | Normal, heat map, air flow, solar, floor plan, front, side, top, walkthrough. |
| **Climate Response Lab** | Runs the whole pipeline five times along one axis — same site with five building types, or one building at five sites — and draws every result at size from its own geometry. |
| **Explained recommendations** | Each recommendation carries a measured effect and a plain-language reason. |

### The three required outputs

The problem statement asks for three specific quantities, and they lead the
interface rather than trailing it:

| # | Output | Where it comes from |
|---|---|---|
| 1 | **Predicted shelter indoor temperature** | `dailyProfile.points[].indoorTemp` — the free-running response, hour by hour |
| 2 | **Thermal energy from solar radiation** | `dailyProfile.solarGainKwh`, with the peak hour and the per-m² figure |
| 3 | **Heat flow from the ΔT across the envelope** | `dailyProfile.wallKwh / roofKwh / windowKwh / ventilationKwh`, signed into the zone |

All three are *transient*, so the panel at the top of the Overview and the Design
Studio leads with a **24-hour curve**: indoor and outdoor temperature on one
axis, with the freezing line marked. A monthly mean cannot show that a Ladakhi
shelter peaks in the afternoon and falls back toward outdoor conditions after
sunset — and that fall is the whole engineering problem.

The design-critical month is chosen by the simulation, not the user: a shelter
whose annual heating demand exceeds its cooling demand is judged on its coldest
month, and the reverse for a cooling-dominated climate. The panel labels which.

Every figure is labelled **"Model estimate — not a measured building result"** on
its face.

### The five-site demo

The scenario the tool is built around — one design brief, five climates, five
different buildings:

| Site | Zone | Comfort hours | EUI (kWh/m²·yr) | What the optimiser chose |
|---|---|---|---|---|
| Pune | Hot semi-arid | 67 % | 22.5 | flat roof, no added insulation |
| Leh | Cold desert | 25 % | 33.5 | flat roof, **very high** insulation |
| Jodhpur | Hot desert | 31 % | 26.7 | flat roof, medium insulation |
| Chennai | Hot humid | 31 % | 38.2 | flat roof, low insulation |
| Shillong | Temperate highland | 100 % | 10.4 | flat roof, high insulation |

Leh needs insulation and Shillong needs almost nothing; that difference is the
whole point of "area-specific".

> These figures come from the offline climatology database, so they are
> reproducible. Where the live Open-Meteo reanalysis is reachable the values move
> by a few per cent — the interface labels which source answered, and records
> every provider that failed on the way.

### The Climate Response Lab

A single optimised building on a single site proves nothing — there is nothing
to compare it against. The claim this project actually makes is *conditional*:

```
same site  →  five building types  →  five different optimised designs
same type  →  five sites           →  five different optimised designs
```

`/dashboard/scenarios` runs the real pipeline five times along whichever axis is
selected and puts the results side by side. It is not a second evaluation path:
every cell goes through the same `optimizeDesign → evaluateDesign →
conventionalBaseline` chain the Design Studio uses, on the same physics, with the
same objective and the same weights. If the studio says a design scores 71, the
sweep says 71.

What makes it a demonstration rather than a table:

- **The five are drawn.** Each column renders its own building from the
  `ShelterGeometry` its numbers came from, so the forms are visibly different
  before a single figure is read.
- **The hero shows one at size.** Click any column to load it into a full-size
  interactive viewport with the four climate-response modes (Normal, Heat map,
  Air flow, Solar).
- **The variant switch changes the building, not just the figures.** Traditional
  / AI-optimised / Low-cost are three genuinely different designs the same search
  evaluated — switching redraws the envelope.
- **The reason is attached.** Under the model: what the search changed against
  conventional construction, and — on the location sweep — what the *site*
  changed against the reference site, axis by axis.

Running Pune → Jodhpur without touching the building type is the demo the whole
page exists for: the optimised envelope comes back different, and the
"site adaptation" list names every parameter that moved and by how much.

---

## Quick start

### Frontend

```bash
npm install
npm run dev          # http://localhost:3000
```

That is the whole setup. **The application is fully functional with no backend,
no database and no network connection** — every engine has a verified TypeScript
implementation that runs in the browser. This is a deliberate design decision: a
prototype that needs a server to show anything is a prototype that fails in the
room it is presented in.

### Backend (optional)

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt      # core

cd ..
npx tsx scripts/export-catalogue.ts   # stations, materials, vocabularies
npx tsx scripts/export-dataset.ts     # ML training set, labelled by the engine

cd backend && .venv/Scripts/python run.py   # http://127.0.0.1:8000/docs
```

For the two endpoints that touch a trained model (`POST /api/ml/train`,
`POST /api/optimize`) also install the ML extras:

```bash
cd backend && .venv/Scripts/python -m pip install -r requirements-ml.txt
npx tsx scripts/train-surrogate.ts       # from the project root
```

The split is deliberate: a 200 MB scientific stack should not be a prerequisite
for a service whose main job is caching climate data and persisting designs.
Everything except those two endpoints runs on the core set.

Labelling is cheap — about 1 000 rows a second — so the dataset is sized for the
gate, not for the exporter. The default is **12 000 rows**: ~12 s to label, ~3 s
to fit, and enough to clear every target (ρ 0.974 / 0.927 / 0.990). The metrics
quoted in this README come from 40 000 rows, which takes ~39 s to label and buys
a further ~0.01 R² — pass `--rows 40000` for that. 1 500 rows is deliberately
*not* the default: it exports in two seconds and then fails the gate.

Then point the frontend at it:

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

A **Backend** toggle appears in the header. It routes climate resolution through
the FastAPI service when the service answers, and falls back to the local
provider chain when it does not.

See [`backend/README.md`](backend/README.md) for what the service does and — more
importantly — what it deliberately does not.

---

## Verification

```bash
npm run verify        # typecheck + 70 assertions across model, geometry, dashboard
npm run bench         # optimiser timing
npm run debug:thermal # per-month heat balance for one design

cd backend && .venv/Scripts/python -m pytest    # 223 tests: climate parity + wire contract
```

`npm run verify` runs three suites:

- **`verify:model`** — PMV against published reference values (22 °C → −0.81,
  24 °C → −0.22, 26 °C → 0.38), monotonic response to heat, air speed and
  clothing, periodic construction response (RCC 160 mm → decrement 0.341, lag
  4.1 h; rammed earth 300 mm → 0.071, 10.1 h), and the climate-classification
  invariants.
- **`verify:geometry`** — the 3D model and the thermal model resolve the *same*
  geometry. A flat roof's surface area equals its overhang footprint; a 20° shed
  roof's area equals the footprint ÷ cos(20°); the heat map and the heat balance
  resolve the same roof planes.
- **`verify:dashboard`** — 70 assertions covering real pipeline stage
  transitions, auto and manual mode, viewport/parameter agreement, the five-site
  demo, and that changing site clears stale results.

The Python suite compares the backend's climate port against values captured from
the TypeScript engine for **all 33 stations × 12 months × 9 fields**, plus the
Köppen classifier and the feature contract. A shape check cannot catch a unit
error; that can.

### Bugs the suites were written to catch, and did

All were found by verification rather than by reading the code, and each is now
covered by a test that fails if it comes back:

1. **The optimiser never chose a pitched roof.** The thermal model treated every
   roof as horizontal, so a pitched roof could only ever add surface area and
   never added winter solar gain — the axis was inert. Fixed with area-weighted
   tilted-plane irradiance (`roofExposurePlanes`). A second defect hid behind it:
   `roofSurfaceArea` divided the rise by the *half*-span for every pitched form,
   which is gable geometry, so a shed roof's area was ~12 % too large.
2. **Arid cities were classified as cold highlands.** The Köppen aridity
   threshold used `12·T` instead of `20·T + 280`, so Jodhpur — 27 °C annual mean,
   330 mm of rain — missed the aridity test by four millimetres and fell through
   to the temperate branch. `analyseClimate` then fed that zone to the orientation
   search, so Jodhpur's recommendations were built for a hill station while the
   header badge said "Hot desert". The analysis now reads the zone from the
   resolved climate payload instead of re-deriving it, and `verify:model` asserts
   that no station is classified across the hot/cold divide.
3. **Training crashed on the second target.** `SurrogateRow.id` was the sole
   primary key, but one training run fits a booster per target and gives them all
   the same `model_id` — so the second insert hit a `UNIQUE` violation and
   returned HTTP 500. The key is now `(id, target)`. Nothing in the suite had
   exercised multi-target persistence, which is why it was green.
4. **The health badge overstated readiness.** `/api/health` computed
   `surrogate_ready` with `any(...)` over the per-target rows, so it reported
   "ML surrogate" as soon as *one* target passed — while `/api/optimize` was
   still returning 503. Readiness now reuses the same all-targets rule as the
   refusal path, so the badge and the behaviour cannot disagree.
5. **Screening took 33 seconds.** `screen_designs` called `ml.predict()` once per
   candidate, and each call reloaded all three boosters from disk and re-read the
   registry. Loading is the expensive part; prediction is not. The artefacts are
   now loaded once and candidates are scored a coordinate axis at a time:
   **33 000 ms → 450 ms** for the same 66 candidates. A surrogate that answers in
   33 seconds has forfeited the only advantage it had.

Two further defects were found in the same pass and fixed with it: the training
response typed `feature_importance` as `list[dict[str, float]]`, which coerced
the feature *name* to a number and failed serialisation with 126 validation
errors; and `describe_registry()` read its metrics keys unconditionally, so a
single record written under an older contract raised `KeyError` and took down
`/api/health`. A stale row is now reported as stale rather than fatal.

---

## Architecture

```
second-problem-statement/            ← this repo is a monorepo
├── frontend/                       Next.js app — deployed on Vercel
│   ├── app/                        Next.js App Router — the page shell
│   ├── components/
│   │   ├── dashboard/              Header, pipeline flow, 7 panels
│   │   ├── 3d/                     Parametric shelter canvas, floor plan
│   │   └── ui/                     Primitives
│   ├── climate/                    Classification, derived climate, provider chain, analysis
│   ├── thermal/                    Materials, heat balance, PMV/PPD, surface heat, metrics
│   ├── optimization/               Design space, objective, search, cost, comparison
│   ├── ml/                         Feature encoding and the surrogate contract
│   ├── utils/                      Solar geometry, shelter geometry, psychrometrics, units
│   ├── types/                      The domain types everything else agrees on
│   ├── store/                      One Zustand store — every panel is a projection of it
│   ├── api/                        FastAPI client (optional)
│   ├── scripts/                    Exporters, verification harnesses, benchmarks
│   ├── vercel.json                 Vercel deploy config (frontend is the Root Directory)
│   └── package.json
├── backend/                        FastAPI service — deployed on Render, see its own README
│   ├── app/                        Routers, climate port, thermal + ML serving
│   ├── requirements.txt            Python deps (incl. psycopg for Postgres)
│   ├── runtime.txt / Procfile      Render Python 3.11 + uvicorn start command
│   └── .env.example
└── render.yaml                     Render Blueprint — creates the web service + Postgres
```

> **Deployment layout:** the frontend lives in `frontend/` and the backend in
> `backend/`. Vercel builds the frontend with **Root Directory = `frontend`**
> (pick it when importing the repo). Render builds the backend from the
> `render.yaml` Blueprint at the repo root (`rootDir: backend`). See the
> *Deployment* section below for the exact steps.

### Three rules the code follows

**Nothing is derived twice.** The thermal result, the cost estimate and the 3D
geometry all come out of a single `EvaluatedCandidate`. The 3D view therefore
cannot show a building the numbers were not computed for.

**Sliders do not re-run the pipeline.** Re-fetching climatology on every drag
would be slow *and* dishonest — the climate has not changed. Moving a slider
re-runs only the thermal and cost stages.

**Auto and manual mode are not cosmetic.** In auto mode the parameter panel is
read-only, because letting a user nudge a value would silently invalidate the
search that produced it. Switching to manual hands the envelope back and keeps
the optimiser's answer as the reference.

### Adding a sixth building type

A building type is a **bundle of ordinary `BuildingParameters` plus a small
massing descriptor** — it is not a special case inside the physics engine. That
is what keeps the type selector from being decorative: two visually different
shelters must not report identical comfort and energy.

Adding one is a three-step change and touches no thermal, optimisation or
rendering code:

**1. Add the id to the union** — `types/building.ts`

```ts
export type BuildingTypeId =
  | 'single-family'
  | 'row-house'
  | 'low-rise'
  | 'vernacular'
  | 'modular-emergency'
  | 'your-new-type';          // ← add
```

This is a closed union on purpose: every `switch` over it becomes a type error
until the new case is handled, rather than silently falling through to a default.

**2. Add one template object** — `lib/buildingTypes.ts`

Add an entry to `TEMPLATES` and its id to `BUILDING_TYPE_ORDER`. The template
needs:

| Field | What it does |
|---|---|
| `label`, `glyph`, `useCase`, `summary` | Selector and comparison presentation. |
| `accentHue` | 0–360, inside the warm/earthy family the palette is built from. |
| `climateRationale` | Why this form answers a climate — shown next to the selector. |
| `daylightTarget` | The WWR the glazing-adequacy term pulls toward. Keeps a hot climate from stripping every type to the same glazing fraction. |
| `massing.floors` | `{ min, max, default }` — the legal storey range. |
| `massing.partyWalls` | `'none' \| 'one' \| 'both'` — facades shared with a neighbour. A party wall is built and costed but has no outdoor exposure, so it contributes no UA and no solar gain. |
| `massing.verandahDepth` | Deep shaded verandah on the long facades, metres. |
| `massing.modules` | Repeated structural bays; draws the prefab joints. |
| `massing.parapet` | Draw the parapet band above the wall head. |
| `palette` | The materials and strategies this type is *coherently* buildable from. The optimiser may move anywhere inside it and nowhere outside. |
| `defaults` | Starting `Partial<BuildingParameters>`. Starting points, not locks. |

**3. Nothing else.** `applyBuildingType`, `fitToTemplate`, `clampFloors`,
`BUILDING_TYPE_OPTIONS` and the sweep ids (`TYPE_SWEEP_IDS`) all read from the
registry, so the selector, the palette projection, the storey clamp and the
Climate Response Lab pick the new type up automatically.

**The rule to follow when writing the palette.** A palette is not a lock — it is
the set of choices coherent with the type. Rammed earth versus brick is a real
decision the climate gets to make. Rammed earth versus a PUF sandwich panel is
not a decision, it is a different building. If the optimiser cannot make a type
work in a given climate *within its palette*, that is a finding about the
climate, not a licence to specify a different building.

---

## Deployment

This repo is a monorepo: `frontend/` (Next.js) and `backend/` (FastAPI). They
deploy to **two different platforms** and talk to each other over HTTP.

### Frontend → Vercel

1. Import this repo in Vercel (New Project → import `second-problem-statement`).
2. Set **Root Directory = `frontend`** (the `frontend/` folder). Vercel picks up
   `frontend/vercel.json` automatically.
3. Build/install commands are already set in `vercel.json`
   (`npm install` / `npm run build`, output `.next`).
4. **Environment variable** (Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_API_URL` → the Render backend URL from below
     (e.g. `https://thermal-shelter-api.onrender.com`). Leave it blank to run the
     app fully client-side (it works without the backend).
5. Deploy. Vercel gives you a `https://<project>.vercel.app` URL.

### Backend → Render

1. In Render, click **New → Blueprint** and select this repo. Render reads
   `render.yaml` at the repo root and creates two resources:
   - a free **PostgreSQL** database (`thermal-shelter-db`), and
   - a free **web service** (`thermal-shelter-api`, Python 3.11, `rootDir: backend`).
2. The database `DATABASE_URL` is wired in automatically.
3. **Environment variable to set** on the web service:
   - `CORS_ORIGINS` → your Vercel URL, e.g.
     `https://<project>.vercel.app,http://localhost:3000`
     (the placeholder in `render.yaml` must be replaced with the real domain so
     the browser is allowed to call the API).
4. Deploy. Note the service URL and paste it into Vercel's `NEXT_PUBLIC_API_URL`.

### Wiring the two together

- Vercel `NEXT_PUBLIC_API_URL` **→** Render service URL.
- Render `CORS_ORIGINS` **→** Vercel frontend URL.

Both sides must point at each other or the optional "Backend" mode in the header
will be blocked by CORS. The app is fully usable without the backend (it runs
the simulation client-side); the backend only adds persistence and a server-side
surrogate model.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript 5.6 |
| 3D | Three.js 0.169, @react-three/fiber 8, @react-three/drei 9 |
| State | Zustand 5 |
| Styling | Tailwind CSS 3.4 |
| Charts | Recharts 2.12 |
| Maps | Leaflet 1.9, react-leaflet 4.2 |
| Backend | FastAPI 0.115, Uvicorn, Pydantic 2.10 |
| Persistence | SQLAlchemy 2.0 — SQLite by default, PostgreSQL by config |
| ML | XGBoost 2.1, scikit-learn 1.5, NumPy, pandas |
| Verification | pytest 8.3, tsx harnesses |

---

## Honesty statement

Every comfort, energy and cost figure this system produces is the output of a
**simplified quasi-steady-state monthly heat-balance model**. It is an engineering
estimate — **not a measurement, and not a validated whole-building simulation.**
Design conditions are documented approximations of ASHRAE percentiles, not a
percentile analysis over hourly records.

Specific claims the interface makes, and why:

- **The heat map shows absorbed solar radiation, not surface temperature.** The
  model does not solve for surface temperature in space, so it does not claim to.
- **PMV is reported separately from adaptive comfort.** ISO 7730 PMV was
  calibrated for conditioned spaces at fixed clothing and systematically
  misjudges naturally ventilated buildings, so the free-running case is judged
  against ASHRAE 55 instead. Reporting one number for both would be misleading.
- **Ventilation ACH is a capacity, not an operating rate.** The model only applies
  it when the outside air is actually cooler than the space, so a high figure in a
  cold climate is not a winter heat loss.
- **The cost model is a trade-off tool, not a quantity surveyor's estimate.**
- **The budget is a soft constraint.** An overrun is reported, not blocked.
- **The ML surrogate is gated on ranking, not on R².** The optimiser consumes the
  model's *ordering* of candidate designs, so the gate is Spearman rank
  correlation plus held-out MAE. R² is reported but not gated, and the reason is
  measured rather than assumed — see below.
- **A model that fails the gate is refused, not shipped.** The backend records
  its metrics with `passedGate: false`, reports `surrogateReady: false`, and
  returns HTTP 503 from `/api/optimize`. `surrogateReady` requires *every* target
  to pass, because a screening tool that can rank energy but not comfort would
  rank designs by the wrong thing.

### Why the surrogate gate is rank correlation

One of the three targets — `adaptive_comfort_hours_pct`, a count of comfortable
hours out of 8 760 — is bounded to [0, 100], quantised by the thermal model's
time resolution, and has roughly a quarter of its mass pinned at exactly zero.
A squared-error regressor cannot fit quantisation noise that is not a function of
its inputs, so its R² is capped below 1 however much data it is given.

That is not a hypothesis. Measured on 40 000 labelled rows:

| rows | energy R² | comfort R² | comfort Spearman |
| ---: | --------: | ---------: | ---------------: |
| 1 500 | 0.875 | 0.762 | — |
| 12 000 | 0.959 | 0.882 | — |
| 40 000 | 0.979 | 0.892 | **0.936** |

The learning curve is asymptoting just under 0.90 while the ranking is already
excellent. Gating on R² would therefore refuse a model that is good at the only
job it has. Gating on rank correlation measures the thing the consumer actually
needs, and the MAE floor keeps the numbers in the right units.

Final held-out metrics for the shipped configuration (40 000 rows, 400 trees,
depth 6):

| target | R² | ρ | MAE | gate |
| --- | ---: | ---: | ---: | --- |
| `energy_use_intensity_kwh_m2_yr` | 0.979 | 0.978 | 5.23 kWh/m²·yr | ρ ≥ 0.90, MAE ≤ 15 |
| `adaptive_comfort_hours_pct` | 0.892 | 0.936 | 5.36 pp | ρ ≥ 0.90, MAE ≤ 6 |
| `cost_per_m2_inr` | 0.990 | 0.995 | ₹956/m² | ρ ≥ 0.90, MAE ≤ 2500 |
