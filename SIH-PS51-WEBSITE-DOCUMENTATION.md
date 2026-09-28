# Thermal Shelter — Complete Website Documentation

**Project:** Area-Specific Thermal Comfort Shelter Design & Simulation Platform
**Problem statement:** Smart India Hackathon — **PS-51** (DRDO) *“Software Based Model Development for Design of Area Specific Shelter for Thermal Comfort Maintenance”*
**Document scope:** Every feature of the website, how each feature functions, and the expected output or result of each feature.

> Every comfort, energy and cost figure this application produces is the output of a **simplified quasi-steady-state monthly heat-balance model**. It is an **engineering estimate — not a measurement, and not a validated whole-building simulation.**

---

## 0. How to read this document

| Section | What it covers |
|---|---|
| §1 | What the site is, and how it maps to PS-51 |
| §2 | Tech stack and runtime architecture |
| §3 | How to run it (dev, build, static export, optional backend) |
| §4 | The global shell — sidebar, topbar, footer, mobile nav, boot behaviour |
| §5 | Every route / page, one by one |
| §6 | Every panel and component (the feature reference) |
| §7 | The engines that produce the numbers |
| §8 | Data catalogues (stations, building types, materials, parameters, strategies) |
| §9 | The three required outputs, in detail |
| §10 | Reports and exports |
| §11 | The single store (state model) |
| §12 | Verification |
| §13 | Known limitations |
| §14 | Quick feature → expected-output matrix |

---

## 1. What the website is

A parametric, browser-based **shelter design and simulation platform**. The user picks a site; the software classifies its climate, designs an envelope for it, simulates the thermal performance, prices it, searches the design space for a better answer, and shows the building in 3D — with the reasoning behind every decision.

The whole application follows one chain, and every stage is visible in the interface, reports its own duration, and can be inspected:

```
INPUT → CLIMATE → ANALYSIS → THERMAL → OPTIMISATION → PARAMETERS → 3D → RESULTS
```

The design principle behind the whole site: **a tool that produces a number without showing where it came from is a tool nobody should trust.**

### 1.1 The three required outputs

PS-51 asks for three specific quantities. They **lead the interface** rather than trail it:

| # | Output | Statement wording | Where it comes from |
|---|---|---|---|
| 1 | **Predicted shelter indoor temperature** | “from user-defined inputs” | `dailyProfile.points[].indoorTemp` — the free-running response, hour by hour |
| 2 | **Thermal energy generated from solar radiation** | — | `dailyProfile.solarGainKwh`, with peak hour and per-m² figure |
| 3 | **Heat-flow details** | “from the temperature difference between ambient and shelter temperature” | `dailyProfile.wallKwh / roofKwh / windowKwh / ventilationKwh`, signed into the zone |

All three are **transient**, so the centre of the results panel is a **24-hour curve** (indoor and outdoor temperature on one axis, with the freezing line marked). A monthly mean cannot show that a Ladakhi shelter peaks in the afternoon and falls back toward outdoor conditions after sunset — and that fall is the entire engineering problem.

The design-critical month is chosen **by the simulation, not the user**: a shelter whose annual heating demand exceeds its cooling demand is judged on its coldest month, and the reverse for a cooling-dominated climate. The panel labels which (`Heating-critical` / `Cooling-critical`).

---

## 2. Tech stack and runtime architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript 5.6 |
| 3D | Three.js 0.169, `@react-three/fiber` 8, `@react-three/drei` 9 |
| State | Zustand 5 — **one store**; every panel is a projection of it |
| Styling | Tailwind CSS 3.4 |
| Charts | Recharts 2.12 |
| Maps / geocoding | Leaflet 1.9, `react-leaflet` 4.2, Open-Meteo geocoding |
| Backend (optional) | FastAPI 0.115, Uvicorn, Pydantic 2.10 |
| Persistence (backend) | SQLAlchemy 2.0 — SQLite by default, PostgreSQL by config |
| ML (backend) | XGBoost 2.1, scikit-learn 1.5, NumPy, pandas |
| Verification | pytest 8.3, `tsx` harnesses |

### 2.1 Directory map

```
frontend/
├── app/                    Next.js App Router — pages and layout
│   ├── page.tsx            Landing page  (/)
│   ├── login/page.tsx      Sign-in gate (/login)
│   └── (app)/
│       ├── layout.tsx      Wraps every dashboard route in AppShell
│       └── dashboard/      The ten workspace pages
├── components/
│   ├── dashboard/          The 12 working panels
│   ├── 3d/                 Parametric shelter canvas, geometry, textures, overlays
│   ├── 2d/                 Floor-plan canvas
│   ├── shell/              AppShell, Sidebar, Topbar, MobileNav, nav model
│   ├── marketing/          Landing-page sections and visuals
│   └── ui/                 Primitives (buttons, chips, panels) and the soft kit
├── climate/                Classification, derived climate, provider chain, analysis
├── thermal/                Materials, assemblies, heat balance, PMV/PPD, metrics
├── optimization/           Design space, objective, search, cost, comparison, recommendations
├── ml/                     Feature encoding and the surrogate contract
├── utils/                  Solar geometry, shelter geometry, psychrometrics, units, format
├── types/                  The domain types everything agrees on
├── store/designStore.ts    The one Zustand store
├── api/                    FastAPI client (optional)
├── lib/                    Parameters, building types, scenarios, report, session, labels
├── scripts/                Exporters, verification harnesses, benchmarks
└── docs/                   PS51-TECHNICAL-SOLUTION.md
```

### 2.2 Three architectural rules

1. **Nothing is derived twice.** The thermal result, the cost estimate and the 3D geometry all come out of a single `EvaluatedCandidate`. The 3D view therefore cannot show a building the numbers were not computed for.
2. **Geometry is separate from physics.** `utils/shelterGeometry.ts` produces a renderer-agnostic `ShelterGeometry`; the Three.js layer only draws it. The physics consumes the same description.
3. **The physics is replaceable.** Everything sits behind `simulateDesign`, so a validated engine (EnergyPlus / Radiance via Ladybug) can be substituted without touching a single UI component.

### 2.3 Static export

The app is configured with `output: 'export'` and `trailingSlash: true`. `npm run build` produces a fully static `out/` directory. There is **no server at runtime** for the core path.

---

## 3. How to run it

### 3.1 Frontend (the whole product)

```bash
npm install
npm run dev          # http://localhost:3000
```

**The application is fully functional with no backend, no database and no network connection** — every engine has a verified TypeScript implementation that runs in the browser. This is a deliberate decision: a prototype that needs a server to show anything is a prototype that fails in the room it is presented in.

Production build (static):

```bash
npm run build        # emits out/
```

### 3.2 Optional backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt      # core
cd ..
npx tsx scripts/export-catalogue.ts   # stations, materials, vocabularies
npx tsx scripts/export-dataset.ts     # ML training set, labelled by the engine
cd backend && .venv/Scripts/python run.py   # http://127.0.0.1:8000/docs
```

For the two endpoints that touch a trained model (`POST /api/ml/train`, `POST /api/optimize`) also install the ML extras:

```bash
cd backend && .venv/Scripts/python -m pip install -r requirements-ml.txt
npx tsx scripts/train-surrogate.ts       # from the project root
```

Then point the frontend at it (`.env.local`):

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_OPEN_METEO_API_KEY=          # optional; lifts the live-lookup rate limit
```

A **Backend** toggle then appears in Settings. It routes climate resolution through the FastAPI service when the service answers, and falls back to the local provider chain when it does not.

### 3.3 Verification commands

```bash
npm run verify        # typecheck + 70 assertions across model, geometry, dashboard
npm run bench         # optimiser timing
npm run debug:thermal # per-month heat balance for one design
cd backend && .venv/Scripts/python -m pytest    # 223 tests: climate parity + wire contract
```

---

## 4. Global shell — navigation and chrome

The shell wraps every `/dashboard/*` route (`app/(app)/layout.tsx` → `components/shell/AppShell.tsx`). It is: **sidebar on the left, compact header on top, content on the right, honesty footer below, mobile nav on small screens.**

### 4.1 Sidebar (`components/shell/Sidebar.tsx`, model in `components/shell/nav.ts`)

**What it does:** provides the primary navigation. Items are grouped by the user’s *flow*, not the pipeline’s order — a new visitor lands on the Dashboard, walks Site → Design → Analysis → Optimisation, then browses Climate Response and the reference pages.

**Groups and items (exact order):**

| Group | Route | Label | The question it answers |
|---|---|---|---|
| **Main** | `/dashboard` | Dashboard | “How is my current design doing?” |
| **Design** | `/dashboard/climate` | Site & Climate | “What does this location require?” |
| **Design** | `/dashboard/design` | Design Studio | “What am I designing?” |
| **Design** | `/dashboard/analysis` | Thermal Analysis | “What is happening thermally?” |
| **Design** | `/dashboard/optimization` | Optimisation | “What did the optimiser change?” |
| **Compare** | `/dashboard/scenarios` | Climate Response | “How does the design change across climates?” |
| **Reference** | `/dashboard/materials` | Materials | “The envelope library” |
| **Reference** | `/dashboard/model` | AI / Model | “How reliable is the prediction?” |
| **Reference** | `/dashboard/method` | Method & Limits | “How these numbers are produced” |
| **System** | `/dashboard/settings` | Settings | “Backend, data sources and developer options” |

**Active state:** `isNavActive()` highlights the current section, including nested routes (`/dashboard/design/advanced` still reports “Design Studio”). `navItemFor()` resolves the topbar title with the same longest-prefix logic.

**Expected result:** a persistent left rail; the current page is visually distinguished; clicking any item navigates client-side without losing the in-memory design state.

### 4.2 Topbar (`components/shell/Topbar.tsx`)

**What it does:** carries the page’s identity (left) and the only controls the user needs most of the time (right). It is a navigation bar with one CTA, not a control panel.

**Row 1 — page identity + status**
- Mobile-only brand mark (below `lg` the sidebar is hidden, so this is where the product identifies itself).
- Group eyebrow (`Main` / `Design` / …).
- **Status badge** — `Generating` / `Error` / `Ready` / `Idle`.
- Climate-zone chip (e.g. “Hot & dry”) when a climate is resolved.
- Page title (`h1`) and the page’s one-line description.

**Row 2 — the controls**
- **Site selector**: a country `<select>` (11 countries) and a city `<select>` (cities in that country), plus the current `LocationChip`.
- **Search any location**: a debounced (300 ms) free-text geocoder against Open-Meteo. Type ≥ 2 characters → a dropdown of matching places (name, admin region, country, elevation). Selecting one sets the site to that coordinate.
- **Auto / Manual** segmented toggle:
  - **Auto** — the optimiser chooses the envelope.
  - **Manual** — the user drives the envelope; each slider re-runs the thermal model immediately.
- **Generate design** button — runs the full pipeline for the current site + programme. Disabled while generating or if no site is set.
- A live status message (e.g. “Design ready.”).

**Row 3 — error banner** (only on failure): “The pipeline could not finish”, the extracted message, and a **Dismiss** button.

**Expected result:** changing the country jumps to that country’s first station; changing the city sets the site (and clears stale results); searching resolves an arbitrary world location; **Generate design** runs the pipeline and populates every page.

### 4.3 Footer — the honesty statement

A persistent footer on every dashboard page states, in full:

> Every comfort, energy and cost figure in this application is the output of a simplified quasi-steady-state monthly heat-balance model — an engineering estimate, not a measurement and not a validated whole-building simulation. Use it to compare design options and to reason about strategy; validate with measured data before construction.

It also names the stack: SIH PS-51 · Next.js · React · TypeScript · Three.js · React Three Fiber · ISO 7730 PMV/PPD · ASHRAE 55 adaptive.

### 4.4 Mobile navigation (`components/shell/MobileNav.tsx`)

Below `lg`, the sidebar is hidden and this fixed bottom bar is the only way to move between sections. The main content area carries bottom padding to clear it.

### 4.5 Boot behaviour (`AppShell`)

**What it does:** runs the pipeline **once on first mount, on any route**, guarded by a ref so React’s double-invoked dev effects cannot double-run it.

**Why:** the store is module-level, so client-side navigation preserves it — but a hard refresh on `/dashboard/analysis` would otherwise land on an empty page. Booting in the shell means **every route can be a deep link.**

**Expected result:** opening the app lands on a finished analysis for the default site (Pune) rather than an empty shell.

---

## 5. Routes and pages

### 5.1 Landing page — `/` (`app/page.tsx`)

A static marketing page (server component) that explains the project. Sections:

| Section | Contents | Expected result |
|---|---|---|
| **Hero** | Kicker “Smart India Hackathon · Problem Statement 51”; headline “Design a shelter for the climate it actually stands in.”; lede describing the parametric modeller; two CTAs (**Open the dashboard**, **See how it works**); three stats (**33 sites**, **24 materials**, **54,000+ search space**); hero image with a floating readout card (“67% adaptive comfort hours · −41% energy vs conventional · −4.8 K peak overshoot”). | An animated hero with reveal-on-scroll motion. |
| **The problem** | “One shelter template cannot serve every climate.” Three cards: comfort is measurable, cost is the real constraint, the envelope does the work. Three SVG physics diagrams: envelope build-up, solar geometry, monthly heat balance. | A visitor understands why area-specific design matters. |
| **How it works** | “Eight stages, and you can inspect every one.” Renders the `PipelineStepper`. | The pipeline is presented as inspectable, not a black box. |
| **Capabilities** | Six cards: parametric 3D model, monthly heat balance, ISO 7730 comfort, passive strategy analysis, ML surrogate honestly gated, before/after comparison. | A feature overview. |
| **Sites** | “Five climates, five different answers.” Renders the `SiteExplorer` — pick a site to plot its **real monthly normals** (the same numbers the engine runs on). | An interactive site explorer. |
| **Rigour** | “The model is allowed to say ‘I don’t know.’” Three points (rank-correlation gate not R²; a demonstrated rejection at 1,500 rows; estimates labelled as estimates) plus a **measured-accuracy table** (Energy ρ 0.978 / MAE 5.23; Comfort ρ 0.936 / MAE 5.36 pp; Cost ρ 0.995 / MAE ₹956/m²). | The honesty position is stated with evidence. |
| **CTA** | “Pick a site. Watch the envelope answer.” Buttons **Open the dashboard** and **Sign in**. | Entry into the app. |

### 5.2 Login — `/login` (`app/login/page.tsx`)

**What it does:** a **front-end demo gate**. There is no authentication — no user table, no token, no protected route — and the page says so in the form itself.

- **Left panel** (hidden below `lg`): a rammed-earth photograph with a warm scrim, the brand, the headline “A shelter designed for its climate, not for a catalogue.”, three proof points (33 stations, ISO 7730 + ASHRAE 55, parametric envelope), and the estimate disclaimer.
- **Right panel**: the form — email (validated by a permissive pattern), password (min 8 chars, show/hide toggle), “Keep me signed in on this device” checkbox, and a **Sign in** button.
- A warning box: *“Demo gate — no real sign-in. Any valid-looking email and an 8-character password will let you in, and nothing is sent anywhere.”*
- A link: “Skip straight to the dashboard”.

**Behaviour:** real validation with error states (`role="alert"`), a pending state, keyboard handling, and a session written to storage that survives a reload (`writeSession(email, remember)`), then `router.push('/dashboard')`. There is an honest 450 ms delay rather than a faked network round-trip.

**Expected result:** entering any valid-looking email + ≥ 8-char password signs in and lands on the dashboard.

### 5.3 Dashboard — `/dashboard` (`app/(app)/dashboard/page.tsx`)

The home page. It answers one question: *“how is my current design doing?”*

| Band | Feature | How it functions | Expected output |
|---|---|---|---|
| 1 | **Greeting panel** | Time-aware greeting (“Good morning/afternoon/evening”), the city and its climate zone in a sentence (“Pune is asking for **hot & dry** climate”), the dominant challenge, a location chip, a climate-type chip, and “Annual mean X °C · Y K swing”. Decorative blobs give it an editorial feel. | A contextual header summarising the live design’s site. |
| 2 | **Pipeline progress strip** | Condenses the 8-stage pipeline into 5 chips — **Site · Climate · Design · Thermal · Optimized** — each with a status. A label reads “Running pipeline…” or “All stages complete”. | At-a-glance run status. |
| 3 | **Generating banner** (only while running) | A pulsing dot + “Running the pipeline — climate, analysis, thermal, optimisation, geometry.” | Feedback during a run. |
| 4 | **The three engineering outputs** | Three cards. **Indoor temperature** (`min … max °C free-running`, with the outdoor swing and the % damped). **Solar thermal gain** (`kWh/day`, per-m², peak hour, % of the day’s losses covered). **Heat flow** (`kWh/day leaving`, with a `BarRow` breakdown for Walls / Roof / Floor / Windows / Doors / Ventilation). If nothing has run yet, a prompt to press **Generate design**. | The three PS-51 outputs at the top of the home page. |
| 5 | **Current design preview** | Left: a 3D `ModelThumbnail` of the live building with a metadata strip (building type, wall material, WWR, orientation) and an “Open studio” link. Right: a **thermal-comfort gauge** (free-running hours inside the ASHRAE 55 adaptive band, with conditioned PMV/PPD), plus **Annual energy** (kWh/yr and kWh/m²·yr) and **Construction** (₹/m²) cards. | A visual + numeric snapshot of the live design. |
| 6 | **Site facts** | Six fact chips: Annual mean, Diurnal swing, Rainfall, Wind, Elevation, Coordinates. | The site’s headline numbers. |
| 7 | **Recent designs** | Three cards (Pune, Leh, Jodhpur) synthesised from the demo-city set (the app does not persist designs). Clicking one **sets that location and re-runs the pipeline**. | Quick switching between demo cities. |
| 8 | **Quick actions** | Four jump-cards: New design, Open Design Studio, Compare climates, Compare materials. | Shortcuts to the most-used destinations. |
| 9 | **Climate Response Lab banner** | A wide link to `/dashboard/scenarios` describing it as “the strongest demo page of this project”. | Signposting to the showcase page. |

### 5.4 Site & Climate — `/dashboard/climate` (`app/(app)/dashboard/climate/page.tsx`)

**Purpose:** what the site asks of a building — deliberately upstream of the design, with no building in the picture yet.

| Feature | How it functions | Expected output |
|---|---|---|
| **Location search** | A large search field (debounced geocoding through the shared provider, with a request-counter guard against out-of-order responses), a results listbox, and a “Built-in climatology · 33 stations” row of quick chips (Pune, Jodhpur, Leh, Chennai, Delhi, Shillong) with the active one highlighted. | Picking a place or chip sets the site. |
| **Four summary cards** | **Annual mean** (°C, with the year’s min→max and the diurnal swing), **Rainfall** (mm/yr, with the driest month), **Wind** (m/s and the prevailing compass direction), **Solar** (kWh/m²·d, with humidity and its label). | The four facts that decide what a building has to do here. |
| **Climate engine interpretation** | The dominant thermal problem (labelled + detailed), the zone note, and a definition list of the strategy the engine derived: Ventilation (strategy + ACH), Insulation (level + mm), Shading, Glazing, Window ratio, Orientation (degrees + compass). A footnote explains that ventilation here is a **capacity**, not a constant rate. | The reading every downstream stage consumes. |
| **Monthly charts** | `ChartsPanel` — three tabs (temperature / energy / heat balance) over the same twelve months. | Temperature works with only a site; energy and balance appear once a design exists. |
| **Full climatology** | `ClimateSummaryPanel` — the summary, design conditions and provenance. | Where the numbers came from matters as much as what they are. |

If no climate is resolved, an empty state instructs the user to search a location or press **Generate design**.

### 5.5 Design Studio — `/dashboard/design` (`app/(app)/dashboard/design/page.tsx`)

The working page. A **35 / 65 split**: parameter controls on the left, the 3D model on the right, and the PS-51 output band below.

| Feature | How it functions | Expected output |
|---|---|---|
| **Identity header** | Explains the current mode (auto vs manual) and shows a status badge (`Optimised` / `Manual` / `Modified` / `Generating`). | Clear mode context. |
| **Hide / Show controls** | Collapses the parameter column to focus on the model. | A wider viewport. |
| **Parameter panel (left)** | `ParameterPanel` — every slider and select (see §6.1). In **auto** mode it is read-only; in **manual** mode every change re-runs the thermal + cost stages instantly. | Live re-evaluation of the design. |
| **3D viewport (right)** | `ViewportPanel` — nine visualisation modes, quality tiers, time sliders, layer toggles, camera presets, PNG/GLB/PDF export (see §6.2). | An interactive, physically-consistent model of the design. |
| **Output band** | `ShelterResultPanel` — the three required outputs plus the 24-hour curve (see §6.3). | The PS-51 deliverables, read off a representative day. |
| **Honesty strip** | “Model estimate — not a measured building result.” + “Every figure comes from the same monthly heat balance the charts and the 3D model use.” | Provenance stated inline. |

### 5.6 Thermal Analysis — `/dashboard/analysis` (`app/(app)/dashboard/analysis/page.tsx`)

A **read-out page** (no design controls on purpose). Leads with three headline numbers, then opens the depth.

| Feature | How it functions | Expected output |
|---|---|---|
| **Three headline cards** | **Peak indoor** (the peak-cooling month’s indoor temperature, with the overshoot above the adaptive band or a “within band” message); **Passive comfort** (% of the year inside the adaptive band, with overheating/underheating hours and the score chip); **Energy intensity** (kWh/m²·yr, annual delivered energy, t CO₂, capital cost). Cards are toned green/amber/pink by performance. | The three things a reviewer asks for first. |
| **Heat balance breakdown** | Annual totals of the four terms the model solves each month (Solar gain, Internal gain, Conduction, Ventilation) as horizontal `BarRow`s, sized against the largest absolute term. | Where the heat comes from and where it goes. |
| **Monthly charts** | `ChartsPanel` — the year, month by month. The gap between the dashed outdoor line and the solid free-running line is the envelope’s whole contribution. | The annual picture. |
| **Full tabbed read-out** | `ResultsPanel` at full width — comfort / energy / cost / how-this-was-found (see §6.6). | The same panel the Design Studio uses, with room to breathe. |
| **Provenance** | The thermal result’s own `provenance.label` and `disclaimer`. | Honesty footer. |

### 5.7 Optimisation — `/dashboard/optimization` (`app/(app)/dashboard/optimization/page.tsx`)

Answers “was it worth it?” — the same programme, built conventionally and built to the optimiser’s answer, measured on the same engine.

| Feature | How it functions | Expected output |
|---|---|---|
| **Search objective panel** | A **Cost ↔ Comfort** slider (0 = cheapest, 1 = most comfortable) labelled with the current band (**Cost-led** < 0.34, **Balanced** 0.34–0.66, **Comfort-led** > 0.66) and three preset buttons. A **Generate optimized design** button re-runs the search at the current priority. It is disabled in Manual mode. | The one control that changes the answer, surfaced where its effect is visible. |
| **Optimisation summary** | Method, score (/100), search time (ms), and the energy saved/added in ₹ and %. | Transparency about the search. |
| **Before / after** | `ComparisonPanel` — two models side by side (see §6.7), diffed against **conventional local construction** (brick walls, RCC roof, single glazing, no insulation, no shading) — deliberately not a straw man. | Two buildings, one climate, with the full metric table. |
| **Why** | `RecommendationPanel` — each decision and the change it actually caused, with **measured effects** and **reasoning** kept visibly separate (see §6.8). | An explanation after the result. |

The slider writes through `setPriority`, the same objective weight the Design Studio and the Climate Response Lab use. The search is **not** re-run on every tick — each tick is a full coordinate-descent sweep.

### 5.8 Climate Response — `/dashboard/scenarios` (`app/(app)/dashboard/scenarios/page.tsx`)

The page that demonstrates area-specific design. A page header plus a framing card (“Two axes, one engine”) wraps the `ScenarioLab` (§6.9).

**Why it exists:** a single optimised building on a single site proves nothing — there is nothing to compare it against. The claim this project makes is *conditional*:

```
same site  →  five building types  →  five different optimised designs
same type  →  five sites           →  five different optimised designs
```

**Expected result:** a five-column sweep, each column drawn at size from its own geometry, with the parameter diff that explains the change.

### 5.9 Materials — `/dashboard/materials` (`app/(app)/dashboard/materials/page.tsx`)

The envelope library.

| Feature | How it functions | Expected output |
|---|---|---|
| **Identity + status** | Status badge: “Editable — manual mode” / “Optimiser-chosen” / “No design”. | Mode context. |
| **“U-value, not R-value marketing” card** | A worked example: a 230 mm brick wall is **1.20 W/m²·K** alone and **0.28 W/m²·K** with 100 mm XPS. In manual mode the user can swap any wall, roof or glazing directly from the catalogue. | The gap between nominal and resolved figures is the whole point of an insulation layer. |
| **Material panel** | `MaterialPanel` — the resolved assembly the current design is actually built from, plus the full catalogue (see §6.10). | Every entry carries the properties the thermal model consumes. |

### 5.10 AI / Model — `/dashboard/model` (`app/(app)/dashboard/model/page.tsx`)

Reports the ML surrogate, its gate and its measured accuracy. This page exists because the surrogate is the one component whose output is **learned** rather than derived.

| Feature | How it functions | Expected output |
|---|---|---|
| **Authority statement** | “The physics engine is the authority. The surrogate is a screening aid.” | The question answered up front. |
| **Service panel** | Probes `/api/health` (4 s timeout) and reports: Configured (yes/no), Reachable (yes + version), catalogue size (stations · materials), engines. Shows a chip (`Surrogate ready` / `No gated model` / `Offline`) and a backend-routing toggle (or setup instructions when none is configured). A **Refresh** button re-probes. | Live service status. |
| **Validation gate** | Explains the gate is **Spearman ρ + held-out MAE**, not R², because `adaptive_comfort_hours_pct` is bounded, quantised and ~25 % pinned at zero. Reads the per-target thresholds from the registry. | The rule a model must prove before it may answer. |
| **Model registry** | Every model the service has trained — including the ones that **failed** — with per-target ρ (vs gate), MAE, R², pass/fail verdict, a `Serving`/`Refused` chip, and the top features. Stale rows are reported as stale rather than fatal. | Full traceability of trained models. |
| **Measured accuracy** | The learning curve table (1,500 rows → fails; 12,000 → passes; 40,000 → shipped), with Energy R², Comfort R² and Comfort ρ. | The measurement the gate is calibrated against. |
| **Active engine** | What is answering right now (`engineDescription`). | Current engine identity. |

When no backend is configured, the page says so and explains that the app is unaffected — the browser physics engine is the authority.

### 5.11 Method & Limits — `/dashboard/method` (`app/(app)/dashboard/method/page.tsx`)

The most important reference page: what the tool is, and what it does **not** claim. Written to be read by a jury, an architect or a future maintainer — deliberately not marketing copy.

| Feature | Contents |
|---|---|
| **Headline agreement** | “Model estimate — not a measured building result.” |
| **What this tool is** | A climate-responsive shelter designer for a specific site. A warning box: every figure is an engineering estimate from a simplified quasi-steady-state monthly heat-balance model. |
| **How a result is produced** | Six stages: Climate → Analysis → Thermal → Comfort → Optimisation → Results, each explained. |
| **What it does not claim** | Six limits: monthly not hourly; no airflow network; the heat map shows absorbed radiation (not surface temperature); ventilation ACH is a capacity not a rate; cost is a trade-off tool; the surrogate is a screening aid. |
| **Standards followed** | ISO 7730 (PMV/PPD), ASHRAE 55 (adaptive comfort), Köppen–Geiger (classification), ASHRAE Handbook (clear-sky irradiance and sol-air), NOAA (solar position), Erbs (diffuse fraction). |
| **Verify it yourself** | The three commands: `npm run verify` (typecheck + 70 assertions), `pytest` (223 backend tests), `npm run bench` (optimiser timing), plus a link to the ML accuracy page. |

### 5.12 Settings — `/dashboard/settings` (`app/(app)/dashboard/settings/page.tsx`)

All the controls that used to live in the global header, plus the optimisation priority.

| Feature | How it functions | Expected output |
|---|---|---|
| **Backend routing** | A toggle for the FastAPI service (disabled unless `NEXT_PUBLIC_API_URL` is set). | Climate + screening go through the service when it answers, locally otherwise. |
| **Live data** | A toggle between live Open-Meteo reanalysis and the pinned bundled climatology. | Live = fresher; pinned = reproducible and instant. |
| **Open-Meteo API key** | An expandable section with a password field and a **Save key** button. | A saved key lifts the live-lookup rate limit; the key is stored in browser memory only. |
| **Generation priority** | The Cost ↔ Comfort slider with the current % comfort weight. | Sets the objective weight used when the optimiser runs in Auto mode. |
| **Build information** | Three cards: Version (SIH PS-51), Engine (Browser + FastAPI), Honesty (estimates, not measurements). | Deployment context. |

---

## 6. Feature reference — panels and components

### 6.1 `ParameterPanel` — the design programme and envelope

Drives the store’s `updateNumeric` / `updateSelect`. In **auto** mode it is read-only; in **manual** mode each change re-runs the thermal + cost stages.

**Field groups, in order:**

**Building type**
- **Type** — a select over the five building types (choosing one **resets the parameters it defines and clamps the storey count**).
- **Storeys** — a slider, clamped to the type’s legal range (e.g. vernacular is single-storey by definition).

**Programme** *(the optimiser treats these as fixed)*
- Width (3–12 m, step 0.1), Length (3–16 m, step 0.1), Floor-to-ceiling (2.2–4.2 m, step 0.05), Occupants (1–12), Rooms (1–4), Budget (₹200,000–₹3,000,000, step ₹25,000 — a **soft constraint**).

**Envelope** *(where most of the saving is)*
- Wall material (8 options), Composite wall build-up (overrides the wall material with a multi-layer stack; includes a phase-change option), Wall thickness (0.10–0.50 m), Insulation level (none/low/medium/high/very-high), Insulation thickness (0–0.20 m), Window-to-wall ratio (0–0.60), Glazing position (6 named distributions), Glazing (4 options), Roof material (6 options), Composite roof build-up.

**Form & shading**
- Orientation (0–359°, clockwise from north; symmetric every 180°), Roof form (flat/shed/gable/hip/vaulted), Roof pitch (0–45°, ignored for flat), Roof overhang (0–1.5 m), Shading device (6 options), Shading depth (0–1.8 m).

**Ventilation & services**
- Ventilation strategy (6 options), Design air changes (0.5–12 ACH — a **capacity**, not a constant rate), Cooling setpoint (20–30 °C), Heating setpoint (14–24 °C), Cooling COP (1.8–6), Heating efficiency (0.6–4; >1 means a heat pump), Rooftop PV (0–10 kWp — offsets delivered energy; does not change comfort).

**Expected result:** every change writes to the one store; in manual mode the thermal result, cost and 3D geometry update immediately; programme changes additionally rebuild the recommendations (because recommendations are a pure function of the programme).

### 6.2 `ViewportPanel` — the 3D model

The centrepiece interactive view. Geometry is rebuilt from `currentParameters` on every change by the **same** `buildShelterGeometry` the thermal model consumes.

| Feature | How it functions | Expected output |
|---|---|---|
| **Nine visualisation modes** | Normal, Heat map, Air flow, Solar, Plan, Front, Side, Top, Walk. Selecting Front/Side/Top/Walk also sets the matching camera preset. | Nine distinct presentation views of the same building. |
| **Heat map** | Colours surfaces by **absorbed solar radiation** (not surface temperature — the model does not solve for temperature in space). A legend shows the kWh/m²/day range and a summary. | A solar-absorption map with an explicit legend. |
| **Air flow** | Overlays the month’s wind speed and direction and the design’s ACH capacity; animates the air. | A ventilation read-out. |
| **Solar** | Draws the sun path for the selected month and hour. | Solar geometry on screen. |
| **Plan / Front / Side / Top** | Orthographic views; Plan uses `FloorPlanCanvas` with dimension chains and room labels. | Measurable orthographic views. |
| **Walkthrough** | Pointer-lock first-person navigation: click to lock, move with **W A S D**, look with the mouse, **Esc** to release. Movement is clamped to the interior. | A walkthrough of the interior. |
| **Quality tiers** | Low / Med / High drive device pixel ratio, shadow-map size and roof tessellation. | A performance/quality trade-off. |
| **Time sliders** | Hour (0–24, step 0.5), Month (0–11), Day (1–month length). | Shadow and sun studies for any hour, month and day. |
| **Layer toggles** | Shading, Furniture, Labels, Dims, Sun path. | Show/hide scene elements. |
| **Camera presets** | Iso, Front, Side, Top, Walk. | Snapped camera angles. |
| **Sun readout overlay** | Month + day + time, sun altitude/azimuth, and a “below horizon” flag when applicable. | Live solar position. |
| **Geometry readout** | Floor area (m²), volume (m³), envelope area (m²), number of wall panels, number of shading devices. | The geometry the numbers were computed for. |
| **Expand / collapse** | Grows the viewport to a taller canvas and hides the side panels; **Esc** restores. | A focus mode for inspecting the model. |
| **Exports** | **PNG** (screenshot), **GLB** (binary glTF of the model), **PDF** (the design report). | Downloadable artefacts. |

The header also shows the **modelled WWR** and the **orientation**, and a mode-specific footnote (heat-map disclaimer, walkthrough controls, or normal-mode meters for glazing share and ventilation capacity).

### 6.3 `ShelterResultPanel` — the three required outputs

The centre of the Design Studio’s output band. Renders the `dailyProfile`.

| Element | Contents | Expected output |
|---|---|---|
| **Card 1 — Indoor temperature** | `min … max °C free-running`, with “Outdoor swings X K; the fabric removes Y %, leaving Z K indoors.” | The free-running indoor temperature range. |
| **Card 2 — Solar thermal gain** | `kWh/day`, per-m² figure, peak hour, and % of the day’s losses covered. | Thermal energy from solar radiation. |
| **Card 3 — Heat flow** | `kWh/day leaving`, with signed `FlowBar`s for Walls, Roof, Floor, Windows, Doors, Ventilation (loss in one colour, gain in another, a true zero shown as “0.0”). | Heat-flow details per component. |
| **24-hour curve** | A composed chart: the outdoor area (dashed, filled) and the indoor line (solid) on one axis, with a 0 °C reference line. | The gap between the curves is the envelope’s contribution; their convergence after sunset is the loss mechanism. |
| **Heat balance, this day** | Solar gain, internal gain, total loss, total gain (non-solar), peak flow (kW + hour). | A same-day summary. |
| **Provenance** | “Model estimate — not a measured building result.” plus a link to the 3D design and a form summary (type · plan · storeys · WWR · orientation). | Honesty + traceability. |

Header chips: **Heating-critical** / **Cooling-critical** (which month the design is judged on) and **Simplified heat balance** (engine provenance).

### 6.4 `ChartsPanel` — monthly charts

Three tabs over the same twelve months: **Temperature** (needs only a site), **Energy**, and **Heat balance**. Used on both Site & Climate and Thermal Analysis.

**Expected output:** the dashed outdoor line versus the solid free-running line — the gap is the envelope’s whole contribution — plus monthly energy and the monthly heat-balance terms.

### 6.5 `ClimateSummaryPanel` — full climatology

The monthly table (mean / min / max temperature, humidity, wind speed and direction, solar radiation, rainfall), the summary, the design conditions, and the **provenance** of the climate source.

**Expected output:** a complete, sourced climatology for the site.

### 6.6 `ResultsPanel` — the full tabbed read-out

The tabbed detail: **comfort / energy / cost / how-this-was-found**. It carries the PMV/PPD treatment, the provenance disclaimer and the surrogate-screening panel. Used at full width on Thermal Analysis and in the Design Studio.

**Expected output:** comfort metrics, energy breakdown, cost breakdown, and the search provenance.

### 6.7 `ComparisonPanel` — before / after

Renders **two models** side by side from the same `buildShelterGeometry` the numbers came from — the conventional local build and the optimiser’s answer — with the full metric table and the deltas. It diffs against conventional local construction, not a straw man.

**Expected output:** two buildings and the measured difference between them.

### 6.8 `RecommendationPanel` — explained recommendations

Each recommendation carries a **measured effect** and a **plain-language reason**, kept visibly separate — a plausible justification is not evidence.

**Expected output:** a list of decisions with their measured impact and their reason.

### 6.9 `ScenarioLab` — the Climate Response Lab

The showcase. Runs the real pipeline **five times** along the selected axis.

| Feature | How it functions | Expected output |
|---|---|---|
| **Axis switch** | **Building type** (one site, five forms — every difference is the form) or **Location** (one form, five sites — every difference is the site). On the location axis, a **Fixed form** selector picks the type held constant. | Two different sweeps. |
| **Cost ↔ comfort slider** | Sets the objective weights; a **Re-run sweep** button re-runs all five columns (not on every tick). | Five re-optimised columns. |
| **Progress** | “Optimising N of 5…” with a progress bar. | Feedback during the sweep. |
| **Finding** | The sweep headline + note, with the total candidate simulations and duration. | A one-line conclusion. |
| **The five, side by side** | Five `SweepCard`s, each with: a coloured accent, the title/glyph, the score (/100), a **Best** / **Weakest** chip, a **3D thumbnail** of its own building, the zone chip, Comfort (with delta) and Energy (with delta) stat cards, and “Optimised vs conventional on this site”. Clicking a card selects it. | Five visibly different buildings before a single number is read. |
| **Hero — the design at size** | The selected cell in a full-size `ScenarioViewport` with a **Design** switch: **Traditional** / **AI-optimised** / **Low-cost**. Switching redraws the envelope, not just the figures. An **Open in Design Studio** button loads the design **and** moves the studio to that site, then re-runs the pipeline. | One design, inspectable at size, in three genuine variants. |
| **Why this design** | The three trade-off numbers (Comfort / Energy / Cost), the challenge detail, the optimiser’s recommendations with impact chips, and two diff lists: **Search changed, vs conventional** and — on the location sweep — **Site adaptation, vs <first site>**. Plus a resolved-specification block (form, plan × storeys, floor area, WWR, orientation, peak indoor summer/winter, annual energy, construction cost). | The reason attached to every change. |
| **Option comparison chart** | A grouped bar of the three options’ scores for every column. | The whole point of the page in one chart. |
| **Honesty footer** | Every number is a model estimate from the same heat balance run five times; a five-point difference is within the noise of a monthly-mean model; the location sweep uses the offline database (Pune, Jodhpur, Chennai, Leh, Shillong), not live weather. | Provenance for the sweep. |

### 6.10 `MaterialPanel` — the envelope library

Shows the **resolved** assembly the current design is actually built from (not the nominal figure), including thicknesses and layers, and the full catalogue. In manual mode it doubles as the material picker (writing through `updateSelect`).

**Expected output:** U-values, densities, specific heats, solar absorptance, emissivity, cost and embodied carbon for every material, plus the resolved build-up of the live design.

### 6.11 Supporting components

| Component | Role |
|---|---|
| `ModelThumbnail` | A lightweight, non-interactive 3D render used in the dashboard preview and the sweep cards. |
| `FloorPlanCanvas` | The 2D plan used by the Plan view — walls, openings, dimensions and room labels. |
| `ScenarioViewport` | A full-size, interactive canvas for the sweep hero, with an export handle. |
| `PipelineFlow` | The stage-by-stage flow view (used where the full pipeline is shown). |
| `ProgressStrip` | The condensed 5-chip strip on the Dashboard. |
| `ui/primitives.tsx`, `ui/soft.tsx` | The shared kit: `Panel`, `Chip`, `Segmented`, `Toggle`, `Meter`, `StatCard`, `MetricRow`, `EmptyState`; and the soft kit: `PageHeader`, `SectionHeader`, `MetricCard`, `PastelCard`, `Gauge`, `BarRow`, `ProgressStrip`, `QuickActionCard`, `RecentDesignCard`, `ThreeDPreviewCard`, `StatusBadge`, `ExpandableSection`, `LocationChip`. |

---

## 7. The engines — how the numbers are made

### 7.1 Climate data layer (`climate/`)

**Provider chain** — resolved in order, and the interface **names which provider answered** and records every provider that failed:

1. **FastAPI service** (optional, if configured and reachable).
2. **Open-Meteo archive API** (ERA5 reanalysis, hourly, no key required).
3. **Bundled offline climatology database** (33 stations, deterministic).

Output: monthly normals (mean / min / max dry-bulb, RH, wind speed and direction, daily global horizontal irradiation, rainfall, sunshine hours) → derived HDD/CDD, diurnal swing, peak months, design conditions.

**Determinism note:** the location sweep in the Climate Response Lab deliberately uses the **offline database**, because a comparison whose baseline moves is not a comparison. The Design Studio uses whichever source answers.

**Expected output:** a resolved `ClimateData` payload with a labelled source, a provenance note and a fallback list.

### 7.2 Climate classification and strategy (`climate/climateAnalysis.ts`, `climate/classify.ts`)

Köppen–Geiger classification (simplified) → one of **eight climate zones** → the dominant thermal challenge → recommended ventilation strategy, insulation level, shading strategy, window ratio and orientation.

**Zones:** Hot & dry · Hot & humid · Warm & humid · Composite · Temperate · Cold & cloudy · Cold & sunny · Cold desert.

**Challenges:** Extreme summer heat · Combined heat and humidity · High day–night swing · Severe winter cold · Moisture and humidity · Intense solar gain.

This is the **seed** the optimiser starts from, not the answer. Each recommendation carries its reason.

### 7.3 Thermal model (`thermal/thermalModel.ts`) — the source of truth

A **quasi-steady-state monthly heat balance**, hour-resolved within each month, over a 12-month cycle.

**Governing equation** (every power signed positive into the zone):

```
C_eff · dT_in/dt  =  Q_solar + Q_internal − Q_envelope − Q_vent
```

**Conduction, per component** — the driving temperature for opaque surfaces is the **sol-air temperature**, not outdoor air:

```
T_sol-air = T_out + (α · I)/h_out − (ε · ΔR)/h_out
Q_wall  = Σ U·A · (T_sol-air − T_in)
Q_roof  = U·A · (T_sol-air − T_in)
Q_floor = U_g·A · (T_ground − T_in)      ← driven by the ground, not the weather
Q_win   = U·A · (T_out − T_in)
Q_door  = U·A · (T_out − T_in)
Q_vent  = ṁ·c_p · (T_out − T_in)
```

- **The floor is driven by the ground**, so a slab is a steady **loss** in a cold desert and a steady **gain** in a hot one — the reverse of every other surface. Its conductance uses an effective ground-coupled `U_g = 0.35 W/m²K`.
- **The door gets its own conductance** (it is cut out of the wall panel, so it must be added back or it becomes a hole that conducts nothing).
- `ΔR = 63 W/m²` for the roof (long-wave loss to a clear sky), `0` for vertical walls; `h_out = 20` walls, `22` roof.

**Thermal mass and diurnal penetration depth:**

```
δ = sqrt(2·α/ω),  α = k/(ρ·c_p),  ω = 2π/86400
C_eff = Σ_surfaces A · ρ · c_p · min(L, δ)
swing ratio = 1 / sqrt(1 + (2π·τ/24)²),   τ = C_eff / (U·A)_total
```

Only the outer skin of a thick wall follows the daily cycle — ~115 mm for rammed earth, 135 mm for concrete, 105 mm for a mud roof. A 450 mm earth wall therefore contributes roughly a quarter of its mass to the daily cycle.

**Opaque conduction (decrement factor and time lag):**

```
T_eff(t) = T̄ + DF · (T(t − lag) − T̄)
```

A 160 mm concrete roof has DF ≈ 0.35 and lag ≈ 4 h; a metal sheet has DF ≈ 1.0 and no lag.

**Composite assemblies** (four walls, two roofs) — U-value, areal mass and daily storage are all derived by walking the layer stack, each layer at its **own** penetration depth.

**Phase-change materials** — modelled by the **effective heat capacity method**:

```
c_p,apparent = c_p + (L/(2·band)) · (1 − |T − T_melt|/band)
```

A triangular weighting across the melting band. The "outside the band" branch is the whole point: **if the space never reaches the melting point, the latent store never charges and the PCM is dead weight.** The same 24 °C PCM board helps in Pune (mean 24.5 °C) and contributes nothing in Leh (5.6 °C).

**Solar gain:**

```
Q_solar = Σ_facades [ (I_b · cos θ · f_shade) + I_d,wall · f_diff ] · A_glazing · SHGC
```

Direct and diffuse treated separately; shading derived from device geometry and solar altitude; the roof treated as an area-weighted set of tilted planes so a gabled roof collects more winter sun than a flat one.

**Comfort:**
- **ISO 7730 PMV / PPD** for conditioned operation (reported separately — PMV was calibrated for conditioned spaces at fixed clothing and misjudges naturally ventilated buildings).
- **ASHRAE 55 adaptive comfort** for the free-running case.

**Design-critical month:** heating-dominated years are judged on their **coldest** month, cooling-dominated on their **hottest** — a result of the simulation, not a user setting.

### 7.4 Optimisation (`optimization/`)

**Coordinate descent over a curated neighbourhood** (~30–60 candidates), not a blind grid:

```
minimise   w₁·D_discomfort + w₂·E_energy + w₃·C_cost
subject to geometry, material palette, budget, occupancy constraints
```

- Each term is normalised against a **fixed reference range**, not the candidate set (min/max normalisation would make finding one good candidate silently worsen every other).
- Discomfort has two components — annual hours outside the adaptive band, and the severity of the worst season.
- The search is confined to the building type's **material palette** (a prefabricated panel shelter must not be "optimised" into rammed earth).
- `Cost ↔ Comfort` is a single user-facing priority that reweights the objective.
- The optimiser returns a **leaderboard** (cheapest, lowest energy, best comfort), not just a winner.

**Modules:** `designSpace.ts` (the searchable neighbourhood + `conventionalBaseline` + `analysisDrivenParameters`), `objective.ts` (weights and normalisation), `optimizer.ts` (the search), `costModel.ts` (₹ capital, ₹/m², 20-year ownership), `comparison.ts` (deltas), `recommendations.ts` (explained effects via a single-axis probe).

### 7.5 ML surrogate (`ml/`, optional backend)

The order is deliberate: **physics → trustworthy simulation → dataset → ML model → fast screen → optimisation.**

- Training data is generated **by the physics engine itself** (`scripts/export-dataset.ts`), labelled by `simulateDesign`.
- The model predicts energy intensity, adaptive comfort hours and construction cost from climate + geometry + materials.
- It **screens candidates** so the search can rank hundreds quickly; every shortlisted design is then **re-simulated by the physics engine** before it is shown. A surrogate answer never reaches the user as a result.
- The gate is **Spearman rank correlation + held-out MAE**, not R². When no gated model is present, the panel says so — absent, never faked.

**Shipped metrics (40,000 rows, 400 trees, depth 6):**

| Target | R² | ρ | MAE | Gate |
|---|---:|---:|---:|---|
| `energy_use_intensity_kwh_m2_yr` | 0.979 | 0.978 | 5.23 kWh/m²·yr | ρ ≥ 0.90, MAE ≤ 15 |
| `adaptive_comfort_hours_pct` | 0.892 | 0.936 | 5.36 pp | ρ ≥ 0.90, MAE ≤ 6 |
| `cost_per_m2_inr` | 0.990 | 0.995 | ₹956/m² | ρ ≥ 0.90, MAE ≤ 2500 |

### 7.6 Geometry and 3D (`utils/shelterGeometry.ts`, `components/3d/`)

The 3D layer is **procedural**, not an imported mesh — because a static mesh cannot answer the optimiser.

| Element | Generated by |
|---|---|
| Walls with real holes cut per opening | 2D outline extruded with holes |
| Roofs — flat, shed, gable, hip, vaulted | Sampled height field over the plan |
| Floor slabs, one per storey | A box per `floorSlabs` entry |
| Parapets, partitions, module joints | Extruded frames and boxes |
| Shading — overhang, louvre, blind, fin, verandah | Decomposed into wall-local boxes |
| Wall and roof surface patterns | Procedurally drawn to a cached canvas |
| Site, sky, fog, ground, human-scale figure | Procedural geometry and shaders |

The **same** `buildShelterGeometry` feeds both the renderer and the physics, so the picture and the numbers cannot disagree.

### 7.7 Solar geometry (`utils/solar.ts`)

A reimplementation of the **NOAA Solar Calculator** algorithm — declination, equation of time, altitude, azimuth. The same solar direction drives both the on-screen shadows and the thermal model’s solar gain.

### 7.8 Psychrometrics and units (`utils/psychrometrics.ts`, `utils/units.ts`, `utils/format.ts`)

Humidity and comfort calculations, month/day helpers (`MONTH_LABELS`, `DAYS_IN_MONTH`, `dayOfYear`), and the shared formatters (`currency`, `num`, `pct`, `temp`, `energyPerYear`, `uValue`, `area`, `volume`, `latLon`, `compass`, `clockTime`).

---

## 8. Data catalogues

### 8.1 Climate stations — 33 stations across 11 countries

| Country | Stations |
|---|---|
| India (23) | Pune, Leh, New Delhi, Mumbai, Chennai, Bengaluru, Jaipur, Jodhpur, Shillong, Srinagar, Kolkata, Ahmedabad, Hyderabad, Guwahati, Thiruvananthapuram, Kochi, Coimbatore, Nagpur, Visakhapatnam, Lucknow, Bhopal, Amritsar, Shimla |
| UAE | Dubai |
| Singapore | Singapore |
| United Kingdom | London |
| United States | Phoenix |
| Iceland | Reykjavík |
| Kenya | Nairobi |
| Australia | Sydney |
| Japan | Tokyo |
| Egypt | Cairo |
| Canada | Toronto |

Each station carries **12 months** of: mean / mean-daily-max / mean-daily-min dry-bulb temperature, relative humidity, wind speed, prevailing direction, daily global horizontal irradiation, monthly rainfall and mean daily sunshine hours.

**Location-sweep stations (the demo set):** Pune (hot semi-arid), Jodhpur (hot desert), Chennai (hot humid), Leh (cold desert), Shillong (temperate highland).

**Helpers:** `STATION_BY_ID`, `AVAILABLE_COUNTRIES`, `citiesInCountry`, `statesInCountry`, `nearestStation` (haversine fallback for map clicks), `DEFAULT_STATION_ID = 'in-pune'`.

### 8.2 Building types — 5 templates

Each type is a bundle of ordinary `BuildingParameters` plus a small massing descriptor — **not** a special case inside the physics engine.

| Type | Glyph | Use case | Storeys | Party walls | Verandah | Modules | Parapet | Daylight target | Accent |
|---|---|---|---|---|---|---|---|---|---|
| Single-family home | 🏠 | Residential | 1–2 | none | 0 | 1 | no | 0.22 | terracotta (18°) |
| Compact / row house | 🏘️ | Dense residential | 2–3 | both | 0 | 1 | no | 0.18 | ochre (32°) |
| Low-rise building | 🏢 | Apartments / offices | 2–4 | none | 0 | 1 | yes | 0.30 | amber (42°) |
| Rural / vernacular shelter | 🛖 | Rural / low-cost | 1 | none | 1.8 m | 1 | no | 0.16 | olive (92°) |
| Modular emergency shelter | 🏗️ | Disaster / temporary | 1 | none | 0 | 3 | no | 0.25 | rust red (8°) |

**How a type difference is modelled** (nothing decorative):

| Type difference | Modelled as |
|---|---|
| Extra storeys | Taller envelope, more floor area and volume |
| Party walls | Walls with no outdoor exposure — no UA, no solar gain |
| Deep verandah | A `deep-verandah` shading device on the long facades |
| Module bays | Repeated structural bays and the envelope they enclose |
| Heavy local materials | Wall/roof material id → density × specific heat |
| Stack ventilation | Ventilation strategy → purge mass flow |

**Palettes** — each type is buildable only from a coherent set of materials and strategies (a palette is *not* a lock; it is the set of choices coherent with the type). `fitToTemplate()` projects any design back onto its palette, so the type selector cannot be erased by the climate engine.

### 8.3 Material library — 27 entries across five categories

*(The landing page's headline "24 materials" refers to the core wall + roof + window + insulation set: 8 + 6 + 4 + 6 = 24.)*

**Wall materials (8)**

| Material | k (W/m·K) | Thickness | ρ (kg/m³) | c_p (J/kg·K) | α | Cost (₹/m²) | Embodied C |
|---|---:|---:|---:|---:|---:|---:|---:|
| Reinforced concrete | 1.7 | 0.15 | 2400 | 880 | 0.65 | 3,400 | 320 |
| Burnt clay brick | 0.7 | 0.23 | 1800 | 880 | 0.70 | 2,350 | 210 |
| Fly-ash brick | 0.55 | 0.23 | 1500 | 900 | 0.62 | 2,050 | 130 |
| AAC block | 0.16 | 0.20 | 600 | 1000 | 0.55 | 3,100 | 180 |
| Hollow concrete block | 0.6 | 0.20 | 1400 | 880 | 0.68 | 2,600 | 160 |
| Rammed earth | 0.8 | 0.30 | 1900 | 900 | 0.55 | 1,750 | 40 |
| Local stone masonry | 1.2 | 0.35 | 2200 | 900 | 0.60 | 2,200 | 90 |
| Insulated AAC wall | 0.16 | 0.20 | 620 | 1000 | 0.50 | 4,150 | 250 |

**Roof materials (6)** — RCC slab with terrace, Profiled metal sheet, Reflective cool roof (α 0.28), Insulated RCC roof (75 mm XPS), Insulated PUF panel (U ≈ 0.024), Mud-phuska thatch (α 0.5, embodied carbon 25).

**Window materials (4)**

| Glazing | U (W/m²K) | SHGC | VLT | Cost (₹/m²) |
|---|---:|---:|---:|---:|
| Single 4 mm | 5.8 | 0.85 | 0.90 | 1,350 |
| Double 4-12-4 | 2.8 | 0.76 | 0.81 | 3,450 |
| Double low-E 4-12-4 | 1.7 | 0.42 | 0.70 | 4,600 |
| Triple low-E | 0.9 | 0.34 | 0.62 | 7,900 |

**Insulation boards (6)** — none, EPS (k 0.035), XPS (0.03), PUF (0.024), Mineral wool (0.04), Coir (0.045).

**Door leaves (3)** — Solid timber (U 2.2, permeability 4.0), Insulated composite (U 1.1, 2.0), Insulated steel (U 1.4, 1.5).

**Derived functions:** `effectiveUValue` (recomputes an assembly with an added insulation layer), `effectiveUValues`, `arealHeatCapacity`, `diurnalPenetrationDepth`, `apparentSpecificHeat` (PCM), `diurnalArealCapacity`.

### 8.4 Design parameters — full list with ranges

| Parameter | Unit | Min | Max | Step | Notes |
|---|---|---:|---:|---:|---|
| Building type | — | — | — | — | 5 options; resets type-defined values |
| Storeys | — | type min | type max | 1 | Programme; clamped on write |
| Width | m | 3 | 12 | 0.1 | Programme |
| Length | m | 3 | 16 | 0.1 | Programme |
| Floor-to-ceiling | m | 2.2 | 4.2 | 0.05 | Programme |
| Occupants | — | 1 | 12 | 1 | Programme; drives internal gains |
| Rooms | — | 1 | 4 | 1 | Programme |
| Budget | ₹ | 200,000 | 3,000,000 | 25,000 | Programme; soft constraint |
| Wall material | — | — | — | — | 8 options |
| Composite wall build-up | — | — | — | — | 4 options; overrides wall material |
| Wall thickness | m | 0.10 | 0.50 | 0.01 | |
| Insulation level | — | — | — | — | none/low/medium/high/very-high |
| Insulation thickness | m | 0 | 0.20 | 0.005 | Added layer over the base assembly |
| Window-to-wall ratio | — | 0 | 0.60 | 0.01 | Biggest lever on gain and loss |
| Glazing position | — | — | — | — | 6 named distributions |
| Glazing | — | — | — | — | 4 options |
| Roof material | — | — | — | — | 6 options |
| Composite roof build-up | — | — | — | — | 2 options |
| Orientation | ° | 0 | 359 | 1 | Clockwise from north |
| Roof form | — | — | — | — | flat/shed/gable/hip/vaulted |
| Roof pitch | ° | 0 | 45 | 1 | Ignored for flat |
| Roof overhang | m | 0 | 1.5 | 0.05 | |
| Shading device | — | — | — | — | 6 options |
| Shading depth | m | 0 | 1.8 | 0.05 | |
| Ventilation strategy | — | — | — | — | 6 options |
| Design air changes | ACH | 0.5 | 12 | 0.5 | Capacity, not a constant rate |
| Cooling setpoint | °C | 20 | 30 | 0.5 | Programme |
| Heating setpoint | °C | 14 | 24 | 0.5 | Programme |
| Cooling COP | — | 1.8 | 6 | 0.1 | Programme |
| Heating efficiency | — | 0.6 | 4 | 0.05 | >1 = heat pump |
| Rooftop PV | kWp | 0 | 10 | 0.5 | Offsets energy, not comfort |

### 8.5 Strategy vocabularies

**Insulation levels → thickness → material**

| Level | Thickness | Board |
|---|---:|---|
| none | 0 mm | none |
| low | 40 mm | Coir |
| medium | 75 mm | EPS |
| high | 100 mm | XPS |
| very-high | 150 mm | PUF |

**Ventilation strategies → design ACH capacity:** Sealed + mechanical 0.5 · Single-sided 2 · Night purge 5 · Stack ventilation 6 · Mixed mode 6 · Cross-ventilation 8. (Infiltration floor = 0.5 ACH.)

**Roof forms → default pitch:** flat 0° · shed 20° · gable 30° · hip 30° · vaulted 35°.

**Shading strategies:** none · overhang · louvres · external blinds · deep verandah · overhang + fins.

**Glazing-position distributions (6):** balanced · south-led · south+east · south+west · north-shielded · east+west. Orientation decides where the sun is; the glazing strategy decides where the window is.

---

## 9. The three required outputs — worked example

**Offline climatology, optimised designs, single-family home:**

| Site | Critical month | Comfort hours | EUI (kWh/m²·yr) | Score |
|---|---|---|---:|---:|
| Pune | May (cooling) | 71.5 % | 14.9 | 78 / 100 |
| Leh | January (heating) | 33.4 % | 36.1 | 54 / 100 |

**Leh in January:** free-running indoor **3.2 – 4.8 °C** against an outdoor swing of 15 K, with the fabric removing 93 % of it, 14.5 kWh/day of solar gain covering 51 % of a 28.3 kWh/day loss. The shelter holds roughly **12 K above outdoor air** on the strength of the sun and its mass alone.

**Thermal-mass differentiation across the five forms, same site (Leh):**

| Building type | Indoor swing | Damping | Loss (kWh/day) |
|---|---:|---:|---:|
| Rural / vernacular (earth, 450 mm) | 1.1 K | 93 % | 24.3 |
| Compact / row house | 0.9 K | 94 % | 31.4 |
| Single-family home | 2.0 K | 87 % | 43.4 |
| Low-rise building | 2.4 K | 84 % | 149.9 |
| Modular emergency shelter (panels) | 6.3 K | 58 % | 19.9 |

The heavyweight shelter rides out the weather; the lightweight panel shelter tracks it.

**Five-site demo — one brief, five climates, five different buildings:**

| Site | Zone | Comfort hours | EUI | What the optimiser chose |
|---|---|---|---:|---:|---|
| Pune | Hot semi-arid | 67 % | 22.5 | flat roof, no added insulation |
| Leh | Cold desert | 25 % | 33.5 | flat roof, **very high** insulation |
| Jodhpur | Hot desert | 31 % | 26.7 | flat roof, medium insulation |
| Chennai | Hot humid | 31 % | 38.2 | flat roof, low insulation |
| Shillong | Temperate highland | 100 % | 10.4 | flat roof, high insulation |

Leh needs insulation and Shillong needs almost nothing; that difference is the whole point of "area-specific".

---

## 10. Reports and exports

### 10.1 The PDF design report (`lib/report.ts`)

There is **no PDF library** in the stack on purpose. The report is a styled HTML document opened in a new window and handed to the browser's **print-to-PDF**. This keeps the bundle lean and means the document always reflects the live design.

**Sections, in order:**

1. **Header** — location · climate type · mode (AI-optimised / Manual) · timestamp.
2. **Required outputs — representative day in <month>** — indoor temperature (free-running), outdoor swing / indoor swing, swing removed by the fabric, solar thermal gain, solar gain per m², solar peak hour, solar coverage of losses, total heat flow leaving, peak heat-flow rate. Beside it, **heat flow by component** (Walls, Roof, Floor, Windows, Doors, Ventilation), signed (positive = entering).
3. **Building form** — type, storeys, plan, floor-to-ceiling, WWR, glazing position, wall, roof, roof form, shading, ventilation, orientation, budget.
4. **Outcome** — the score, the conventional reference score, adaptive comfort, peak indoor summer/winter, conditioned PMV, conditioned PPD.
5. **Energy** — annual delivered energy, EUI, cooling, heating, operational CO₂.
6. **Cost** — capital cost, cost per m², 20-year ownership, budget status.
7. **Against conventional construction** — the deltas.
8. **Disclaimer** — “Model estimate — not a measured building result.” printed on the page, not buried in a footnote.

### 10.2 Other exports

| Export | Source | Result |
|---|---|---|
| **PNG** | Viewport header | A screenshot of the current 3D view. |
| **GLB** | Viewport header | The model as binary glTF. |
| **PDF** | Viewport header | The design report above. |

---

## 11. The single store (`store/designStore.ts`)

Everything the dashboard shows is a projection of **one** Zustand store. Two rules keep it honest:

1. **Nothing is derived twice.** The thermal result, the cost estimate and the resolved geometry all come out of a single `EvaluatedCandidate`.
2. **Slider moves do not re-run the pipeline.** Re-fetching climatology on every drag would be slow *and* dishonest — the climate has not changed. A slider calls `reevaluateManual`, which re-runs only the thermal and cost stages.

**Auto vs manual are not cosmetic.** In **auto** mode the parameter panel is read-only (the optimiser owns the envelope; letting a user nudge a value would silently invalidate the search). **Manual** hands the envelope back and keeps the optimiser's answer as the reference.

**Key state:** `location`, `climateData`, `climateAnalysis`, `baselineParameters` / `optimizedParameters` / `currentParameters`, `currentThermal` / `baselineThermal`, `optimization`, `comparison`, `recommendations`, `metrics`, `cost`, `score`, `materials`, `geometry`, `leaderboard`, `priority`, `mode`, `visualizationMode`, `cameraPreset`, `hourOfDay` / `analysisMonth` / `dayOfMonth`, layer toggles, `panels`, `pipeline`, backend/live toggles, `viewportExpanded`.

**Key actions:** `setLocation` (clears every climate-derived number), `setMode`, `setPriority`, `setVisualizationMode` (also sets a matching camera preset), `setHour/Month/Day` (month clamps the day to the new month's length), `setPanel`, `toggleLayer`, `updateNumeric` (programme changes rebuild recommendations), `updateSelect`, `setParameters`, `adoptAdvice`, `adoptConventional`, `loadScenario` (moves the site **and** re-runs the pipeline), `setUseBackend`, `setPreferLive`, `setOpenMeteoApiKey`, `toggleViewportExpanded`, `generate`, `dismissError`.

**The pipeline stages** (`STAGE_ORDER`): input → climate → analysis → thermal → optimization → parameters → geometry → results. Each reports a headline and detail lines once a run finishes, and `generate()` advances them live via `onStage`.

---

## 12. Verification

`npm run verify` runs three suites (70 assertions total):

- **`verify:model`** — PMV against published reference values (22 °C → −0.81, 24 °C → −0.22, 26 °C → 0.38), monotonic response to heat/air speed/clothing, periodic construction response (RCC 160 mm → decrement 0.341, lag 4.1 h; rammed earth 300 mm → 0.071, 10.1 h), and the climate-classification invariants.
- **`verify:geometry`** — the 3D model and the thermal model resolve the **same** geometry (a flat roof's area equals its overhang footprint; a 20° shed roof's area equals footprint ÷ cos 20°).
- **`verify:dashboard`** — 70 assertions covering real pipeline stage transitions, auto and manual mode, viewport/parameter agreement, the five-site demo, and that changing site clears stale results.

**`verify:ps51`** asserts, for each site: all three outputs finite; the fabric damps the outdoor swing; the swing is not degenerate (> 0.5 K); solar gain is positive during daylight; heat loss is positive and attributed per component; loss and gain partition the gross flow exactly; the indoor profile has a real shape; the hourly series is complete; the shelter is warmer than outdoor air on average at both a cold and a warm site; the cold site is judged on its coldest month and the warm site on its hottest; and the five building types produce **different** thermal profiles.

The Python suite (`pytest`, 223 tests) compares the backend's climate port against values captured from the TypeScript engine for **all 33 stations × 12 months × 9 fields**, plus the Köppen classifier and the feature contract.

---

## 13. Known limitations

1. **Not a validated dynamic simulation.** Single zone, monthly-mean climate driving an hourly representative day. No thermal bridging, no multi-zone airflow, no latent storage, no full 3D radiation exchange.
2. **Representative day, not a real date.** The daily profile uses the month's mean conditions with its diurnal swing, not the weather of a specific day.
3. **No measured validation.** There is no published measured shelter dataset in the problem statement, and the platform does not claim agreement with one.
4. **Costs are indicative Indian market rates** — a trade-off tool, not a tender price. The budget is a soft constraint (an overrun is reported, not blocked).
5. **The surrogate is a screen, not an answer.** Its output never reaches the user as a result.
6. **Diurnal capacitance is a lumped approximation.** Phase lag within a thick wall is approximated by the decrement-factor method.
7. **Purge ventilation is a rule, not a control model.**
8. **Window position is searched as a named strategy, not a per-facade continuum** (six distributions rather than four continuous weights).
9. **The floor is modelled as a single ground-coupled conductance.** Perimeter insulation, earth-sheltering and slab-edge detail are not represented.
10. **Phase-change placement is not resolved.** The model cannot show the melting front or where in the build-up the layer sits.
11. **Composite assemblies are a curated set, not a stack editor.** Adding one means adding an entry to `thermal/assemblies.ts`.
12. **The heat map shows absorbed solar radiation, not surface temperature.**
13. **PMV is reported separately from adaptive comfort** — reporting one number for both would be misleading.
14. **Ventilation ACH is a capacity, not an operating rate.**

---

## 14. Quick feature → expected-output matrix

| Feature | Where | What the user gets |
|---|---|---|
| Site search (geocoding) | Topbar, Site & Climate | Sets the design to any world location |
| Built-in climatology (33 stations) | Site & Climate, Topbar | Deterministic, offline site data |
| Climate classification | Site & Climate | One of 8 zones + dominant challenge |
| Climate strategy | Site & Climate | Ventilation, insulation, shading, glazing, WWR, orientation recommendations |
| Building-type selector | Parameter panel | One of 5 real forms, with its own palette and massing |
| Parameter sliders/selects | Design Studio | Live re-evaluation of thermal + cost (manual mode) |
| 3D viewport (9 modes) | Design Studio | Interactive model in Normal/Heat map/Air flow/Solar/Plan/Front/Side/Top/Walk |
| Sun/time study | Viewport | Shadows for any hour, month and day |
| PNG / GLB / PDF export | Viewport | Screenshot, 3D model, printable report |
| The three required outputs | Dashboard, Design Studio | Indoor temperature, solar gain, heat flow (24-h curve) |
| Thermal Analysis | `/dashboard/analysis` | Peak indoor, passive comfort, EUI, heat balance, full tabbed read-out |
| Optimisation | `/dashboard/optimization` | Priority slider, before/after models, explained recommendations |
| Climate Response Lab | `/dashboard/scenarios` | Five columns × 3 variants, each drawn at size, with the parameter diff |
| Materials library | `/dashboard/materials` | Resolved assembly + full catalogue with U-values and costs |
| AI / Model | `/dashboard/model` | Surrogate status, gate, registry, measured accuracy |
| Method & Limits | `/dashboard/method` | The method, the standards, and what is not claimed |
| Settings | `/dashboard/settings` | Backend routing, live data, API key, generation priority |
| Design report | Viewport → PDF | A printable, disclaimered design report |
| Single store | Whole app | Every panel is a projection of one consistent state |

---

*Thermal Shelter · SIH Problem Statement 51. Geometry is procedural; no imported 3D assets. Climate by Open-Meteo (ERA5) / offline normals; solar geometry by the NOAA algorithm. Every figure is a model estimate — not a measured building result.*
