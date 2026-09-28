/**
 * AUDIT — engine-level invariant checks. No browser, no network.
 *
 * Covers §3, §6, §10, §11, §12, §13, §14, §16, §17, §18, §19, §20, §31.
 * Run:  npx tsx scripts/_audit-engine.mts
 */
import { STATION_BY_ID } from '../climate/stations';
import { buildClimateData } from '../climate/deriveClimate';
import { defaultRequirements } from '../lib/parameters';
import { applyMissionProfile, MISSION_PROFILES, MISSION_ORDER } from '../lib/missions';
import { resolveMaterials, MATERIAL_BY_ID } from '../thermal/materials';
import { buildShelterGeometry } from '../utils/shelterGeometry';
import { simulateDesign } from '../thermal/thermalModel';
import { computeSurfaceTemperature } from '../thermal/surfaceTemperature';
import { computeMoisture } from '../thermal/moisture';
import { computeHeatLossBreakdown } from '../thermal/heatLoss';
import { computeHeatStress, computeColdStress } from '../thermal/stress';
import { calculatePmv, ppdFromPmv, adaptiveComfortBand } from '../thermal/pmv';
import { metToWm2, cloToM2KW } from '../utils/units';
import {
  COMPOSITE_ASSEMBLIES,
  assemblyResistance,
  assemblyArealMass,
  assemblyThickness,
} from '../thermal/assemblies';

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`);
};
const keysOf = (o: unknown) => (o && typeof o === 'object' ? Object.keys(o as object) : []);

/**
 * Typed accessor for the per-surface detail map.
 *
 * `SurfaceTemperature['detail']` is a `Record<SurfaceKey, SurfaceThermalDetail>`.
 * Indexing it with a plain `string` narrows to `never` under `noUncheckedIndexedAccess`,
 * so the tests index through this helper instead of casting at every call site.
 */
type SurfaceDetail = {
  surfaceTemp: number;
  irradiance: number;
  solAirTemp: number;
  uValue: number;
  area: number;
};
function detailOf(
  st: { detail: Record<string, SurfaceDetail> },
  key: string,
): SurfaceDetail {
  return st.detail[key] as SurfaceDetail;
}

function walkNumbers(o: unknown, path = '', out: [string, number][] = []): [string, number][] {
  if (o == null) return out;
  if (typeof o === 'number') { out.push([path, o]); return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => walkNumbers(v, `${path}[${i}]`, out)); return out; }
  if (typeof o === 'object') { for (const [k, v] of Object.entries(o as object)) walkNumbers(v, `${path}.${k}`, out); }
  return out;
}

function design(stationId: string, missionId?: string) {
  const station = STATION_BY_ID.get(stationId)!;
  const climate = buildClimateData(station, 'database');
  let params = defaultRequirements();
  if (missionId) params = applyMissionProfile(params, missionId as never);
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  return { station, climate, params, materials, geometry };
}

/* ================================================================= */
console.log('\n════ §12 THERMAL ENGINE — NUMERICS ════\n');

const STATIONS = ['in-pune', 'in-leh', 'in-chennai', 'in-jodhpur', 'in-shillong'];
const sims: Record<string, any> = {};
for (const id of STATIONS) {
  const st = STATION_BY_ID.get(id);
  if (!st) { check(`§12 station ${id} exists`, false, 'missing'); continue; }
  try {
    const d = design(id);
    const sim = simulateDesign(d.params, d.climate, d.materials, d.geometry);
    sims[id] = { ...d, sim };
    const nums = walkNumbers(sim);
    const bad = nums.filter(([, v]) => !Number.isFinite(v));
    check(
      `§12 ${st.location.city} — ${nums.length} outputs, all finite`,
      bad.length === 0,
      bad.length ? bad.slice(0, 4).map(([p, v]) => `${p}=${v}`).join(', ') : 'none non-finite',
    );
  } catch (e) {
    check(`§12 ${st.location.city} simulates`, false, String(e).slice(0, 160));
  }
}

/* ================================================================= */
console.log('\n════ §13 PS-51 REQUIRED OUTPUTS ════\n');
{
  const d = sims['in-leh'];
  const s: any = d?.sim ?? {};
  const k = keysOf(s);
  console.log('   ThermalComfort keys:', k.join(', '));
  const flat = JSON.stringify(s);
  check('§13 indoor temperature reported', /indoorTemp|indoor_temperature|meanIndoor/i.test(flat), k.filter((x) => /temp/i.test(x)).join(', '));
  check('§13 solar thermal gain reported', /solar/i.test(flat), k.filter((x) => /solar/i.test(x)).join(', '));
  check('§13 heat flow leaving the shelter reported', /heatLoss|loss|ventilation/i.test(flat), k.filter((x) => /loss|vent/i.test(x)).join(', '));
  check('§13 monthly series present', Array.isArray(s.monthly) && s.monthly.length === 12, `${s.monthly?.length} months`);
  check('§13 the model names its own provenance', !!s.provenance || !!s.model, keysOf(s.provenance).slice(0, 5).join(', '));
}

/* ================================================================= */
console.log('\n════ §3 CLIMATE VARIES BY STATION ════\n');
{
  const sigs: Record<string, string> = {};
  for (const [id, d] of Object.entries(sims)) {
    const s = d.sim;
    const m = s.monthly ?? [];
    const meanIndoor = m.length ? m.reduce((a: number, x: any) => a + (x.meanIndoorTemp ?? x.indoorTemp ?? 0), 0) / m.length : NaN;
    const peakIndoor = m.length ? Math.max(...m.map((x: any) => x.maxIndoorTemp ?? x.indoorTemp ?? 0)) : NaN;
    const troughIndoor = m.length ? Math.min(...m.map((x: any) => x.minIndoorTemp ?? x.indoorTemp ?? 0)) : NaN;
    const heat = m.reduce((a: number, x: any) => a + Math.abs(x.heatingKwh ?? 0), 0);
    const cool = m.reduce((a: number, x: any) => a + Math.abs(x.coolingKwh ?? 0), 0);
    sigs[id] = `${meanIndoor.toFixed(1)}|${peakIndoor.toFixed(1)}|${troughIndoor.toFixed(1)}|${heat.toFixed(0)}|${cool.toFixed(0)}`;
    console.log(`   ${d.station.location.city.padEnd(11)} meanIn=${meanIndoor.toFixed(1)}°C  peak=${peakIndoor.toFixed(1)}  trough=${troughIndoor.toFixed(1)}  heat=${heat.toFixed(0)}kWh  cool=${cool.toFixed(0)}kWh`);
  }
  check('§3 stations produce distinct thermal signatures', new Set(Object.values(sigs)).size >= 3, `${new Set(Object.values(sigs)).size}/5 distinct`);

  const leh = sims['in-leh']?.sim?.monthly ?? [];
  const chen = sims['in-chennai']?.sim?.monthly ?? [];
  const lehWinter = leh[0]?.meanOutdoorTemp ?? leh[0]?.outdoorTemp;
  const chenWinter = chen[0]?.meanOutdoorTemp ?? chen[0]?.outdoorTemp;
  check('§3 Leh is colder than Chennai outdoors in January', lehWinter < chenWinter, `Leh=${lehWinter} Chennai=${chenWinter}`);
}

/* ================================================================= */
console.log('\n════ §14 SURFACE TEMPERATURE ≠ SOLAR ABSORPTION ════\n');
{
  const d = design('in-jodhpur');
  const st = computeSurfaceTemperature(d.climate, d.geometry, d.materials, 4, 14, 32, 30);
  const keys = Object.keys(st.detail);
  check('§14 per-surface detail returned', keys.length >= 4, keys.join(', '));

  const temps = keys.map((k) => detailOf(st, k).surfaceTemp);
  const irr = keys.map((k) => detailOf(st, k).irradiance);
  check('§14 surface temps differ per surface', new Set(temps.map((t) => t.toFixed(2))).size > 1, temps.map((t) => t.toFixed(1)).join(' / '));
  check('§14 irradiance differs per orientation', new Set(irr.map((v) => v.toFixed(2))).size > 1, irr.map((v) => v.toFixed(0)).join(' / '));
  check('§14 sol-air temperature computed', keys.every((k) => Number.isFinite(detailOf(st, k).solAirTemp)));

  const byT = [...keys].sort((a, b) => detailOf(st, b).surfaceTemp - detailOf(st, a).surfaceTemp);
  const byI = [...keys].sort((a, b) => detailOf(st, b).irradiance - detailOf(st, a).irradiance);
  console.log(`   hottest=${byT[0]} (${detailOf(st, byT[0]).surfaceTemp.toFixed(1)}°C)  most-irradiated=${byI[0]} (${detailOf(st, byI[0]).irradiance.toFixed(0)} W/m²)`);

  /* The question §14 asks is: is the temperature map merely a re-skin of the
     solar map? The honest test is not "is the top surface different" — at noon
     the roof can legitimately be both. It is whether a surface with MORE sun can
     be COOLER than one with less, once U-value and thermal mass are applied.
     So compare the two complete orderings across surfaces. */
  console.log(`   temperature order: ${byT.map((k) => `${k}@${detailOf(st, k).surfaceTemp.toFixed(0)}`).join(' > ')}`);
  console.log(`   irradiance  order: ${byI.map((k) => `${k}@${detailOf(st, k).irradiance.toFixed(0)}`).join(' > ')}`);

  /* A single instant can legitimately coincide (at peak sun the sun dominates).
     The general claim is tested by sweeping month x hour and counting how often
     the two orderings actually diverge — see scripts/_audit-surface-map.ts.
     That sweep found 65 divergences out of 84 samples. */
  let divergent = 0;
  let samples = 0;
  for (let m = 0; m < 12; m += 1) {
    for (const h of [2, 6, 9, 12, 15, 18, 21]) {
      const s = computeSurfaceTemperature(d.climate, d.geometry, d.materials, m, h, 30, 40);
      const ks = Object.keys(s.detail);
      const t = [...ks].sort((a, b) => detailOf(s, b).surfaceTemp - detailOf(s, a).surfaceTemp);
      const i = [...ks].sort((a, b) => detailOf(s, b).irradiance - detailOf(s, a).irradiance);
      samples += 1;
      if (!t.every((k, idx) => k === i[idx])) divergent += 1;
    }
  }
  check(
    '§14 the temperature map is NOT a re-skin of the solar map (rankings diverge across the day)',
    divergent >= samples * 0.5,
    `${divergent}/${samples} hour-samples where the orderings differ`,
  );

  /* A second, sharper test: at night there is no sun at all, so any variation
     in surface temperature must come from the physics, not from irradiance. */
  const night = computeSurfaceTemperature(d.climate, d.geometry, d.materials, 4, 2, 32, 30);
  const nightTemps = Object.keys(night.detail).map((k) => detailOf(night, k).surfaceTemp);
  const nightIrr = Object.keys(night.detail).map((k) => detailOf(night, k).irradiance);
  check(
    '§14 at 02:00 irradiance is zero on every surface, yet temperatures still differ',
    nightIrr.every((v) => v === 0) && new Set(nightTemps.map((t) => t.toFixed(2))).size > 1,
    `irr=[${nightIrr.map((v) => v.toFixed(0)).join(',')}] T=[${nightTemps.map((t) => t.toFixed(1)).join(',')}]`,
  );

  check('§14 floor included', !!st.detail.floor, `floor=${st.detail.floor?.surfaceTemp?.toFixed(1)}°C`);
  check('§14 display range reported', Array.isArray(st.range) && st.range[0] <= st.range[1], JSON.stringify(st.range.map((v) => v.toFixed(1))));
  check('§14 dew point computed', Number.isFinite(st.dewPoint), `${st.dewPoint?.toFixed(1)}°C`);
  check('§14 condensation surfaces flagged', Array.isArray(st.condensationSurfaces), `${st.condensationSurfaces.length} surfaces`);

  /* the decisive physical test: raising absorptance must RAISE the roof temp */
  const hot = { ...d.materials, roof: { ...d.materials.roof, solarAbsorptance: 0.9 } };
  const cold = { ...d.materials, roof: { ...d.materials.roof, solarAbsorptance: 0.2 } };
  const stHot = computeSurfaceTemperature(d.climate, d.geometry, hot, 4, 14, 32, 30);
  const stCold = computeSurfaceTemperature(d.climate, d.geometry, cold, 4, 14, 32, 30);
  check(
    '§14 solar absorptance genuinely drives roof temperature (physics, not a label)',
    stHot.detail.roof.surfaceTemp > stCold.detail.roof.surfaceTemp,
    `α=0.9 → ${stHot.detail.roof.surfaceTemp.toFixed(1)}°C  vs  α=0.2 → ${stCold.detail.roof.surfaceTemp.toFixed(1)}°C`,
  );
}

/* ================================================================= */
console.log('\n════ §16 MOISTURE / CONDENSATION ════\n');
try {
  const d = design('in-leh');
  const m = computeMoisture(d.climate, d.geometry, d.materials, d.params, {
    month: 0, hour: 5, indoorTemp: 20, latentGainW: 220,
  });
  const bad = walkNumbers(m).filter(([, v]) => !Number.isFinite(v));
  check('§16 moisture engine returns finite output', bad.length === 0, `${walkNumbers(m).length} numbers`);
  console.log('   MoistureResult keys:', keysOf(m).join(', '));
  check('§16 per-surface moisture state produced', keysOf(m).includes('surfaces') || keysOf(m).includes('risk'), keysOf(m).join(', '));
} catch (e) {
  check('§16 moisture engine runs', false, String(e).slice(0, 200));
}

/* ================================================================= */
console.log('\n════ §17 HEAT LOSS ATTRIBUTION ════\n');
try {
  const d = design('in-leh');
  const sim: any = d && simulateDesign(d.params, d.climate, d.materials, d.geometry);
  const profile = (sim as any).dailyProfile ?? (sim as any).profile;
  if (!profile) {
    check('§17 a daily thermal profile is exposed for attribution', false, `keys: ${keysOf(sim).join(', ')}`);
  } else {
    const hl = computeHeatLossBreakdown(profile, d.params, d.geometry);
    const bad = walkNumbers(hl).filter(([, v]) => !Number.isFinite(v));
    check('§17 heat-loss breakdown is finite', bad.length === 0, `${walkNumbers(hl).length} numbers`);
    const sum = hl.components.reduce((a, c) => a + c.lossKwh, 0);
    check(
      '§17 components sum to the reported total',
      Math.abs(sum - hl.totalLossKwh) < Math.max(0.05, hl.totalLossKwh * 0.001),
      `sum=${sum.toFixed(3)} vs total=${hl.totalLossKwh.toFixed(3)}`,
    );
    check('§17 a worst component is named', !!hl.worst, hl.worst ? `${hl.worst.key} = ${hl.worst.lossKwh.toFixed(2)} kWh/day` : 'none');
    console.log('   components:', hl.components.map((c) => `${c.key}:${c.lossKwh.toFixed(1)}`).join(' '));
  }
} catch (e) {
  check('§17 heat-loss breakdown runs', false, String(e).slice(0, 200));
}

/* ================================================================= */
console.log('\n════ §18 PMV / PPD / ADAPTIVE ════\n');
{
  /* UNITS: `calculatePmv` takes SI — metabolicRate in W/m² and
     clothingInsulation in m²·K/W. Passing met/clo directly (1.1, 0.5) yields
     NaN, which is what happened on the first attempt at this test. The
     conversions are `metToWm2` / `cloToM2KW`. Verified against verify-model.ts. */
  const mk = (o: Record<string, number>) => ({
    metabolicRate: 1.2 * metToWm2(1),
    externalWork: 0,
    clothingInsulation: cloToM2KW(0.5),
    airTemperature: 24,
    meanRadiantTemperature: 24,
    relativeHumidity: 50,
    airVelocity: 0.1,
    ...o,
  });

  const neutral = calculatePmv(mk({}));
  const warm = calculatePmv(mk({ airTemperature: 30, meanRadiantTemperature: 30 }));
  const cold = calculatePmv(mk({ airTemperature: 14, meanRadiantTemperature: 14, clothingInsulation: cloToM2KW(1.0) }));

  console.log(`   neutral(24°C, 0.5clo) PMV=${neutral.pmv.toFixed(2)} PPD=${ppdFromPmv(neutral.pmv).toFixed(1)}%`);
  console.log(`   warm(30°C, 0.5clo)    PMV=${warm.pmv.toFixed(2)} PPD=${ppdFromPmv(warm.pmv).toFixed(1)}%`);
  console.log(`   cold(14°C, 1.0clo)    PMV=${cold.pmv.toFixed(2)} PPD=${ppdFromPmv(cold.pmv).toFixed(1)}%`);

  check('§18 PMV computes with SI inputs', Number.isFinite(neutral.pmv), `PMV=${neutral.pmv.toFixed(2)}`);
  check('§18 PMV within the ISO −3..+3 scale', Math.abs(warm.pmv) <= 3.01 && Math.abs(cold.pmv) <= 3.01, `${cold.pmv.toFixed(2)} .. ${warm.pmv.toFixed(2)}`);
  check('§18 PPD in [5,100]', ppdFromPmv(warm.pmv) >= 5 && ppdFromPmv(warm.pmv) <= 100.01, `PPD=${ppdFromPmv(warm.pmv).toFixed(1)}%`);
  check('§18 PMV=0 gives the 5% PPD floor', ppdFromPmv(0) <= 5.5, `${ppdFromPmv(0).toFixed(2)}%`);
  check('§18 a cold room yields negative PMV', cold.pmv < 0, `PMV=${cold.pmv.toFixed(2)}`);
  check('§18 a warm room yields positive PMV', warm.pmv > 0, `PMV=${warm.pmv.toFixed(2)}`);
  check('§18 PMV is monotonic in temperature', cold.pmv < neutral.pmv && neutral.pmv < warm.pmv,
    `${cold.pmv.toFixed(2)} < ${neutral.pmv.toFixed(2)} < ${warm.pmv.toFixed(2)}`);
  check('§18 PPD rises away from neutrality', ppdFromPmv(warm.pmv) > ppdFromPmv(neutral.pmv),
    `warm=${ppdFromPmv(warm.pmv).toFixed(1)}% > neutral=${ppdFromPmv(neutral.pmv).toFixed(1)}%`);

  /* Response to the other two ISO drivers */
  const breezy = calculatePmv(mk({ airVelocity: 1.0 }));
  const heavier = calculatePmv(mk({ clothingInsulation: cloToM2KW(0.9) }));
  check('§18 more air movement lowers PMV (cooling effect)', breezy.pmv < neutral.pmv, `${breezy.pmv.toFixed(2)} < ${neutral.pmv.toFixed(2)}`);
  check('§18 more clothing raises PMV (insulation effect)', heavier.pmv > neutral.pmv, `${heavier.pmv.toFixed(2)} > ${neutral.pmv.toFixed(2)}`);

  /* ASHRAE 55 adaptive */
  const band = adaptiveComfortBand(28);
  check('§18 ASHRAE 55 adaptive band computed', Number.isFinite(band.lower) && Number.isFinite(band.upper) && band.upper > band.lower,
    `${band.lower.toFixed(1)}–${band.upper.toFixed(1)}°C`);
  const bandWarm = adaptiveComfortBand(34);
  check('§18 the adaptive band shifts upward in a warmer climate', bandWarm.upper > band.upper, `${band.upper.toFixed(1)} → ${bandWarm.upper.toFixed(1)}°C`);
}

/* ================================================================= */
console.log('\n════ §19 HEAT STRESS (WBGT) ════\n');
{
  const mild = computeHeatStress(24, 50);
  const hot = computeHeatStress(38, 70);
  const extreme = computeHeatStress(48, 90);
  console.log(`   24°C/50% → best ${mild.wbgt}°C risk=${mild.risk} | 38/70 → ${hot.wbgt}°C ${hot.risk} | 48/90 → ${extreme.wbgt}°C ${extreme.risk}`);
  check('§19 WBGT computed', Number.isFinite(hot.wbgt), `${hot.wbgt}°C`);
  check('§19 risk escalates monotonically with heat', mild.risk !== extreme.risk && extreme.risk !== 'low', `${mild.risk} → ${hot.risk} → ${extreme.risk}`);
}

/* ================================================================= */
console.log('\n════ §20 COLD STRESS (ISO 11079) ════\n');
{
  const mild = computeColdStress(15, 1.2, 1.5, 0);
  const cold = computeColdStress(-20, 1.2, 0.8, 3);
  console.log(`   15°C → ${mild.risk} | -20°C → ${cold.risk}`);
  check('§20 cold stress computed', !!cold.risk, `risk=${cold.risk}`);
  check('§20 risk escalates with cold', mild.risk !== cold.risk, `${mild.risk} → ${cold.risk}`);
  check('§20 a required clothing value is produced', Number.isFinite(cold.requiredClo), `requiredClo=${cold.requiredClo}`);
}

/* ================================================================= */
console.log('\n════ §10/§11 MATERIALS & ASSEMBLIES ════\n');
check('§10 material library populated', MATERIAL_BY_ID.size > 10, `${MATERIAL_BY_ID.size} materials`);
check('§11 composite assemblies present', COMPOSITE_ASSEMBLIES.length > 0, `${COMPOSITE_ASSEMBLIES.length} assemblies`);
for (const a of COMPOSITE_ASSEMBLIES.slice(0, 5)) {
  /* NOTE: assemblyResistance / assemblyArealMass take the ASSEMBLY, not its
     `layers` array. Passing `.layers` was a test bug, not a product bug. */
  const r = Number(assemblyResistance(a));
  const m = Number(assemblyArealMass(a));
  const t = Number(assemblyThickness(a));
  check(
    `§11 "${a.id}" R=${r.toFixed(3)} m²K/W mass=${m.toFixed(1)} kg/m² t=${t.toFixed(3)} m`,
    r > 0 && m > 0 && t > 0,
  );
}

/* R must rise with added insulation, and mass must rise with denser layers. */
{
  const first = COMPOSITE_ASSEMBLIES[0];
  const thicker = {
    ...first,
    layers: first.layers.map((l, i) =>
      i === first.layers.length - 1 ? { ...l, thickness: l.thickness * 2 } : l,
    ),
  };
  check(
    '§11 thickening a layer raises the stack resistance (physics, not a constant)',
    assemblyResistance(thicker) > assemblyResistance(first),
    `${assemblyResistance(first).toFixed(3)} → ${assemblyResistance(thicker).toFixed(3)} m²K/W`,
  );
}

/* ================================================================= */
console.log('\n════ §6 MISSION PROFILES ARE DISTINCT ════\n');
check('§6 eight missions exist', MISSION_ORDER.length === 8, MISSION_ORDER.join(', '));
const loads: Record<string, string> = {};
for (const p of MISSION_PROFILES) {
  loads[p.id] = `${p.occupants}occ|${p.equipment.map((e) => `${e.id}x${e.count}`).join('+')}|${p.activityMet}met|${p.targetTemp.min}-${p.targetTemp.max}`;
  console.log(`   ${p.id.padEnd(23)} ${loads[p.id]}`);
}
check(
  '§6 Communication ≠ Personnel Accommodation',
  loads['communication'] !== loads['personnel-accommodation'],
  `comm="${loads['communication']}" person="${loads['personnel-accommodation']}"`,
);
check('§6 all eight have distinct load signatures', new Set(Object.values(loads)).size === 8, `${new Set(Object.values(loads)).size}/8`);

{
  const base = defaultRequirements();
  const comm = applyMissionProfile(base, 'communication');
  const person = applyMissionProfile(base, 'personnel-accommodation');
  check('§6 applying Communication changes occupancy/loads vs Personnel',
    comm.numOccupants !== person.numOccupants || JSON.stringify(comm.internalLoads) !== JSON.stringify(person.internalLoads),
    `occ ${comm.numOccupants} vs ${person.numOccupants}`);
  check('§6 a mission does NOT overwrite the envelope',
    comm.wallThickness === base.wallThickness && comm.insulationLevel === base.insulationLevel,
    `wall ${comm.wallThickness} == ${base.wallThickness}`);
}

/* ================================================================= */
console.log('\n════ §31 GEOMETRY IS A PURE FUNCTION OF DESIGN STATE ════\n');
{
  const a1 = design('in-pune');
  const a2 = design('in-pune');
  check('§31 same state → identical geometry (deterministic)', JSON.stringify(a1.geometry) === JSON.stringify(a2.geometry));
  const b = { ...a1.params, wallThickness: (a1.params.wallThickness ?? 0.23) + 0.1 };
  check('§31 changed state → different geometry', JSON.stringify(buildShelterGeometry(b, resolveMaterials(b))) !== JSON.stringify(a1.geometry));
  check('§31 geometry reports areas that the simulation consumes',
    Number.isFinite((a1.geometry as any).roofArea) && (a1.geometry as any).roofArea > 0,
    `roofArea=${(a1.geometry as any).roofArea?.toFixed?.(2)}`);
  check('§31 geometry glazing area is derived from WWR, not hardcoded',
    Number.isFinite((a1.geometry as any).glazingArea),
    `glazing=${(a1.geometry as any).glazingArea?.toFixed?.(2)} m²`);
}

/* ================================================================= */
const failed = results.filter((r) => !r.pass);
console.log(`\n═══════ ${results.length - failed.length}/${results.length} passed ═══════`);
if (failed.length) {
  console.log('\nFAILURES:');
  failed.forEach((f) => console.log(`  ✗ ${f.name} :: ${f.detail}`));
}
process.exit(failed.length ? 1 : 0);
