# DRDO Shelter Evolution — Implementation Map

**Project:** Thermal Shelter · SIH PS-51 (DRDO)
**Goal:** evolve the existing climate-responsive *building* designer into a **defence-shelter digital engineering platform** — without rebuilding the architecture or breaking any working feature.

**Current pipeline (preserved):**
`INPUT → CLIMATE → ANALYSIS → THERMAL → OPTIMISATION → PARAMETERS → 3D → RESULTS`

**Target pipeline:**
`LOCATION → CLIMATE FINGERPRINT → MISSION → DEFENCE SHELTER → ENVELOPE → THERMAL + MOISTURE → COMFORT/STRESS → 3D DIGITAL TWIN → MULTI-OBJECTIVE OPTIMISATION → RECOMMENDATION → VALIDATION → REPORT`

---

## 0. The five invariants that must not break

| # | Invariant | Where it lives today |
|---|---|---|
| 1 | **One design state → one geometry → one simulation → one visual** | `store/designStore.ts` produces a single `EvaluatedCandidate`; `utils/shelterGeometry.ts` feeds both the renderer and the physics |
| 2 | **Nothing is derived twice** | `optimization/pipeline.ts` → `evaluateDesign` is the only evaluator |
| 3 | **Sliders do not re-run the pipeline** | `reevaluateManual` re-runs only thermal + cost |
| 4 | **Auto mode owns the envelope; manual hands it back** | `mode` in the store; `ParameterPanel` read-only in auto |
| 5 | **Every result carries its provenance** | `ThermalComfort.provenance`, `ClimateResolution.provider` |

Every change below is **additive**. The existing 5 building types, 9 visualisation modes, 27 materials and 6 assemblies all remain.

---

## 1. Files to REUSE unchanged

| File | Why it is already right |
|---|---|
| `store/designStore.ts` | Single store; the pipeline projection pattern works for any parameter set |
| `optimization/pipeline.ts` | `generateDesign` / `evaluateDesign` / `reevaluateManual` — the one evaluator |
| `optimization/objective.ts` | Weights + fixed-reference normalisation — ready for extra objectives |
| `optimization/optimizer.ts` | Coordinate descent over `SEARCH_AXES` — new axes slot in |
| `thermal/thermalModel.ts` | The heat balance; **the source of truth** |
| `thermal/pmv.ts` | ISO 7730 PMV/PPD + `adaptiveComfortBand` |
| `utils/shelterGeometry.ts` | Renderer-agnostic `ShelterGeometry` — the digital-twin backbone |
| `utils/solar.ts` | NOAA solar engine |
| `utils/psychrometrics.ts` | Humidity / dew-point utilities — the moisture model builds on these |
| `climate/climateService.ts` | Provider chain (backend → Open-Meteo → offline) with provenance |
| `climate/facadeIrradiance.ts` | Per-facade irradiation — reused by the surface-temperature model |
| `thermal/assemblies.ts` | Layer-stack machinery — defence build-ups are just more entries |
| `thermal/surfaceHeat.ts` | Absorbed-solar map — **stays** as its own mode |
| `components/3d/*` | Procedural geometry, `ShelterModel` already accepts an arbitrary per-surface value map + ramp |
| `lib/report.ts` | HTML→print report — new sections are appended |
| `components/ui/*` | `Panel`, `Segmented`, `Chip`, `MetricCard`, `StatCard`, `BarRow`, `Gauge` |

---

## 2. Files to MODIFY (small, additive edits)

| File | Change | Risk |
|---|---|---|
| `types/building.ts` | Extend `BuildingTypeId` union (+9 defence ids); add `MissionProfileId`; add `missionProfile`, `internalLoads`, `infiltrationClass`, `hvacType`, `powerSource`, `deploymentState` to `BuildingParameters`; add `category` to the template type | Low — union is closed, so every `Record` must be extended (compiler enforces) |
| `types/design.ts` | Extend `VisualizationMode` with `temperature`, `heatflux`, `heatloss`, `humidity`, `condensation`, `exploded`, `section` | Low — `MODE_LABEL`/`MODE_NOTE` are `Record`s, so the compiler forces labels |
| `types/thermal.ts` | Add `SurfaceTemperatureMap`, `MoistureResult`, `StressResult`, `HeatLossBreakdown`, `DeploymentMetrics` result types | None — new types |
| `lib/buildingTypes.ts` | Add 9 defence templates; add `category` to each template; keep `BUILDING_TYPE_ORDER` for civil types and add `DEFENCE_TYPE_ORDER` | Low |
| `lib/labels.ts` | Add labels for the new modes, mission profiles, HVAC types, power sources, infiltration classes | Low |
| `lib/parameters.ts` | Add a **Mission** group and a **Services/Deployment** group to `parameterGroups()`; add the new select keys | Low |
| `thermal/materials.ts` | Add defence materials (fabric, foil, aerogel, plywood liner, steel, soil) | None — append-only |
| `thermal/assemblies.ts` | Add defence build-ups (tent, cabin, bunker walls/roofs) | None — append-only |
| `components/3d/ShelterCanvas.tsx` | Route the new modes to `computeSurfaceTemperature` / heat-flux / heat-loss ramps | Medium — must keep the existing heatmap untouched |
| `components/dashboard/ViewportPanel.tsx` | Add the new mode buttons + the temperature legend | Low |
| `components/dashboard/ParameterPanel.tsx` | Render the new groups | Low |
| `components/shell/nav.ts` | Add `/dashboard/fingerprint`, `/dashboard/deployment` | None |
| `lib/report.ts` | Append fingerprint / mission / moisture / stress / deployment / validation sections | Low |

---

## 3. Files to CREATE

### 3.1 Data / domain

| New file | Contents |
|---|---|
| `lib/missions.ts` | `MISSION_PROFILES`: 8 profiles (Personnel Accommodation, Command/Control, Communication, Medical, Equipment, Storage, Observation/Duty Post, Field Operations) → occupancy, activity/met, equipment default set, operating hours, target temp, target RH, ventilation requirement, HVAC requirement, power demand |
| `lib/internalLoads.ts` | Equipment heat-load library (radio, comms, computer, server, battery charger, medical, lighting) with sensible/latent W + schedule; `computeInternalLoads()` → total kW |
| `lib/deployment.ts` | Shelter mass, packed volume, deployed volume, deployment time, personnel required, panel count, transport volume, daily fuel/electrical requirement |

### 3.2 Engines

| New file | Contents |
|---|---|
| `climate/fingerprint.ts` | `computeClimateFingerprint(climate)` → severity indices (winter/summer/humidity/solar/wind/night-cooling), HDD/CDD-derived indicators, extreme-heat/cold flags, **primary + secondary thermal challenge** |
| `climate/requirementEngine.ts` | `deriveRequirements(location, fingerprint, mission, shelterType)` → initial insulation / wall / roof / floor / reflectance / shading / orientation / ventilation / infiltration / HVAC / moisture control. **Seed only** — never replaces the physics |
| `thermal/surfaceTemperature.ts` | `computeSurfaceTemperature(climate, geometry, materials, month, hour, indoorTemp)` → per-surface **surface temperature** (sol-air + `U·ΔT` split), range, hottest/coldest, condensation check vs dew point |
| `thermal/moisture.ts` | Indoor humidity state: `M·dW/dt = G_occ + G_equip + ṁ(W_out − W_in) − G_cond`; RH, humidity ratio, dew point, per-surface condensation risk |
| `thermal/heatLoss.ts` | `computeHeatLossBreakdown(thermal, geometry, materials, params)` → % per component with **infiltration split out from intentional ventilation** |
| `thermal/stress.ts` | `computeWBGT(...)` (heat-stress mode) and `computeColdStress(...)` (IREQ / required clo / heating load) |
| `thermal/stratification.ts` | Reduced-order multi-zone model (roof zone / upper air / occupant zone / lower air / floor) — Phase 3 |

### 3.3 UI

| New page / component | Contents |
|---|---|
| `app/(app)/dashboard/fingerprint/page.tsx` | The Climate Fingerprint page (severity bars, primary/secondary challenge, recommended strategy) |
| `app/(app)/dashboard/deployment/page.tsx` | Deployment / logistics profile + validation status |
| `components/dashboard/FingerprintPanel.tsx` | The fingerprint visual |
| `components/dashboard/MissionPanel.tsx` | Mission profile selector + auto-applied occupancy/equipment/targets |
| `components/dashboard/EnvelopeEditor.tsx` | Layer-by-layer build-up editor (outer skin → air gap → reflective → insulation → liner) |
| `components/dashboard/SurfaceInspector.tsx` | Click a wall → surface ID, build-up, U-value, heat flux, surface temp, condensation status |
| `components/dashboard/HeatLossPanel.tsx` | Heat-loss % breakdown incl. infiltration |
| `components/dashboard/StressPanel.tsx` | WBGT / cold-stress read-outs |
| `components/dashboard/MoisturePanel.tsx` | RH / dew point / condensation risk |
| `components/dashboard/DeploymentPanel.tsx` | Logistics metrics |
| `components/dashboard/RecommendationEnginePanel.tsx` | Location → requirement → recommended configuration + "Why?" |

---

## 4. Data-model changes (exact)

```ts
// types/building.ts
export type BuildingTypeId =
  // existing civil types (unchanged)
  | 'single-family' | 'row-house' | 'low-rise' | 'vernacular' | 'modular-emergency'
  // NEW defence shelter library
  | 'high-altitude-tent' | 'desert-field-tent' | 'warm-humid-shelter'
  | 'modular-insulated-cabin' | 'comm-command-shelter' | 'equipment-shelter'
  | 'medical-field-shelter' | 'modular-prefab-shelter' | 'semi-underground-bunker';

export type ShelterCategory = 'civil' | 'defence';

export type MissionProfileId =
  | 'personnel-accommodation' | 'command-control' | 'communication'
  | 'medical' | 'equipment' | 'storage' | 'observation-post' | 'field-operations';

export type InfiltrationClass = 'low' | 'medium' | 'high' | 'measured';
export type HvacType = 'none' | 'electric-heater' | 'diesel-heater' | 'heat-pump'
  | 'air-conditioner' | 'fan' | 'evaporative-cooler' | 'radiant-heater' | 'solar-thermal';
export type PowerSource = 'grid' | 'diesel-generator' | 'battery' | 'solar-pv'
  | 'solar-thermal' | 'hybrid';
export type DeploymentState = 'packed' | 'deployed';

// appended to BuildingParameters (all optional → no migration of saved designs)
missionProfile?: MissionProfileId;
internalLoads?: { id: string; count: number; watts: number }[];
infiltrationClass?: InfiltrationClass;
infiltrationAch?: number;      // measured leakage, when known
hvacType?: HvacType;
hvacCapacityKw?: number;
powerSource?: PowerSource;
deploymentState?: DeploymentState;
```

---

## 5. Simulation-engine changes

| Engine | Change | Preserves |
|---|---|---|
| `thermal/thermalModel.ts` | Add **surface-temperature** outputs; split `ventilationW` into `intentionalVentW` + `infiltrationW`; accept mission-driven internal loads | All existing terms and the `dailyProfile` shape |
| `thermal/surfaceTemperature.ts` | **New**, independent of the solar-absorption map | `surfaceHeat.ts` untouched |
| `thermal/moisture.ts` | **New** moisture balance | Sensible balance untouched |
| `thermal/stress.ts` | **New** WBGT / cold stress | PMV/PPD untouched |
| `optimization/objective.ts` | Extend `J = w_c·D + w_e·E + w_m·M + w_k·C + w_d·D_deploy` | Existing weights default `w_m = w_d = 0` |
| `optimization/designSpace.ts` | Add `hvac`, `infiltration`, `pcmAmount` axes **only for defence types** | Civil search unchanged |

---

## 6. UI changes

1. **Parameter panel** — two new groups: **Mission** (profile + occupants + equipment) and **Deployment** (infiltration class, HVAC, power source, state).
2. **Viewport** — add mode buttons: Surface temperature, Heat flux, Heat loss, Humidity, Condensation, Exploded, Section. Keep Normal / Heat map / Air flow / Solar / Plan / elevations / Walk.
3. **Dashboard** — add the metrics the brief asks for: indoor RH, dew point, condensation risk, WBGT, cold stress, heating/cooling load, shelter weight, deployment time.
4. **Nav** — add *Climate Fingerprint* (Compare) and *Deployment* (Reference).
5. **Envelope editor** — a layer stack the user can inspect (and, in manual mode, edit).
6. **Surface inspector** — click a wall in 3D → its build-up and live thermal state.

---

## 7. Tests to add

| Test | Asserts |
|---|---|
| `verify:fingerprint` | Every station yields a finite fingerprint; the primary challenge matches the zone family; Leh → cold-dominated, Jodhpur → solar-dominated |
| `verify:mission` | Each mission profile changes occupancy/equipment/targets; a communication shelter has a higher equipment load than a personnel shelter |
| `verify:surfacetemp` | Surface temperature is finite; roof ≥ wall ≥ floor on a sunny day; a surface below dew point is flagged; the solar-absorption map is unchanged |
| `verify:moisture` | RH stays in [0, 100]; dew point ≤ dry-bulb; condensation is flagged exactly when `T_surface < T_dew` |
| `verify:heatloss` | Component shares sum to 100 %; infiltration and intentional ventilation are separate and both non-negative |
| `verify:stress` | WBGT rises with temperature and humidity; cold stress rises as temperature falls |
| `verify:defence` | Each of the 9 defence types produces a **different** thermal profile on the same site; each palette is physically coherent |
| `verify:deployment` | Mass/volume/time are positive and scale with panel count |
| `verify:regression` | The existing `verify:model`, `verify:geometry`, `verify:ps51`, `verify:dashboard` suites still pass |

---

## 8. Priority order (as specified)

**PHASE 1 — MUST HAVE**
1. Defence shelter types ✅ *(implemented)*
2. Mission profile ✅ *(implemented)*
3. Climate fingerprint ✅ *(implemented)*
4. Envelope layer editor — *engine ready (`assemblies.ts`), defence build-ups added; the layer stack is now **inspected** through the surface inspector, and the exploded view separates it visually. Free-form layer editing is still Phase 1b.*
5. Surface-temperature model ✅ *(implemented)*
6. 3D temperature heatmap ✅ *(implemented — separate from the solar-absorption map)*
7. Humidity / condensation ✅ *(implemented — engine + a humidity 3D mode)*
8. Dynamic ventilation ✅ *(implemented — `thermal/ventilationControl.ts`, hour by hour, three control stances)*
9. Heat-loss breakdown ✅ *(implemented)*
10. Defence-oriented dashboard ✅ *(mission + fingerprint + surface-temp + ventilation + strategy surfaces)*

**PHASE 2 — HIGH VALUE** WBGT ✅ · cold stress ✅ · equipment heat library ✅ · energy-source/fuel model ✅ · deployability ✅ · requirement engine ✅ · **HVAC plant model ✅** *(nine types wired into the efficiencies the heat balance divides by)* · **passive/active/hybrid ✅** *(side-by-side, priced on one shared envelope)* · what-if ✅ *(sliders exist via the parameter panel)* · **3D modes ✅** *(heat flux, heat loss, humidity, condensation, exploded, section — sixteen modes total)* · **surface inspector ✅** · India Defence Climate Lab ✅ *(location + defence-type sweeps)*

**PHASE 3 — ADVANCED** **uncertainty / sensitivity ✅** *(seeded first-order band, on the Method page)* · **validation architecture ✅** *(21 quantities, four statuses, no "validated" claim)* · reduced-order spatial model · EnergyPlus · CFD · field calibration · advanced ML · HVAC part-load curves — *the last five not started; declared as limitations, not faked*

---

## 9. What was implemented in this pass

| Item | Status | Files |
|---|---|---|
| **Defence Shelter Library** — 9 types | ✅ Done | `types/building.ts`, `lib/buildingTypes.ts` |
| **Defence materials** (fabric, foil, aerogel, liner, steel, soil) | ✅ Done | `thermal/materials.ts` |
| **Defence composite build-ups** (tent/cabin/bunker walls + roofs) | ✅ Done | `thermal/assemblies.ts` |
| **Mission Profile** (8 profiles) | ✅ Done | `types/building.ts`, `lib/missions.ts`, `lib/parameters.ts`, `store/designStore.ts` |
| **Internal load library** (occupants + equipment) | ✅ Done | `lib/internalLoads.ts` |
| **Climate Fingerprint engine + page** | ✅ Done | `climate/fingerprint.ts`, `app/(app)/dashboard/fingerprint/page.tsx`, `components/shell/nav.ts` |
| **Surface-temperature engine + 3D mode** | ✅ Done | `thermal/surfaceTemperature.ts`, `types/design.ts`, `lib/labels.ts`, `components/3d/ShelterCanvas.tsx`, `components/dashboard/ViewportPanel.tsx` |
| **Humidity / condensation engine** | ✅ Done | `thermal/moisture.ts` |
| **Heat-loss breakdown** (7 paths, infiltration split out) | ✅ Done | `thermal/heatLoss.ts` |
| **WBGT heat stress + cold stress (IREQ-style)** | ✅ Done | `thermal/stress.ts` |
| **Ventilation vs infiltration split, HVAC + power source taxonomy** | ✅ Done | `thermal/ventilation.ts` |
| **Area-specific Requirement Engine** (fingerprint × mission × shelter → requirements, each with a reason) | ✅ Done | `climate/requirementEngine.ts` |
| **Deployability metrics** (mass, packed volume, panel count, deploy time/manpower, daily fuel) | ✅ Done | `lib/deployment.ts` |
| **Design Brief page** (consolidates all of the above + Apply-as-seed) | ✅ Done | `app/(app)/dashboard/brief/page.tsx` |
| **Report sections** (fingerprint, mission, requirements, moisture, stress, heat loss, deployability, fidelity) | ✅ Done | `lib/report.ts` |
| **Dynamic ventilation controller** (3 constraints, hour by hour, 3 control stances) | ✅ Done | `thermal/ventilationControl.ts` |
| **HVAC plant model** (9 types → efficiencies the heat balance reads; unmet load; fuel; CO₂) | ✅ Done | `thermal/hvac.ts`, `climate/requirementEngine.ts` |
| **Passive / hybrid / active comparison** (one shared envelope, plant as the only variable) | ✅ Done | `lib/strategies.ts`, `app/(app)/dashboard/brief/page.tsx` |
| **3D modes: heat flux, heat loss, humidity, condensation, exploded, section** (16 modes total; 2 new diverging ramps, 1 one-way loss ramp, 1 three-stop banded ramp) | ✅ Done | `types/design.ts`, `lib/labels.ts`, `components/3d/palette.ts`, `ShelterModel.tsx`, `ShelterCanvas.tsx`, `ViewportPanel.tsx` |
| **Surface inspector** (click a wall → build-up + live thermal state) | ✅ Done | `components/dashboard/SurfaceInspector.tsx`, `store/designStore.ts` |
| **Uncertainty / sensitivity band** (6 inputs, seeded, first-order index) | ✅ Done | `lib/uncertainty.ts`, `app/(app)/dashboard/method/page.tsx` |
| **Validation architecture** (21 quantities × 4 statuses, no "validated" claim) | ✅ Done | `lib/validation.ts`, `app/(app)/dashboard/method/page.tsx` |
| **Defence verification suite** — 335 assertions | ✅ Done | `scripts/verify-defence.ts`, `package.json` |
| EnergyPlus / CFD comparison, sensor calibration, free-form layer editing, HVAC part-load curves | ⏳ Roadmap (Phase 3) | — |

**Nothing existing was removed.** The 5 civil building types, the solar-absorption heat map, the PMV/PPD path, the optimiser, the ML surrogate, the exports and the verification suites are all intact.

### Verification status at the time of writing

```
npm run verify   →  typecheck clean, climate ✓, model ✓, geometry ✓,
                    ps51 26 ✓, defence 335 ✓, dashboard 75 ✓   (0 failed)
npm run build    →  17/17 static pages generated
```
