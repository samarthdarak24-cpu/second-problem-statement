# PS-51 — Technical Solution Document

**Area-Specific Thermal Comfort Shelter Design & Simulation Platform**

| | |
|---|---|
| **Problem statement** | SIH PS-51 (DRDO) — area-specific thermal comfort shelter design |
| **Primary use case** | Cold-desert high altitude (Ladakh / Leh), with hot-dry, hot-humid and cold-cloudy as comparison climates |
| **Deliverable** | A user-friendly parametric model that tests shelter size, shape, orientation, materials, thermal mass and openings under defined climate conditions, and identifies efficient configurations |
| **Status of numbers in this document** | Model estimates. Not measured building results. |

---

## 1. Problem

Shelters are frequently installed without being designed for the atmospheric
conditions of the place they are installed. Heat is then lost through the
envelope and the openings, and auxiliary energy is spent holding temperatures
that the climate could have held for free.

Ladakh states the problem precisely: the solar resource is strong enough to make
interiors comfortable during the day, but temperatures fall back toward outdoor
conditions after sunset because of losses through materials and openings. The
design variables that follow from that sentence are **solar gain, insulation,
thermal mass, composite construction and opening design**.

The statement asks for a model that can test these variables and identify
efficient configurations. It does **not** ask for a building visualiser. The 3D
view exists to show the engineering result, not to be the result.

### 1.1 The three required outputs

The model must calculate, at minimum:

| # | Output | Statement wording |
|---|---|---|
| 1 | Predicted shelter indoor temperature | from user-defined inputs |
| 2 | Thermal energy generated from solar radiation | — |
| 3 | Heat-flow details | from the temperature difference between ambient and shelter temperature, over a chosen period |

Everything else in this platform is in service of those three numbers. They are
reported first, in a single panel, with the 24-hour curve at its centre.

---

## 2. Objectives

**O1.** Reproduce the three required outputs as transient, hour-by-hour
quantities — because all three are transient. A monthly mean cannot show that
the interior peaks in the afternoon and collapses after sunset, and that
collapse is the engineering problem.

**O2.** Make every output traceable to a physical term. No black boxes, no
score without a decomposition.

**O3.** Make the model **parametric in the variables the statement names**:
size, shape, orientation, materials, thermal mass, openings.

**O3a.** Treat **orientation and window position as two separable decisions.**
Orientation decides where the sun is; the facade-glazing strategy decides where
the window is. The optimiser searches both, so "put the glass on the south wall"
is a recommendation it can actually make and defend.

**O4.** Separate *what is measured*, *what is simulated* and *what is predicted
by a surrogate* — visibly, in the interface, not in a footnote.

**O5.** Search the design space and return an efficient configuration rather
than a single hand-tuned answer.

**O6.** Show the result in 3D **from the geometry the numbers were computed
from**, so the picture cannot drift from the physics.

**O7.** Stay usable in the room it is presented in: no server, no database and
no network connection required for the core path.

---

## 3. System architecture

```
                         USER
                          │
                          ▼
              ┌───────────────────────┐
              │   Next.js / React     │   App Router, TypeScript
              │   Design Studio       │
              │   3D Viewer (R3F)     │
              └───────────┬───────────┘
                          │  one Zustand store — every panel is a projection of it
                          ▼
              ┌───────────────────────┐
              │   Climate Data Layer  │   provider chain: backend → Open-Meteo → offline DB
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │  Climate Analysis     │   Köppen zone → dominant challenge → design strategy
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │  Thermal Simulation   │   hourly heat balance, periodic conduction response
              │  thermal/thermalModel │   ── THE SOURCE OF TRUTH ──
              └───────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  Indoor temp        Solar gain        Heat flow
        └─────────────────┼─────────────────┘
                          ▼
              ┌───────────────────────┐
              │  Material Database    │   k, ρ, c_p, thickness, α, ε, U-value
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │  Optimisation Engine  │   coordinate descent over a curated neighbourhood
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │  ML Surrogate         │   gradient-boosted screen — NEVER the answer
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │  Parametric 3D        │   procedural geometry from the same parameters
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │  Results / Report     │   + Climate Response Lab comparison
              └───────────────────────┘
```

### 3.1 Implementation status

The whole diagram above is implemented and runs in the browser. The optional
FastAPI service is a deployment convenience, not a dependency.

| Layer | Location | Notes |
|---|---|---|
| UI | `app/`, `components/` | Next.js 14 App Router, TypeScript |
| State | `store/designStore.ts` | One store; nothing derived twice |
| Climate | `climate/` | Classification, provider chain, facade irradiance |
| Thermal | `thermal/` | Heat balance, PMV/PPD, materials, the daily profile |
| Optimisation | `optimization/` | Design space, objective, search, cost, comparison |
| Surrogate | `ml/` | Feature encoding and the gated model contract |
| 3D | `components/3d/`, `utils/shelterGeometry.ts` | Procedural, no imported meshes |
| Verification | `scripts/verify-*.ts` | Six suites, run with `npm run verify` |

### 3.2 Three architectural rules

1. **Nothing is derived twice.** The thermal result, the cost estimate and the 3D
   geometry all come out of a single `EvaluatedCandidate`. The 3D view therefore
   cannot show a building the numbers were not computed for.
2. **Geometry is separate from physics.** `utils/shelterGeometry.ts` produces a
   renderer-agnostic `ShelterGeometry` description; the Three.js layer only draws
   it. The physics consumes the same description.
3. **The physics is replaceable.** Everything sits behind `simulateDesign`, so a
   validated engine (EnergyPlus / Radiance via Ladybug) can be substituted
   without touching a single UI component.

---

## 4. Governing equations

### 4.1 The shelter as a heat-balance system

```
C_eff · dT_in/dt  =  Q_solar + Q_internal − Q_envelope − Q_vent
```

| Term | Meaning |
|---|---|
| `T_in` | indoor air temperature, °C |
| `C_eff` | effective thermal capacitance participating in the **daily** cycle, J/K |
| `Q_solar` | useful solar heat transmitted through glazing, W |
| `Q_internal` | occupants + equipment, W |
| `Q_envelope` | conduction through walls, roof and glazing, W |
| `Q_vent` | sensible ventilation and infiltration, W |

Every power is signed **positive into the zone**, so the terms sum and can be
compared without the reader tracking which way each one points.

### 4.2 Conduction, per component

For each opaque surface the driving temperature is the **sol-air temperature**,
not the outdoor air temperature:

```
T_sol-air  =  T_out  +  (α · I) / h_out  −  (ε · ΔR) / h_out

Q_wall  =  Σᵢ UᵢAᵢ · (T_sol-air,i − T_in)
Q_roof  =  U·A   · (T_sol-air   − T_in)
Q_floor =  U_g·A · (T_ground    − T_in)
Q_win   =  U·A   · (T_out       − T_in)
Q_door  =  U·A   · (T_out       − T_in)
Q_vent  =  ṁ·c_p · (T_out       − T_in)
```

Sol-air is used because that is what conduction actually sees — it folds absorbed
solar and long-wave sky loss into one equivalent temperature. Using outdoor air
instead would hide the single largest reason a sunlit Ladakhi wall behaves
differently from a shaded one.

`ΔR = 63 W/m²` for the roof (long-wave loss to a clear sky) and `0` for vertical
walls. `h_out = 20 W/m²K` walls, `22` roof.

**The floor is driven by the ground, not the weather.** Below roughly a metre the
ground holds the site's annual mean temperature all year, so a slab is a steady
**loss** in a cold desert and a steady **gain** in a hot one — the reverse of
every other surface, and the reason earth-sheltered and mass-floor strategies
work in Ladakh. Its conductance uses an effective ground-coupled
`U_g = 0.35 W/m²K`, not the slab's material U (~5 W/m²K for 150 mm concrete):
the soil is itself an insulator, and using the material U would make the floor
dominate the entire balance.

**The door gets its own conductance.** `wall.opaqueArea` excludes the door area
because it is cut out of the panel, so the door has to be added back explicitly
or it becomes a hole in the envelope that conducts nothing. A door is not a hole
— it is a thin, poorly insulated panel sitting in one, and in a small shelter it
is usually the worst thermal element and the easiest for a user to improve.

### 4.3 Thermal mass and the diurnal penetration depth

Only the outer skin of a thick wall follows the daily cycle. The depth is

```
δ  =  sqrt( 2·α / ω ),     α = k / (ρ · c_p),     ω = 2π / 86400
```

| Material | δ (diurnal) |
|---|---|
| Rammed earth (k 0.8, ρ 1900, c_p 880) | **115 mm** |
| Concrete (k 1.4, ρ 2400, c_p 880) | 135 mm |
| Mud roof (k 0.6, ρ 1600, c_p 880) | 105 mm |

A 450 mm earth wall therefore contributes roughly **a quarter** of its mass to
the daily cycle, not all of it. The effective capacitance is built as

```
C_eff  =  Σ_surfaces  A · ρ · c_p · min(L, δ)
```

and the room's daily swing attenuation follows the first-order periodic response

```
τ  =  C_eff / (U·A)_total
swing ratio  =  1 / sqrt( 1 + (2π·τ / 24)² )
```

This correction matters more than any other constant in the model. Using the
full wall thickness inflates `τ` by about 4× and over-damps the room to the point
where the model reports a Ladakhi shelter swinging **0.6 K across a 15 K day** —
which erases the exact mechanism the problem statement is about.

### 4.3a Composite assemblies and phase-change materials

A material library answers "what is EPS?" — conductivity, density, cost. That is
not the question a designer asks. The question is "what does a 230 mm brick wall
*with* a 50 mm EPS layer do?", and the answer is not any single row in the
library: it is the stack, and it is dominated by the layer boundaries.

**Composite build-ups.** Six named assemblies are selectable (four walls, two
roofs). Each is a list of layers, outside → inside, and everything is derived by
walking that list:

```
U        = 1 / ( Σ (Lᵢ / kᵢ) + R_surface )
mass″    = Σ (ρᵢ · Lᵢ)                       kg/m²
C″_diurnal = Σ ρᵢ · min(Lᵢ, δᵢ) · c_p,i      J/m²·K
```

The storage sum is per-layer because each layer has its **own** penetration
depth: a 50 mm insulation layer participates fully while the 300 mm earth behind
it contributes only its outer skin. Averaging them into one pseudo-material would
get both wrong — which is exactly what the single-material path did.

| Assembly | U (W/m²K) | Daily storage (kJ/m²K) | Indoor swing, Leh Jan |
|---|---|---|---|
| Single-material brick | 0.519 | 174.6 | 1.58 K |
| Brick + cavity + EPS | 0.296 | 183.7 | 1.56 K |
| Rammed earth + external insulation | **0.250** | **220.5** | **1.50 K** |
| Brick + PCM + insulation | 0.290 | **802.6** | **0.89 K** |

**Phase-change materials.** A PCM stores heat at nearly constant temperature
while it melts, so it has no meaningful steady-state U-value at all — it is
defined by its latent heat and its melting point, and it cannot be represented as
an ordinary library entry. It is modelled through the **effective heat capacity
method**: inside the melting band the layer behaves as though its specific heat
were raised by

```
c_p,apparent  =  c_p  +  (L / (2·band)) · (1 − |T − T_melt| / band)
```

A triangular weighting rather than a step, because a step makes the stored energy
discontinuous in temperature and stalls the swing model.

The "outside the band" branch is the whole point:

```
25 mm PCM board, melting point 24 °C, band ±3 K
  sensible specific heat          2 000 J/kg·K
  apparent at 24.0 °C (in band)  32 000 J/kg·K    ← 16× boosted
  apparent at  5.6 °C (outside)   2 000 J/kg·K    ← no boost at all
```

**If the space never reaches the melting point, the latent store never charges
and the PCM is dead weight.** The model reproduces that honestly rather than
assuming a benefit — which is why the melting point is a parameter, and why the
same assembly helps in Pune (annual mean 24.5 °C) and does not in Leh (5.6 °C).
This is the behaviour the problem statement warns about, and the model does not
flatter it.

### 4.4 Opaque conduction: decrement factor and time lag

Opaque conduction is passed through the construction's periodic response rather
than a bare `U·ΔT`:

```
T_eff(t)  =  T̄  +  DF · ( T(t − lag) − T̄ )
```

A 160 mm concrete roof has `DF ≈ 0.35` and `lag ≈ 4 h`, so its peak heat flow is
about a third of what `U·ΔT` alone suggests and arrives in the late afternoon. A
metal sheet has `DF ≈ 1.0` and no lag. Without this, every lightweight building
looks identical to a heavyweight one and peak loads are overstated.

### 4.5 Solar gain

```
Q_solar  =  Σ_facades  [ (I_b · cos θ · f_shade) + I_d,wall · f_diff ] · A_glazing · SHGC
```

with direct and diffuse treated separately, a shading factor derived from the
device geometry and the solar altitude, and beam incidence from the facade
normal. The roof is treated as an area-weighted set of tilted planes, so a
gabled roof collects more winter sun than a flat one and the model can prove it.

### 4.6 The three reported outputs

| Output | Definition |
|---|---|
| Indoor temperature | `T_in(t)` for 24 hours, free-running, after the mass response |
| Solar gain | `Σ_t Q_solar(t) / 1000`, kWh/day, plus peak hour and kWh/m²·day |
| Heat flow | per component — walls, roof, floor, windows, doors, ventilation — `Σ_t Q(t)/1000` kWh/day, with **loss and gain kept apart** |

**Loss and gain are not netted.** A day has both, and a single net number would
report a tight shelter and a leaky one as identical whenever the flows cancelled
— which over a full day in a swing climate they very nearly do. The floor in
particular reports a *gain* in a cold climate and a *loss* in a hot one, and
netting it into a single "envelope" figure would hide that reversal.

---

## 5. Datasets and climate pipeline

```
Location  →  lat / lon / elevation
          →  provider chain:
                1. FastAPI service (optional, if configured)
                2. Open-Meteo archive API (ERA5 reanalysis, hourly, no key)
                3. Bundled offline climatology database (deterministic)
          →  monthly normals: T_mean, T_min, T_max, RH, wind, solar radiation
          →  derived: HDD/CDD, diurnal swing, peak months, design conditions
```

| Source | Role | Licence / terms |
|---|---|---|
| Open-Meteo (ERA5) | Live reanalysis, monthly normals aggregated from the daily archive | Free for non-commercial use, no key |
| Bundled station database | Offline fallback; makes the tool deterministic and network-free | Shipped with the app |
| NOAA Solar Calculator algorithm | Sun position — declination, equation of time, altitude, azimuth | Algorithm, reimplemented |

The same solar direction drives both the on-screen shadows and the thermal
model's solar gain, so the picture and the physics cannot disagree. The interface
labels which provider answered and records every provider that failed on the way.

**Determinism note.** The location sweep in the Climate Response Lab deliberately
uses the offline database, because a comparison whose baseline moves is not a
comparison. The Design Studio uses whichever source answers.

### 5.1 Data model

```
CLIMATE (per station, monthly)
  location, latitude, longitude, elevation
  month, tempMean, tempMin, tempMax, humidity, windSpeed, windDirection,
  solarRadiation, rainfall
  derived: hdd, cdd, diurnalSwing, peakCoolingMonth, peakHeatingMonth

MATERIALS
  id, name, category
  thermalConductivity (k)   W/m·K
  density (ρ)               kg/m³
  specificHeat (c_p)        J/kg·K
  thickness                 m
  uValue                    W/m²·K
  solarAbsorptance (α), emissivity (ε)
  shgc, vlt                 windows only
  airPermeability, embodiedCarbon
  cost                      ₹/m²

SHELTER (BuildingParameters — the single source of truth)
  buildingType, floors
  width, length, height, wallThickness
  numOccupants, numRooms, budget
  orientation, facadeWeights
  windowToWallRatio, wallMaterialId, roofMaterialId, windowMaterialId
  insulationLevel, insulationThickness
  roofType, roofAngle, roofOverhang
  shadingType, shadingDepth
  ventilationType, airChangesPerHour
  coolingSetpoint, heatingSetpoint, coolingCop, heatingEfficiency, solarPvKwp

SIMULATION (per hour, per evaluated design)
  hour, outdoorTemp, indoorTemp
  solarGainW, internalGainW
  wallW, roofW, windowW, ventilationW, netW
  → aggregated to DailyThermalProfile (min/max/swing/damping, kWh/day per term)
```

---

## 6. Algorithms

### 6.1 Simulation (`thermal/thermalModel.ts`)

For each month, a representative day is solved hour by hour in two passes.

**Pass 1 — forcing.** Build the 24-hour series: outdoor dry-bulb from the month's
min/max sinusoid peaking at 15:00; solar position; clear-sky irradiance scaled by
a clearness index derived from the month's daily irradiation; glazing gain per
facade with shading; sol-air temperature for every opaque surface; roof planes.

**Pass 2 — balance.** For each hour:

1. Apply the periodic response to the opaque driving temperatures.
2. Solve the steady balance at infiltration-only flow → `T_closed`.
3. Decide purge ventilation: open the openings only if the space is above the
   comfort band **and** the outside air is genuinely cooler. A model that leaves
   the openings open all winter ventilates a Ladakhi shelter at 5 ACH in January,
   which no occupant would do.
4. Compute the load to hold each setpoint, gated on occupancy and on the
   conditioned fraction of the plan.
5. Accumulate the heat-balance diagnostics against the **free-running** flow.

After the loop, the daily swing is damped by the periodic response (§4.3), and
the design-critical day is selected: **heating-dominated years are judged on
their coldest month, cooling-dominated on their hottest.** This is a result of
the simulation, not a user setting.

### 6.2 Climate classification and strategy (`climate/climateAnalysis.ts`)

Köppen classification → one of eight zones → dominant thermal challenge →
recommended ventilation strategy, insulation level, shading strategy, window
ratio and orientation. This is the *seed* the optimiser starts from, not the
answer.

### 6.3 Multi-objective optimisation (`optimization/`)

Coordinate descent over a **curated neighbourhood** rather than a blind grid:

```
minimise   w₁·D_discomfort  +  w₂·E_energy  +  w₃·C_cost
subject to  geometry, material palette, budget, occupancy constraints
```

- Each term is normalised against a **fixed reference range**, not against the
  candidate set. Min/max normalisation would mean that finding one excellent
  candidate silently makes every other design look worse, which destroys the
  leaderboard and makes the weights impossible to reason about.
- Discomfort has two components — annual hours outside the adaptive band, and
  the severity of the worst season — because a design can fail in either
  direction and averaging them would hide it.
- The search is confined to the building type's **material palette**. A
  prefabricated panel shelter must not be "optimised" into rammed earth.
- `Cost ↔ Comfort` is exposed as a single user-facing priority that reweights
  the objective.
- The optimiser returns a **leaderboard**, not just a winner: cheapest, lowest
  energy, best comfort. The Scenario Comparison uses those real evaluated
  candidates rather than inventing a low-cost design with a second objective.

### 6.4 Scenario sweeps (`lib/scenarios.ts`)

Two axes, both running the *real* pipeline five times:

- **Same site → five building types.** Climate held fixed; every difference is
  caused by the form.
- **Same building → five climates.** Form and programme held fixed; every
  difference is caused by the site.

Nothing on that page computes a second way. If the studio says a design scores
71, the sweep says 71.

---

## 7. UI screens

| Screen | Purpose |
|---|---|
| **Overview** | Site context → **the three required outputs** → key results → 3D → recommendations |
| **Design Studio** | Programme and envelope on the left, 3D in the middle, results on the right, the 24-hour curve below |
| **Climate Response** | Same site / five forms · same building / five sites, with a full-size 3D model and the parameter diff that explains the change |
| **Climate** | What the site asks of a building, month by month |
| **Thermal Analysis** | Comfort, energy and the monthly heat balance |
| **Optimisation** | Before / after, and what each change was worth |
| **Materials** | The envelope library and the thermal properties behind it |
| **ML Model** | The surrogate, its validation gate and its measured accuracy |
| **Method & Limits** | How the numbers are produced, and what they are not |

### 7.1 The result panel

```
┌──────────────────────────────────────────────────────────────────┐
│  AREA-SPECIFIC SHELTER RESULT                    [heating-critical]│
├────────────────────┬────────────────────┬────────────────────────┤
│ 1. INDOOR TEMP     │ 2. SOLAR THERMAL   │ 3. HEAT FLOW           │
│  3.2 … 4.8 °C      │  14.5 kWh/day      │  28.3 kWh/day leaving  │
│  fabric removes 93%│  0.18 kWh/m²·day   │  ▸ Walls      −8.1     │
│  of a 15 K swing   │  peaks 12:00       │  ▸ Roof       −9.4     │
│                    │  covers 51%        │  ▸ Windows    −6.2     │
│                    │                    │  ▸ Ventilation −4.6    │
├────────────────────┴────────────────────┴────────────────────────┤
│  24-HOUR TEMPERATURE CURVE                                       │
│     ╭─╮                                    indoor (primary)      │
│  ───╯ ╰────                                outdoor               │
│  ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ 0 °C                                          │
├──────────────────────────────────────────────────────────────────┤
│  Model estimate — not a measured building result.                │
│  [ View the 3D design this result describes → ]                  │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 Visual language

Light professional dashboard, compact cards, left sidebar, orange/brown accent,
green status indicators. Data-driven. Every estimate carries its provenance
inline.

---

## 8. 3D parametric workflow

```
Template  →  Parameters  →  Geometry  →  Thermal model  →  Optimiser
                ▲                                              │
                └──────────────── optimised parameters ◄────────┘
                                    │
                                    ▼
                        Parametric 3D regeneration
```

The 3D layer is **procedural**, not an imported mesh, for one reason that
overrides convenience: **a static mesh cannot answer the optimiser.** If the
search recommends a 21 % window-to-wall ratio, a 0.45 m overhang, or a second
storey, then those must change in the mesh. A downloaded `.glb` of a house has
those decisions baked into its vertices.

| Element | Generated by |
|---|---|
| Walls with real holes cut per opening | 2D outline extruded with holes |
| Roofs — flat, shed, gable, hip, vaulted | Sampled height field over the plan |
| Floor slabs, one per storey | Box per `floorSlabs` entry |
| Parapets, partitions, module joints | Extruded frames and boxes |
| Shading — overhang, louvre, blind, fin, verandah | Decomposed into wall-local boxes |
| Wall and roof surface patterns | Procedurally drawn to a cached canvas |
| Site, sky, fog, ground, human-scale figure | Procedural geometry and shaders |

**View modes:** Normal, Heat map, Air flow, Solar, Plan, Front, Side, Top, Walk.

**Sun simulation** is tied to the selected location, date and hour through the
same NOAA solar engine the heat balance uses, so the shadows on screen are the
shadows the physics saw.

**Performance:** lazy-loaded canvas, quality tiers (Low / Med / High) driving
device pixel ratio, shadow-map size and roof tessellation, memoised geometry
keyed on the values that define it, `frameloop="demand"` for non-interactive
thumbnails.

**External assets:** none bundled. Five open-source asset repositories were
audited — including one with no licence file and one whose CC0 grant excludes
its textures — and the decision was to stay procedural. Full audit in
[`assets/ATTRIBUTIONS.md`](../assets/ATTRIBUTIONS.md).

---

## 9. The ML surrogate's role

**The surrogate is not the thermal physics.** The order is:

```
PHYSICS  →  trustworthy simulation  →  dataset  →  ML model  →  fast screen  →  optimisation
```

- Training data is generated **by the physics engine itself**
  (`scripts/export-dataset.ts`), labelled by `simulateDesign`.
- The model predicts indoor temperature, comfort, energy and cooling requirement
  from climate + geometry + materials.
- It **screens candidates** so the search can rank hundreds quickly; every
  shortlisted design is then **re-simulated by the physics engine** before it is
  shown. A surrogate answer never reaches the user as a result.
- The gate is **rank correlation**, not absolute accuracy: the surrogate only
  needs to order candidates correctly to be useful as a screen, and claiming
  point accuracy would be a claim it cannot support.
- When no gated model is present, the panel says so. Absent, never faked.

---

## 10. Validation approach

### 10.1 What is verified automatically

`npm run verify` runs six suites. All pass.

| Suite | What it establishes |
|---|---|
| `verify:climate` | Provider request construction, units, fallback chain |
| `verify:model` | Köppen classification, periodic-response maths, PMV reference checks |
| `verify:geometry` | Meshes are well formed; the model is genuinely parametric; drawn area matches simulated area |
| **`verify:ps51`** | **The three required outputs exist, are finite, and behave as physics requires** |
| `verify:dashboard` | Every site runs the pipeline cleanly end to end |

`verify:ps51` asserts, for each site:

1. All three outputs finite.
2. The fabric damps the outdoor swing — indoor swing < outdoor swing.
3. The swing is **not degenerate** (> 0.5 K) — a curve with no shape is not a
   thermal response.
4. Solar gain is positive during daylight hours.
5. Heat loss is positive and attributed per component.
6. Loss and gain partition the gross flow exactly.
7. The indoor profile has a real shape (peak in the afternoon, trough before dawn).
8. The hourly series is complete.
9. The shelter is warmer than the outdoor air on average, at both a cold and a
   warm site.
10. The cold site is judged on its coldest month and the warm site on its hottest.
11. The five building types produce **different** thermal profiles.

### 10.2 Representative model output

Offline climatology, optimised designs, single-family home:

| Site | Critical month | Comfort hours | EUI (kWh/m²·yr) | Score |
|---|---|---|---|---|
| Pune | May (cooling) | 71.5 % | 14.9 | 78 / 100 |
| Leh | January (heating) | 33.4 % | 36.1 | 54 / 100 |

Leh in January: free-running indoor **3.2 – 4.8 °C** against an outdoor swing of
15 K, with the fabric removing 93 % of it, 14.5 kWh/day of solar gain covering
51 % of a 28.3 kWh/day loss. The shelter holds roughly **12 K above outdoor air**
on the strength of the sun and its mass alone — which is the mechanism the
statement describes.

Thermal-mass differentiation across the five forms, same site (Leh):

| Building type | Indoor swing | Damping | Loss (kWh/day) |
|---|---|---|---|
| Rural / vernacular (earth, 450 mm) | 1.1 K | **93 %** | 24.3 |
| Compact / row house | 0.9 K | 94 % | 31.4 |
| Single-family home | 2.0 K | 87 % | 43.4 |
| Low-rise building | 2.4 K | 84 % | 149.9 |
| Modular emergency shelter (panels) | 6.3 K | **58 %** | 19.9 |

The heavyweight shelter rides out the weather; the lightweight panel shelter
tracks it. That contrast is the thermal-mass argument, quantified.

### 10.3 What validation this is *not*

There is **no published measured shelter dataset in the problem statement**, and
this platform does not claim agreement with one. The correct next step is
described in §12.

---

## 11. Innovation

1. **The three required outputs lead the interface.** They are reported as
   transient quantities with the 24-hour curve at the centre, not buried under a
   composite score the optimiser invented to rank its own candidates.
2. **The critical month is a simulation result.** A shelter whose annual heating
   demand dominates is judged on its coldest month; the reverse for cooling. The
   model decides, and says which.
3. **Loss and gain are never netted.** The heat-flow breakdown keeps them apart,
   so a design cannot hide a large exchange behind a small net.
4. **Sol-air driving temperatures, per surface.** The model knows a sunlit
   Ladakhi wall is not at outdoor air temperature.
5. **Diurnal penetration depth for thermal mass.** The mass that participates in
   the daily cycle is computed from material properties, not labelled "high".
6. **Climate Response Lab.** Same site → five forms; same building → five sites,
   each drawn at size from its own geometry, with the parameter diff that
   explains the change.
7. **The 3D cannot lie about the physics.** One geometry description feeds both.
8. **Provenance is structural.** Every result carries its `modelType` tag;
   measured, simulated and predicted values are visually distinct.

---

## 12. Demo scenario

**Scenario A — the statement's own case.**

```
Site        Leh, Ladakh       (34.15 °N, 77.58 °E, 3504 m)
Building    Rural / vernacular shelter
Programme   4 occupants, 6 × 4 m, south orientation
```

→ climate analysis (cold desert, BWk) → strategy → optimisation → recommended
design → parametric 3D → **Normal / Heat map / Air flow / Solar** →
indoor temperature, solar gain, heat flow.

**Scenario B — climate response, without changing the building.**

Switch **Pune → Jodhpur** in the Climate Response Lab. The same building type
comes back as a different envelope, and the "site adaptation" list names every
parameter that moved:

```
SITE ADAPTATION, VS PUNE
Roof construction    Reflective cool roof   →  RCC slab with terrace
Insulation           None                   →  Medium
Shading              Overhang + fins 0.45 m →  Overhang 0.45 m
Ventilation          Mixed mode · 6 ACH     →  Night purge · 5 ACH
Window-to-wall       22 %                   →  23 %
```

**Scenario C — thermal mass.**

Run the five building types at Leh. The vernacular damps 93 % of a 15 K outdoor
swing; the modular panel shelter damps 58 %. Same climate, same brief, different
physics.

**Scenario D — the trade-off.**

Move the `Cost ↔ Comfort` slider and re-run the sweep. Every column is a full
coordinate-descent search on its own climate, so the effect of the priority is
visible across all five sites at once.

---

## 13. Roadmap to engineering validation

| Phase | Action | Purpose |
|---|---|---|
| 1 | Replace `simulateDesign` with an **EnergyPlus** model via Ladybug Tools | The interface is already isolated behind one function; no UI change required |
| 2 | Instrument a reference shelter in Leh (or use the GB Pant / Stok Village work) | Establish measured indoor temperature, solar gain and heat flow |
| 3 | Re-fit the model constants against those measurements | Turn a design-comparison model into a predictive one |
| 4 | Add PCM and multi-layer composite assemblies | The statement names composite construction and thermal-mass storage |
| 5 | Add a CSV weather upload path | The statement describes user-defined / collected data |

**Route note.** ANSYS transient thermal is the workflow the statement names, and
this platform's model is structured around the same transient formulation.
EnergyPlus is proposed here only as the open-source implementation for the
software prototype. No claim of ANSYS use is made, and none should be made
unless ANSYS is actually run.

---

## 14. Known limitations

1. **Not a validated dynamic simulation.** Single zone, monthly-mean climate
   driving an hourly representative day. No thermal bridging, no multi-zone
   airflow, no latent storage, no full 3D radiation exchange.
2. **Representative day, not a real date.** The daily profile uses the month's
   mean conditions with its diurnal swing, not the weather of a specific day.
3. **No measured validation.** See §12.
4. **Costs are indicative Indian market rates** — a trade-off tool, not a tender
   price.
5. **The surrogate is a screen, not an answer.** Its output never reaches the
   user as a result.
6. **Diurnal capacitance is a lumped approximation.** It uses the penetration
   depth per surface rather than solving the full multi-layer transient, so
   phase lag within a thick wall is approximated by the decrement-factor method.
7. **Purge ventilation is a rule, not a control model.** Occupants are modelled
   opening up when it helps, not by any predictive control logic.
8. **Window position is searched as a named strategy, not a per-facade
   continuum.** The optimiser chooses between six facade-glazing distributions
   (balanced, south-led, south+east, south+west, north-shielded, east+west)
   rather than four continuous weights. A four-dimensional real axis produces
   candidates nobody can describe or build; six named strategies keep every
   recommendation explainable, and the difference is real — at Leh in January a
   south-led distribution collects 28.8 kWh/day against 33.1 for a
   north-shielded one.
9. **Floor is modelled as a single ground-coupled conductance.** Perimeter
   insulation, earth-sheltering and slab-edge detail are not represented.
10. **Phase-change placement is not resolved.** The PCM layer stores latent heat
    through the effective-heat-capacity method evaluated at one lumped room
    temperature. It cannot show the melting front, the conduction path through a
    partly melted slab, or — most importantly — where in the build-up the layer
    sits. The model does reproduce the behaviour that matters for a comparison:
    the latent store only charges inside the melting band, so a 24 °C PCM on a
    site averaging 5.6 °C contributes nothing but its sensible heat.
11. **Composite assemblies are a curated set, not a stack editor.** Six named
    build-ups (four walls, two roofs) are selectable, and the U-value, areal mass
    and daily storage are all derived by walking their layers. A user cannot yet
    compose an arbitrary stack in the UI; adding one means adding an entry to
    `thermal/assemblies.ts`.

---

## 15. Summary

The problem is not "design a beautiful 3D house". It is "build a user-friendly
thermal model that determines how shelter size, shape, orientation, materials,
thermal mass and openings affect indoor temperature, solar thermal gain and heat
flow for a specified climate, then compares designs and identifies an efficient
configuration."

The 3D model visualises the result of that engineering model. The optimiser
searches the space it defines. Neither of them is the source of the thermal
answer — the heat balance is.
