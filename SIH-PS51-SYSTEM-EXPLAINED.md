# SIH PS-51 — Complete System Explanation

**Problem statement:** Software Based Model Development for Design of Area Specific Shelter for Thermal Comfort Maintenance (DRDO).

**One-sentence description:** A physics-first, area-specific, mission-specific defence-shelter thermal design platform that fingerprints an Indian deployment site, derives the shelter's thermal requirements with reasons attached, simulates one shared geometry, prices three comfort strategies on that one envelope, and states honestly which of its own numbers are checked against a standard and which are not.

**Accuracy rule for this document:** every claim below was verified against the code in this repository at the time of writing. Nothing here is a roadmap item presented as done. Where something is **not** implemented, it is stated as such and placed in §32.

---

# LEVEL 1 — SYSTEM SUMMARY

**What it is.** A web application that turns "where will this shelter be deployed, for what mission, and of what type" into a sized, optimised, explained thermal design plus an engineering report.

**Who uses it.** A defence engineer or a design team deciding how to build or specify a shelter for a specific Indian deployment location.

**What problem it solves.** Shelters are currently specified by habit or by catalogue, not by the site. Leh at −20 °C and Jodhpur at 47 °C need fundamentally different envelopes, and the same shelter cannot serve both. This platform computes *why* the design must change, and by how much.

**How it works, in one pass.**
1. The user picks an Indian location. The system resolves its climate from a live archive or an offline climatology database.
2. A **climate fingerprint** engine reduces that climate to eight severity indices and names the primary and secondary thermal challenge.
3. The user picks a **mission** (personnel, command, communication, medical, equipment, storage, observation, field operations) and a **defence shelter type** (9 types).
4. A **requirement engine** combines location + mission + shelter and proposes a full thermal design — insulation, assembly, reflectance, shading, orientation, ventilation, infiltration class, HVAC — **each line carrying a reason** tied to a specific fingerprint index.
5. Those requirements **seed** the optimiser. They do not replace the simulation.
6. The **thermal engine** simulates one geometry, shared with the 3D renderer, producing temperature, heat flow, moisture, comfort, stress and energy.
7. The user views results as **sixteen 3D modes**, charts, and a clickable surface inspector.
8. An **optimiser** searches around the seeded design and returns a **leaderboard** — lowest energy, lowest cost, lowest mass, highest comfort, fastest deployment, balanced — never one unexplained "best".
9. A **report** is generated carrying the fingerprint, requirements with reasons, and an explicit model-fidelity statement.

**What makes it defensible rather than a demo.** One design state → one geometry → one simulation → one visual. No duplicate engines. The ML model accelerates search only. No quantity is reported without a validation status.

---

# LEVEL 2 — SYSTEM ARCHITECTURE

## 2.1 Technology stack (verified)

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.33 (App Router), React 18, TypeScript (strict) |
| 3D | Three.js + `@react-three/fiber` + `@react-three/drei` |
| State | Zustand (`store/designStore.ts`) |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Maps | Leaflet |
| Optional backend | FastAPI (Python), Open-Meteo ERA5 archive |
| Verification | `tsx` scripts, 7 suites |

## 2.2 High-level system map

```
USER INPUT (location · mission · shelter · envelope · systems)
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  ZUSTAND STORE — the single source of truth                  │
│  currentParameters · currentClimate · currentThermal ·        │
│  optimizerResult · selectedSurface · mode · hour · month      │
└──────────────────────────────────────────────────────────────┘
        │
        ├──────────────► CLIMATE LAYER
        │                resolveClimate() → FastAPI ▸ Open-Meteo ▸
        │                offline station DB ▸ interpolation ▸ synthesis
        │                → computeClimateFingerprint() (8 indices)
        │
        ├──────────────► GEOMETRY (ONE geometry, shared)
        │                buildShelterGeometry(parameters, materials)
        │                → walls · roof · floor · openings · areas · volume
        │
        ├──────────────► MATERIALS / ENVELOPE
        │                resolveMaterials() → layered assemblies → U, R, mass
        │
        ├──────────────► PHYSICS ENGINE (the authority)
        │                evaluateDesign() → monthly quasi-steady heat balance
        │                → temperature · solar · heat flow · moisture ·
        │                  comfort · stress · energy
        │
        ├──────────────► DERIVED ANALYSIS (all read the same result)
        │                heatLoss · ventilationControl · hvac · strategies ·
        │                deployment · uncertainty · requirements
        │
        ├──────────────► OPTIMISATION
        │                seeded by requirements → coordinate descent →
        │                leaderboard (energy/cost/mass/comfort/deployment)
        │
        └──────────────► PRESENTATION
                         3D digital twin (16 modes) · charts · inspector ·
                         report · exports
```

**The invariant.** Every engine above reads from the store and from `evaluateDesign`. There is exactly one geometry builder and one thermal engine. The 3D renderer consumes the same `ShelterGeometry` object the physics does, which is why the picture cannot disagree with the numbers.

---

# LEVEL 3 — COMPONENT-BY-COMPONENT EXPLANATION

## 1. Project Overview

**Purpose.** Determine how a shelter should be designed for a particular Indian deployment location and mission, and explain the answer.

**Scope of the model.** Thermal comfort, moisture, heat flow, energy, envelope mass, deployability, and cost comparison — for a single-zone shelter, at monthly resolution with hourly intra-day sampling.

**What it deliberately does not do.** It is not a compliance tool, not a CFD solver, and not a validated dynamic simulator. §32 lists every gap.

## 2. Architecture Overview

**Frontend.** Next.js App Router. Twelve routes under `/dashboard` plus a landing page and login.

**State.** One Zustand store holds the design, the resolved climate, the thermal result, the optimiser result, the comparison set, the current 3D mode, the selected surface, and the analysis hour/month. Every page is a *view* over that one store.

**Pipeline.** `optimization/pipeline.ts` exposes `evaluateDesign` and `reevaluateManual`. A manual parameter edit re-derives the thermal result and rebuilds the geometry **without** re-fetching climate — verified by tests.

**Backend.** Optional FastAPI service. It serves climate data and a *surrogate screening* endpoint. It does not simulate buildings; the TypeScript engine is the thermal authority. This is documented in `api/client.ts` in those words.

## 3. Frontend Architecture

**Routes (verified, all returning HTTP 200):**

| Route | Purpose |
|---|---|
| `/` | Landing / explanation |
| `/dashboard` | Main dashboard — 3D twin centre, parameters left, metrics right |
| `/dashboard/climate` | Site & Climate |
| `/dashboard/brief` | **Design Brief** — requirements, moisture, stress, deployability |
| `/dashboard/fingerprint` | *Redirect only* — the fingerprint is now a **tab on Site & Climate**, next to the climate data it is derived from |
| `/dashboard/design` | Design Studio |
| `/dashboard/analysis` | Thermal Analysis |
| `/dashboard/optimization` | Optimisation + leaderboard |
| `/dashboard/scenarios` | Climate Response Lab |
| `/dashboard/materials` | Material catalogue |
| `/dashboard/model` | *Redirect only* — the surrogate is now a **section on Method & Limits**, with the rest of the fidelity discussion |
| `/dashboard/method` | **Method & Limits** — validation + uncertainty |
| `/dashboard/settings` | Settings |

**Component organisation.** `components/3d/` (canvas, model, palette, rig, overlays, environment), `components/dashboard/` (panels, inspector), `components/ui/` (primitives), `components/shell/` (nav).

### The sidebar — eight primary items

The navigation is deliberately short. A page earns a primary slot only if it is a **step the user moves through while designing**. Everything else is either reference material or a reading of data that already exists, and is folded into the page it belongs to:

```
MAIN
  Dashboard

DESIGN
  Site & Climate        ← the Climate Fingerprint is a TAB on this page
  Design Brief
  Design Studio
  Thermal Analysis
  Optimization

COMPARE
  Climate Response

REFERENCE
  Materials
```

Two pages that used to be destinations are now **sections of the pages they describe**:

- **Climate Fingerprint** is a *reading of the site*, not a stage of the design, so it is a tab on **Site & Climate**, beside the climate data it is derived from.
- **AI / Model** describes how the surrogate behaves and what it may claim — that is method and fidelity, not a place to go — so it is a section on **Method & Limits**.

Both old routes (`/dashboard/fingerprint`, `/dashboard/model`) still exist as **redirects**, so a bookmark or an old link lands on the right tab instead of a 404.

**Method & Limits** and **Settings** are reference and configuration rather than workflow, so they render as **small links in the sidebar footer** (and inside the mobile "More" sheet) instead of competing for attention with the eight steps. Nothing becomes unreachable; it just stops asking for equal prominence.

`components/shell/nav.ts` holds this as data — `NAV_ITEMS` (the eight), `UTILITY_LINKS` (the two), and `NAV_GROUPS`. A test asserts the primary set is exactly those eight in order, that no demoted page is primary, that every group is used, and that every route — primary or utility — still resolves a title.

## 4. Backend / Climate Data Architecture

**Resolution chain (`climate/climateService.ts`), in order:**

1. **FastAPI backend** — only when `NEXT_PUBLIC_API_URL` is configured and reachable.
2. **Open-Meteo ERA5 archive** — live historical reanalysis. The request is verified to state `wind_speed_unit=ms`, to ask for the documented 2019–2023 window, and to request every variable the pipeline consumes.
3. **Offline climatology database** — a station record matched by id (33 Indian stations).
4. **Inverse-distance interpolation** between nearby stations.
5. **Latitude/elevation synthesis** — last resort, when no station is near.

Each resolution reports which source it used and which fallbacks it traversed. The application runs fully offline; live data is an enhancement, not a dependency.

**Units discipline.** The pipeline normalises on ingest: rainfall totals are month-length-aware (a mean-daily-value bug that would understate annual rain by >20× is explicitly tested against), 18 MJ/m²/day → 5.0 kWh/m²/day, 21600 s/day → 6 h/day sunshine.

## 5. Thermal Engine

**File:** `thermal/thermalModel.ts`.

**Type:** `simplified-monthly-heat-balance` — a transparent, first-principles **quasi-steady-state** model. For each month it evaluates a representative day at hourly resolution and resolves it into the three quantities DRDO asks for.

**Physical content:**
- Sol-air temperature (air temperature + absorbed solar + long-wave sky correction)
- Conduction through layered assemblies via U-value
- Thermal mass via decrement factor / time lag
- PCM modelled as effective heat capacity
- Ground-coupled floor (a steady loss in a cold desert, a steady gain in a hot one — the reverse of every other surface)
- Ventilation and infiltration as separate streams
- Internal gains from occupants and equipment (sensible/latent split)
- Solar gains through glazing and absorbed on opaque surfaces

**Outputs:** indoor temperature (monthly and hourly), heating/cooling load, energy intensity, solar gain, PMV/PPD, adaptive comfort, comfort hours.

**Honesty.** The engine itself emits the label *"Model estimates from a transparent hourly-per-month heat balance — not validated dynamic simulation, and not measured data. Use for design comparison, not for compliance claims."* That string travels into the UI and the report.

## 6. Geometry System

**File:** `utils/shelterGeometry.ts` → `buildShelterGeometry(parameters, materials)`.

**What it produces:** wall segments (N/E/S/W) with areas and orientations, roof, floor, openings (windows/doors) with positions, shading devices, volume, floor area, exposed wall area, glazing and door areas, total height.

**The critical property.** This is **one** geometry. The renderer draws it; the physics simulates it; the optimiser scores it; the exports serialise it. There is no separate display model. `ViewportPanel.tsx` states this in its header comment and the code enforces it by deriving geometry from `currentParameters` on every change through the same builder the thermal model consumes.

**Surface identity.** Surfaces carry stable ids (four walls, roof, floor) used by the heat map, the surface-temperature map, the inspector, and the 3D selection — so a surface selected in one mode stays selected when the mode changes.

## 7. Climate Fingerprint System

**File:** `climate/fingerprint.ts` → `computeClimateFingerprint(climate)`.

**Eight severity indices**, each normalised 0–1 against a documented physical range:

| Index | What it captures |
|---|---|
| Winter severity | How cold the cold season gets |
| Summer severity | How hot the hot season gets |
| Diurnal swing | Day/night amplitude |
| Solar severity | Incident irradiance load |
| Wind severity | Exposure |
| Humidity severity | Moisture load |
| Night-cooling potential | Free-cooling opportunity |
| Altitude severity | Elevation effect |

**Output:** the eight indices, a **primary** and **secondary** `ThermalChallenge`, a `requiredDesignFor(...)` mapping, and a summary sentence.

**Example results (verified by test):** Leh is cold-dominated; Jodhpur is solar-dominated; Chennai is humidity-dominated.

**Why it exists.** It converts a climate dataset into a design instruction. It is computed, not a hard-coded zone label — which is why the requirement engine can cite it.

## 8. Defence Shelter Model

**File:** `lib/buildingTypes.ts`. The library holds **14 types**, tagged `category: 'civil' | 'defence'` — 5 pre-existing civil types plus **9 defence types**:

| Shelter | Envelope character |
|---|---|
| High-altitude personnel shelter | Insulated fabric + reflective foil, low infiltration |
| Desert field tent | Light single-skin, high albedo, shading-led |
| Warm-humid shelter | Ventilated fabric/panel, moisture control |
| Modular prefab shelter | Sandwich panel, fast to erect |
| Modular insulated cabin | PUF/insulated panel, higher mass |
| Command / communication shelter | Insulated panel, high internal equipment load |
| Equipment shelter | Panel envelope, load-dominated, no occupancy |
| Medical field shelter | Panel + humidity floor, hygiene ventilation |
| Semi-underground / bunker | Earth-berm wall + earth roof, very high mass |

Each carries a real **palette** (base materials + composite assemblies), **defaults**, **massing** constraints and a **`climateRationale`** string. Tests assert every palette material and assembly resolves, and that all nine produce **distinct** thermal profiles on the same site — i.e. the types are physically different, not cosmetic.

## 9. Envelope System

**Files:** `thermal/materials.ts`, `thermal/assemblies.ts`, `thermal/materials` resolution.

**Model.** Not single materials — **layered assemblies**, outside → inside: outer skin → air gap → reflective layer → insulation → inner liner. Seven defence assemblies were added, including reflective foil, PUF and earth berm.

**Per-layer properties exposed:** material, thickness, conductivity (λ), density, specific heat, emissivity, absorptance, reflectance, mass, cost.

**Derived per assembly:** total thickness, areal mass, R-value, U-value, and thermal mass.

**Defence materials added:** PVC fabric, PU fabric, sandwich panel, insulated panel, steel sheet, soil berm, tent-fabric roof, sandwich roof, steel roof, aerogel.

**Consistency.** The inspector prints the layer stack from the *resolved* assembly, and a test asserts the printed thickness and areal mass match the stack exactly.

## 10. Ventilation + Infiltration Model

**File:** `thermal/ventilation.ts`.

**The separation.** The model does **not** treat air exchange as one number. It separates:
- **A. Intentional ventilation** — the designed purge rate.
- **B. Uncontrolled infiltration** — leakage through seams, doors and fabric.

**Infiltration classes:** low (sealed panel), medium (well-made fabric), high (seams/door/fabric leakage), measured (user figure), custom. Each maps to an ACH table; a test asserts the classes map to *ordered* ACH.

**Why it matters.** They are fixed by completely different actions — seal the seams, or change the control. Lumping them together hides which one to spend on. The heat-loss breakdown therefore reports infiltration as its own line.

## 11. Moisture + Condensation Model

**File:** `thermal/moisture.ts` → `computeMoisture(...)`.

**The balance.**

```
M · dW/dt = G_occupants + G_equipment + ṁ·(W_out − W_in) − G_condensation
```

solved at steady state for the indoor humidity ratio:

```
W_in = W_out + G / ṁ
```

**Outputs:** indoor RH, humidity ratio, dew point, wet bulb, moisture generation, moisture removed by ventilation, condensation rate, and **per-surface** condensation status.

**Per-surface rule.** If `surface_temperature < dew_point` the surface is marked condensing. Risk is banded **low / medium / high**.

**The failure mode it catches.** A sealed shelter with a high latent load drives its own humidity up — which is exactly what "just seal it and insulate it" walks into. A test asserts a sealed shelter holds more moisture than a ventilated one.

**A real bug fixed here.** The band was computed from the *unrounded* margin while every legend prints the margin rounded to one decimal, so a surface 0.04 K below the dew point displayed "0.0 K" while being labelled **high** risk. The band now reads from the rounded margin, making the invariant exact: `risk === 'high'` **if and only if** the displayed margin is negative. Both directions are asserted.

## 12. Heat Loss + Heat Gain Model

**File:** `thermal/heatLoss.ts` → `computeHeatLossBreakdown(profile, parameters, geometry)`.

**Seven explicit paths:** walls, roof, floor, windows, doors, ventilation (intentional), infiltration (leakage).

**Outputs:** signed kWh/day per path, loss magnitude, **share of total loss (%)**, total loss, total gain, and the worst path.

**Design rules.** Shares sum to 100 %. Infiltration is a separate line. Nothing is recomputed — the figures are the heat balance's own numbers re-expressed as percentages, so the panel cannot disagree with the charts.

## 13. Internal Loads Model

**File:** `lib/internalLoads.ts`.

**Occupants.** Activity in met, converted to sensible/latent split via `sensibleFraction(activityMet)`. Levels: resting, standing, walking, physical work.

**Equipment library.** Radio (HF), comms terminal, server rack, computer, battery charger, medical monitor, lighting, heater auxiliary. Each item has sensible W, latent W where applicable, and a duty schedule.

**Output.** `computeInternalLoads(occupants, activityMet, equipment[], floorArea)` → total sensible, total latent, total, and W/m² density. The UI shows **TOTAL INTERNAL HEAT LOAD = X kW**.

**Mission coupling.** Applying a mission sets the equipment list and occupancy. A test asserts a communication shelter's load (1.59 kW) exceeds a personnel shelter's (0.48 kW), and that a storage shelter has no occupant load.

## 14. HVAC / Energy Model

**Files:** `thermal/hvac.ts`, `optimization/costModel.ts`.

**Plant types (9):** none, electric heater, diesel/field heater, heat pump, air conditioner, fan, evaporative cooler, radiant heater, solar thermal. Each carries a seasonal efficiency pair, whether it can cool, heat or both, and a plain-language note.

**Power sources (6):** grid, diesel generator, battery, solar PV, solar thermal, hybrid.

**Outputs:** heating energy, cooling energy, electricity, fuel, peak load, daily / monthly / annual requirement, CO₂.

**Two properties worth noting.**
1. **Unmet load is reported.** A diesel heater cannot cool a Jodhpur afternoon; its cooling load is reported as *unmet* rather than as delivered energy.
2. **A real bug was found and fixed here.** The heat balance had always divided loads by `coolingCop`/`heatingEfficiency`, but nothing connected the user's `hvacType` to those numbers — so "diesel heater" and "heat pump" produced identical energy. Found by a test asserting the three strategies must not come out identical. `thermal/hvac.ts` now wires the plant to the physics.

## 15. Comfort / Heat Stress / Cold Stress Model

**Files:** `thermal/pmv.ts`, `thermal/stress.ts`.

**Kept strictly separate:**

| Family | Metric | Standard |
|---|---|---|
| Comfort | PMV / PPD | ISO 7730 |
| Comfort | Adaptive comfort | ASHRAE 55 |
| Heat stress | **WBGT** = 0.7·T_nwb + 0.3·T_globe | ISO 7243 bands |
| Cold stress | Cold-stress indicator, **required clothing insulation (clo)**, heating demand | IREQ-style linear |

**Why separate.** Comfort metrics describe a space people find acceptable; stress metrics describe a space that is dangerous. A test asserts WBGT rises with humidity at fixed temperature, that a hot-humid condition reads extreme, and that Leh reads comfort-bound rather than heat-bound.

## 16. Passive / Active / Hybrid System

**File:** `lib/strategies.ts`.

**What it does.** Prices three comfort-delivery strategies on **one shared envelope**, so the plant is the only variable:
- **Passive** — no plant; the envelope does all the work.
- **Hybrid** — deliberately undersized plant (0.6 × peak plus margin) leaning on the envelope, and it says so.
- **Active** — plant sized to the peak.

**Compared on:** comfort hours, temperature, energy, HVAC load, cost, shelter mass.

**Verified example.** Insulated cabin at Leh: passive **0**, hybrid **659**, active **2 139 kWh/yr** — hybrid recommended, 69 % less than full active.

**Two honesty properties.** The passive row reports its **2 231 kWh/yr of unmet load** rather than pretending it is free. The ranking only recommends a strategy that reaches usable comfort, and among those the lowest delivered energy wins — so a passive shelter that cannot hold comfort is never "recommended" merely because it burns nothing.

## 17. Optimization Engine

**Files:** `optimization/optimizer.ts`, `designSpace.ts`, `objective.ts`, `comparison.ts`.

**Method.** Coordinate descent over `SEARCH_AXES`, with fixed-reference normalisation so objectives are comparable.

**Objective (minimised):** comfort penalty + energy + cost + **mass** + **deployment complexity**.

**Seeding.** The requirement engine's output is applied as the starting point, so the search begins from a physically justified design rather than a blind grid.

**Leaderboard.** The optimiser never returns one unexplained "best". It returns ranked alternatives: **lowest energy, lowest cost, lowest mass, highest comfort, fastest deployment, balanced**.

**Performance.** Benchmarked — the dashboard suite reports ~280–390 ms per site for 39–52 candidates.

## 18. Recommendation / Explainability Engine

**Files:** `optimization/recommendations.ts`, `climate/requirementEngine.ts`.

**Rule: no unsupported AI explanations.** Every recommendation is generated from a computed delta, and shows three things:

- **WHAT CHANGED** — e.g. insulation 20 mm → 40 mm
- **WHY** — the physical reason, tied to a fingerprint index
- **MEASURED EFFECT** — the actual re-simulated deltas (temperature, heating, mass, cost)

**The requirement engine** (`deriveRequirements({fingerprint, analysis, climate, template, base, missionId})`) produces insulation level and thickness, wall/roof assembly, reflective layer, shading, orientation, WWR, ventilation rate, infiltration class, HVAC type and capacity, and moisture control — **each with a `reason` string**. `applyRequirements()` writes the result back through `fitToTemplate`, so an applied design can never leave the shelter's own palette. A test asserts every requirement carries a reason.

## 19. 3D Visualization / Digital Twin System

**Files:** `components/3d/ShelterCanvas.tsx`, `ShelterModel.tsx`, `palette.ts`, `SceneRig.tsx`, `overlays.tsx`, `environment.tsx`.

**Sixteen modes (verified).** Each is a distinct quantity or a distinct way of reading the geometry — none is a relabelled version of another:

| # | Mode | What it shows |
|---|---|---|
| 1 | Normal | Materials and envelope as specified |
| 2 | Heat map | **Absorbed solar radiation** per surface |
| 3 | Temp | **Estimated surface temperature** (°C) |
| 4 | Flux | Signed conduction, W/m², positive in |
| 5 | Loss | Outward loss only, W/m², one-way, with the loss-path breakdown |
| 6 | Humidity | Margin to the indoor dew point (K), continuous |
| 7 | Condense | The same balance, **banded** low/medium/high |
| 8 | Exploded | Envelope pulled apart along each outward normal |
| 9 | Section | Clipping plane on the building's own axis |
| 10 | Air flow | Prevailing wind, cross-ventilation, openings |
| 11 | Solar path | Sun path for the month with the hour marker |
| 12 | Floor plan | Dimensioned plan, wall poché, north arrow |
| 13 | Front | Front elevation |
| 14 | Side | Side elevation |
| 15 | Top | Roof plan |
| 16 | Walkthrough | First-person, WASD, clamped to the interior |

**The deliberate separation.** The **solar-absorption heat map** and the **surface-temperature map** are two different modes with different ramps, legends and footnotes. They are never merged or relabelled. Six data maps now exist (heat map, temp, flux, loss, humidity, condense), each with its own colour scale:
- `THERMAL_RAMP` — six-stop, cool → hot (surface temperature)
- `SOLAR_RAMP` — warm ink → bright (solar absorption)
- `FLUX_RAMP` — **diverging**, neutral centre (signed flux)
- `MOISTURE_RAMP` — **diverging**, same neutral centre (dew-point margin)
- `LOSS_RAMP` — **one-way**, starts at that same neutral, verified to darken monotonically
- `CONDENSATION_RAMP` — **exactly three stops**, because it carries a verdict, not a field

**The shared-neutral rule.** Both diverging ramps share an identical centre stop, so "no signal" looks the same on both. The loss ramp starts at that same neutral, so "nothing escaping here" reads as nothing. Tests assert all three properties.

**Exports.** PNG screenshot and binary glTF (GLB) of the building, plus a print-ready report.

## 20. Surface Inspector System

**File:** `components/dashboard/SurfaceInspector.tsx`.

**What it does.** Click any wall or the roof and the panel reports, for that surface only: its real build-up (layer stack outside → inside, with thickness, λ and density per layer, plus total thickness and areal mass), area, U-value, incident irradiance, sol-air temperature, estimated surface temperature, signed heat flux, and its margin to the dew point.

**Persistence.** The selection lives in the store, so it survives a mode change — select a wall in Normal view, switch to Temp, and the same surface stays selected.

**Honesty.** The floor is inspectable from the list but is not a panel in the model, so it is never given a fake highlight. It is ground-coupled with zero irradiance, and a test asserts exactly that.

## 21. Reporting System

**File:** `lib/report.ts` → `buildDefenceSections(data)`.

**The report contains:** location, climate source, climate fingerprint, mission, shelter type, geometry, envelope layers, materials, insulation, ventilation, infiltration, HVAC, internal loads, temperature results, solar gain, heat flow, humidity, PMV/PPD, WBGT, cold stress, condensation, energy, mass, cost, deployment metrics, optimised alternatives, the final recommended configuration, the reasons, the assumptions, **model fidelity**, and **validation status**.

**Sections emitted:** Fingerprint · Mission / Internal Load · Requirements (+ reasons) · Moisture · Surface Condensation · Stress · Heat Loss · Air Exchange · Deployability · Services · Model Fidelity.

## 22. Uncertainty System

**File:** `lib/uncertainty.ts` → `runUncertainty(inputs)`.

**⚠ Correction to the brief.** This is listed as roadmap, but it **is implemented**. Verified: the module exists (15.4 kB), is exported, surfaced on Method & Limits, and covered by tests.

**What it does.** Perturbs six documented inputs within documented ranges and **re-runs the real thermal engine** for each sample, reporting a distribution per output plus which input drives the spread.

**Method.** Stratified sampling per input (a simple Latin hypercube). The generator is **seeded**, so the same design always yields the same band — verified by a test asserting exact reproducibility and that a different seed differs.

**Physically interpretable results (verified):** on the insulated cabin, energy intensity is dominated by **heating efficiency at Leh** (heating-dominated) and by **cooling efficiency at Jodhpur** (cooling-dominated) — and a test asserts the two sites *disagree* about what matters most.

**Stated limitation.** The index is a **first-order rank correlation that ignores interactions between inputs**. It is not a Sobol decomposition and not a probabilistic risk model. The Method page says so explicitly.

## 23. Validation System

**File:** `lib/validation.ts`.

**⚠ Correction to the brief.** The *status* system is implemented; the *validation runs* are not.

**What exists.** A table of **21 quantities** the platform reports, each with what computes it, what it is checked against, and one of four statuses:

| Status | Count | What it licenses a reader to believe |
|---|---|---|
| Reference-checked | 5 | Compared against a published standard or closed-form solution (ISO 7730 PMV, the periodic-response analytic solution, the NOAA solar algorithm, the Erbs correlation, the stored climatology) |
| Consistency-checked | 6 | Checked by the project's own suites for internal consistency and plausibility. Catches implementation error, not model error |
| Declared estimate | 8 | A documented engineering estimate with no external check |
| Not yet validated | 2 | A validation route exists and is planned but has not been run: a whole-building simulation comparison, and a measured instrumented shelter |

**There is deliberately no "validated" status.** Nothing has been checked against measured shelter data, and a test asserts no status claims otherwise.

**Why a table rather than prose.** Adding a quantity without deciding its status becomes a visible omission. A test asserts that no row claiming only "declared" may cite a standard as its check unless it marks it as approximated.

## 24. ML Surrogate System

**Files:** `ml/features.ts`, `ml/surrogate.ts`, `scripts/train-surrogate.ts`, `scripts/export-dataset.ts`.

**The architecture, preserved:** PHYSICS → DATASET → ML SCREENING → **PHYSICS RE-SIMULATION**.

**What the surrogate does.** It ranks candidate designs cheaply so the optimiser can explore more of the space.

**What it never does.** It never produces a reported number. Every candidate it proposes is re-simulated with the real engine before any figure reaches the user. The backend's `/api/optimize` is documented as a *surrogate screen* returning predicted metrics, **not** a `ThermalComfort`.

**Gating.** The surrogate is accepted only if it clears thresholds on Spearman ρ and MAE against held-out physics results.

## 25. Data Flow (end-to-end)

1. **Location selected** → geocode → `resolveClimate` → `ClimateData` + source provenance.
2. **Fingerprint** → `computeClimateFingerprint` → 8 indices + primary/secondary challenge.
3. **Mission selected** → `applyMissionProfile` → occupancy, activity, setpoints, humidity floor, equipment list.
4. **Shelter selected** → `applyBuildingType` → palette, defaults, massing constraints.
5. **Requirements derived** → `deriveRequirements` → full thermal design with reasons.
6. **Seeded** → `applyRequirements` → optimiser starting point.
7. **Materials resolved** → `resolveMaterials` → layered assemblies, U/R/mass.
8. **Geometry built** → `buildShelterGeometry` → the one geometry.
9. **Physics** → `evaluateDesign` → thermal result.
10. **Derived** → heat loss, moisture, stress, ventilation control, HVAC, strategies, deployment, uncertainty.
11. **Optimise** → seeded search → leaderboard.
12. **Visualise** → 16 3D modes, charts, inspector.
13. **Report** → `buildDefenceSections` → print-ready document.

## 26. State Management

**File:** `store/designStore.ts`.

**Holds:** `currentParameters`, `currentClimate`, `currentThermal`, `optimizerResult`, `comparison`, `recommendations`, `mode`, `visualizationMode`, `cameraPreset`, `hourOfDay`, `analysisMonth`, `analysisDay`, `selectedSurface`, layer toggles, render quality.

**Actions:** parameter updates, `setMode` (auto/manual), `setSelectedSurface`, climate generation, optimise, adopt-recommendation.

**Verified behaviours.** A manual edit re-derives thermal and rebuilds geometry but does **not** re-fetch climate, and keeps the optimiser result as the reference. Changing site clears stale results and resets the pipeline to idle.

## 27. Simulation Pipeline

**Files:** `optimization/pipeline.ts`, `lib/parameters.ts`.

**Two entry points:**
- `evaluateDesign(...)` — the full path: resolve climate → build materials → build geometry → simulate → derive → optionally optimise.
- `reevaluateManual(...)` — the fast path for a parameter tweak: rebuild geometry → re-simulate → rebuild comparison. No climate fetch.

**Performance discipline.** Expensive work is memoised per input set. The interactive maps use the fast physics engine, never a high-fidelity run. Sliders are debounced. Each 3D data map computes only when its mode is active — `computeSurfaceHeat` is not called in Normal view.

## 28. Dashboard System

**Layout.** Top: location, mission, shelter, simulation status, Run. Left: design parameters. Centre: the 3D digital twin. Right: thermal metrics. Bottom: 24-hour and seasonal graphs.

**Metrics surfaced:** indoor temperature, RH, PMV, PPD, WBGT, cold stress, condensation, heating load, cooling load, energy, heat loss, mass, deployment time.

**Principle.** The 3D twin is the visual centre; every number beside it comes from the same store the twin is rendered from.

## 29. Scenario / Comparison System

**File:** `app/(app)/dashboard/scenarios/page.tsx` (Climate Response Lab).

**Capability.** Same shelter → multiple Indian locations, and location + defence-type sweeps. For each site it shows the climate fingerprint, the optimised shelter, insulation, ventilation, HVAC, comfort, energy and weight.

**Purpose.** To visually prove that the design changes with the area — the core claim of the problem statement.

**Verified demo sweep:** Pune 49/100 comfort 67 % EUI 22.8 · Leh 19/100 comfort 33 % EUI 62.2 · Jodhpur 30/100 comfort 28 % EUI 25.0 · Chennai 24/100 comfort 26 % EUI 35.9 · Shillong 66/100 comfort 96 % EUI 8.3 kWh/m²·yr.

## 30. Testing System

**Seven suites, chained by `npm run verify` (typecheck + all six):**

| Suite | Result |
|---|---|
| typecheck | clean |
| verify-climate | 26 passed, 0 failed |
| verify-model | all pass (periodic response, PMV reference, climate classification) |
| verify-geometry | all pass |
| verify-ps51 | 52 checks passed |
| verify-defence | **368 assertions, 19 groups, all pass** |
| verify-dashboard | 75 passed, 0 failed |

**What the defence suite covers:** shelter library (14 types, 9 defence, distinct thermal profiles), mission profiles, internal loads, climate fingerprint, surface temperature, ventilation/infiltration split, regression (civil types intact), moisture, condensation, heat loss, stress, deployment, requirement engine, ventilation control, 3D modes and colour scales, surface inspector, passive/hybrid/active, HVAC plant, uncertainty and validation.

**Bugs found by these tests and fixed (7 total):** packing-factor keying; a physically wrong roof/floor assertion; a wrong infiltration-sign assertion; a legend/model temperature mismatch; **the HVAC type never being wired to the physics**; a moisture-limited hour reported as satisfied; **the condensation band disagreeing with the printed margin**.

## 31. Deployment Architecture

**Configs present:** `vercel.json`, `render.yaml`, `RENDER_DEPLOYMENT.md`, `DEPLOYMENT_INSTRUCTIONS.md`, `SETUP.md`.

**Build:** `npm run build` → **17/17 static pages**, all routes present, type checking passes.

**Standalone operation.** The app runs with no backend. The FastAPI service is optional and only enriches climate resolution.

**Known build quirk.** Next.js cleans its own `.next` directory, which this sandbox's bulk-delete guard blocks. Clearing `.next`/`out` before a build resolves it. This is a sandbox interaction, not a code fault.

---

# LEVEL 4 — CRITICAL ANALYSIS

## 32. What Is Actually Implemented vs Not Implemented

### Implemented and verified

| Capability | Evidence |
|---|---|
| Climate resolution (5-tier chain) | `climate/climateService.ts`, 26 climate tests |
| Climate fingerprint (8 indices) | `climate/fingerprint.ts`, tested across 3 sites |
| Defence shelter library (9 types) | `lib/buildingTypes.ts`, distinct-profile test |
| Mission profiles (8) | `lib/missions.ts`, tested |
| Requirement engine with reasons | `climate/requirementEngine.ts`, tested |
| Layered envelope assemblies | `thermal/assemblies.ts`, 7 defence assemblies |
| Quasi-steady monthly thermal engine | `thermal/thermalModel.ts` |
| Surface temperature + condensation flag | `thermal/surfaceTemperature.ts` |
| Moisture balance + condensation bands | `thermal/moisture.ts` |
| **Interstitial condensation (Glaser check)** | `thermal/interstitial.ts` — layer-by-layer vapour profile against saturation, per-build-up |
| Heat-loss breakdown (7 paths) | `thermal/heatLoss.ts`, shares sum to 100 % |
| Ventilation / infiltration separation | `thermal/ventilation.ts` |
| Hour-by-hour ventilation controller | `thermal/ventilationControl.ts` |
| HVAC plant model (9 types) | `thermal/hvac.ts`, wired to the physics |
| WBGT + cold stress | `thermal/stress.ts` |
| Internal load library | `lib/internalLoads.ts` |
| Passive / hybrid / active comparison | `lib/strategies.ts`, 3 distinct results |
| Deployability metrics | `lib/deployment.ts` |
| Optimisation with leaderboard | `optimization/*`, ~300 ms per site |
| 16 3D modes + surface inspector | `components/3d/*`, tested |
| Report with fidelity statement | `lib/report.ts` |
| **Uncertainty / sensitivity band** | `lib/uncertainty.ts`, seeded, tested |
| **Validation status table (21 rows)** | `lib/validation.ts`, tested |
| ML surrogate (screening only) | `ml/*`, gated by ρ + MAE |
| Test suites (7) | `npm run verify` green |

### NOT implemented — stated plainly

| Not implemented | What is missing |
|---|---|
| **Sensor calibration** | No field-sensor ingestion, no bias-correction path |
| **EnergyPlus / CFD / measured validation** | No validation run of any kind has been performed. The two routes are *named* as planned in the validation table and marked "not yet validated" |
| **Full transient hourly dynamic simulation** | The engine is quasi-steady-state monthly with hourly intra-day sampling. No multi-day thermal-mass carry-over |
| **Thermal bridge (ψ) treatment** | Junctions are not modelled; one lumped U-value per assembly |
| **Full spatial thermal field / CFD airflow** | The 3D maps are **surface-averaged**. No room air stratification, no local mean radiant temperature field, no CFD |
| **Part-load HVAC curves** | One seasonal efficiency per plant type. No cycling, defrost, duct loss, or capacity loss at temperature extremes |
| **Hygrothermal simulation** | Interstitial condensation *is* now checked (steady-state Glaser, `thermal/interstitial.ts`), but it is one-dimensional, assumes a straight-line vapour profile, takes no credit for hygroscopic buffering or seasonal drying, and does not redistribute condensate. It is a conservative design check, not a hygrothermal model |
| **Network airflow model** | The achievable ACH is a first-order buoyancy-plus-wind estimate through the operable area with one discharge coefficient |
| **Measured logistics data** | Packing factors and deployment times are engineering estimates from mass and geometry |
| **Arbitrary multi-variable scenario grids** | Location and defence-type sweeps exist; arbitrary N-dimensional grids do not |
| **ML explainability panel** | The surrogate is gated and screened, but there is no per-prediction feature-attribution UI |

## 33. Key Engineering Decisions

**1. One geometry, not two.** The renderer and the physics consume the same `ShelterGeometry`. This is the single most important architectural decision: it makes "the picture disagrees with the numbers" structurally impossible rather than a bug to be caught.

**2. Physics-first, ML-accelerated.** The surrogate ranks; the physics decides. No unvalidated model produces a reported number.

**3. Requirements seed, they do not replace.** The requirement engine proposes a starting point; the simulation still evaluates it. This keeps the physics authoritative while making the search smarter.

**4. Explainability is computed, not generated.** Every reason string is derived from a fingerprint index or a measured delta. No language model writes an explanation.

**5. Honesty is enforced by tests.** The absence of a "validated" status, the separation of infiltration from ventilation, the reporting of unmet load, and the distinction between the six data maps are all pinned by assertions — so they cannot be quietly dropped.

**6. Distinct quantities get distinct colour scales.** Six maps, six ramps, shared neutral semantics. Two quantities never share a scale.

**7. Failure modes are surfaced, not hidden.** The Jodhpur ventilation case reports that ventilation *cannot* hold the humidity ceiling and names dehumidification as the requirement, rather than inventing an air-change rate.

## 34. Current Limitations (consolidated)

| Area | Limitation |
|---|---|
| Model fidelity | Quasi-steady-state monthly. Not a dynamic simulator, not a compliance tool |
| Validation | No EnergyPlus, no CFD, no measured-shelter dataset. Internal consistency only |
| Spatial resolution | Surface-averaged maps; no spatial field |
| Moisture | Both the inner face and the interstitial planes are now checked. Still no hygroscopic storage, no drying-out credit, and no two-dimensional moisture flow |
| HVAC | Single seasonal efficiency; no part-load, no extreme-temperature capacity loss |
| Ventilation | First-order estimate, not a network or CFD solve |
| Deployability | Engineering estimates, not measured logistics |
| Uncertainty | First-order rank correlation; ignores input interactions; ranges are judgements, not fitted distributions |
| Exploded / section views | Fixed visual offsets and a flat mid-plane; not construction details. Labelled as such on screen |
| Scenario lab | Location and type sweeps only |
| Sensor calibration | Absent |

**The honest one-line statement.** This is a transparent, physics-based **design-comparison** platform. It is strong at telling you *which of two designs is better and why*, and at stating where its own numbers come from. It is not yet validated against measured shelter performance, and it does not claim to be.
