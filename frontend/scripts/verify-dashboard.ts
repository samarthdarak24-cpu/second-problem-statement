/**
 * Dashboard state verification.
 *
 * The React components are thin projections of the Zustand store, so the thing
 * worth testing is the store: if `generate()` populates every field the panels
 * read, and a slider move re-derives the thermal and cost results without
 * touching the climate, then the interface has correct data to render.
 *
 * This harness drives the store exactly as the UI does — set a site, generate,
 * switch mode, move a parameter — and asserts the resulting state. It also spies
 * on the pipeline's stage events to confirm the flow diagram is driven by real
 * transitions rather than a timer.
 *
 * Run:  npx tsx scripts/verify-dashboard.ts
 */

import { useDesignStore } from '@/store/designStore';
import { generateDesign } from '@/optimization/pipeline';
import { STATION_BY_ID } from '@/climate/stations';
import { buildShelterGeometry } from '@/utils/shelterGeometry';
import { resolveMaterials } from '@/thermal/materials';
import { DEFAULT_STATION_ID } from '@/climate/stations';
import { defaultRequirements } from '@/lib/parameters';
import { liveDataAvailability, LIVE_PROBE_TIMEOUT_MS } from '@/climate/climateService';
import type { PipelineStageId } from '@/types';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

function has(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * Return the store to a clean automatic run on the default programme.
 *
 * Manual mode is sticky by design — the user owns the envelope until they hand
 * it back — so a test that changed mode has to put it back, or every later
 * generate silently skips the optimiser and inherits the previous site's
 * envelope. That is exactly what the first run of this harness got wrong.
 */
function resetStore(): void {
  const store = useDesignStore.getState();
  store.setMode('auto');
  store.setParameters(defaultRequirements());
  /*
   * Pin the suite to the offline climatology database.
   *
   * Without this the numbers move with whatever the network happens to answer,
   * and a suite that depends on the venue wifi is not a suite — Leh in
   * particular swings between a live reanalysis and the bundled normals, which
   * was enough to flip an assertion several runs in ten.
   */
  store.setPreferLive(false);
}

/* ------------------------------------------------------------------ */
/* 1 — Stage events are real                                           */
/* ------------------------------------------------------------------ */

async function testStageEvents(): Promise<void> {
  section('1 — The pipeline reports real stage transitions');

  const events: { stage: PipelineStageId; status: string; ms?: number }[] = [];
  const station = STATION_BY_ID.get('in-pune')!;

  await generateDesign(station.location, useDesignStore.getState().currentParameters, {
    mode: 'auto',
    onStage: (event) => events.push({ stage: event.stage, status: event.status, ms: event.durationMs }),
  });

  const order = events.filter((e) => e.status === 'running').map((e) => e.stage);
  const expected: PipelineStageId[] = [
    'input',
    'climate',
    'analysis',
    'thermal',
    'optimization',
    'parameters',
    'geometry',
    'results',
  ];

  check('every stage reports "running" exactly once', order.length === expected.length, `got ${order.length}`);
  check('stages run in the documented order', order.join(',') === expected.join(','), order.join(','));
  check(
    'every "running" is matched by a "done"',
    events.filter((e) => e.status === 'running').length ===
      events.filter((e) => e.status === 'done').length,
  );
  check(
    'durations are reported for the expensive stages',
    events.some((e) => e.stage === 'climate' && (e.ms ?? 0) > 0) &&
      events.some((e) => e.stage === 'optimization' && (e.ms ?? 0) > 0),
  );

  /* Without `onStage` the pipeline must not yield — the CLI harness and the
     benchmark depend on that. */
  const fastStart = Date.now();
  await generateDesign(station.location, useDesignStore.getState().currentParameters, { mode: 'auto' });
  const fastMs = Date.now() - fastStart;

  const slowStart = Date.now();
  await generateDesign(station.location, useDesignStore.getState().currentParameters, {
    mode: 'auto',
    onStage: () => undefined,
  });
  const slowMs = Date.now() - slowStart;

  check(
    'stage reporting costs a real yield but stays fast',
    slowMs >= 8 && slowMs < 3000,
    `silent ${fastMs} ms vs reporting ${slowMs} ms — 8 macrotask yields is the floor`,
  );

  /* --- The live-weather probe must not be re-attempted on every run --- */
  check(
    'live API availability is resolved after the first attempt',
    liveDataAvailability() !== 'unknown',
    liveDataAvailability(),
  );

  /*
   * The deterministic proof that a repeat run is cheap. Which branch applies
   * depends on whether this machine can reach the live archive, so the check is
   * written for both rather than assuming the sandbox has no network — an
   * earlier version asserted the offline branch and failed on a machine that
   * *did* have network, which said nothing about the code.
   */
  const store = useDesignStore.getState();
  store.setLocation(STATION_BY_ID.get(DEFAULT_STATION_ID)!.location);
  await useDesignStore.getState().generate();

  const after = useDesignStore.getState();
  const fallbacks = after.climateFallbacks;

  if (liveDataAvailability() === 'available') {
    check(
      'a repeat generate is served from the per-site cache',
      fallbacks.some((entry) => entry.includes('session cache')),
      fallbacks.join(' | ') || 'no fallbacks recorded',
    );
    check('the cached resolution kept its provider', after.climateProvider === 'open-meteo');
  } else {
    check(
      'a repeat generate skips the live lookup instead of re-probing',
      fallbacks.some((entry) => entry.includes('skipped')) ||
        fallbacks.some((entry) => entry.includes('session cache')),
      fallbacks.join(' | ') || 'no fallbacks recorded',
    );
  }

  check(
    'a repeat generate is well inside the probe timeout',
    fastMs < LIVE_PROBE_TIMEOUT_MS,
    `${fastMs} ms vs a ${LIVE_PROBE_TIMEOUT_MS} ms probe`,
  );
}

/* ------------------------------------------------------------------ */
/* 2 — Auto mode populates everything the UI reads                     */
/* ------------------------------------------------------------------ */

async function testAutoMode(): Promise<void> {
  section('2 — Auto mode: generate() populates the dashboard');

  resetStore();
  const store = useDesignStore.getState();
  store.setLocation(STATION_BY_ID.get(DEFAULT_STATION_ID)!.location);
  await useDesignStore.getState().generate();

  const s = useDesignStore.getState();

  check('no error recorded', s.error === null, s.error ?? '');
  check('generation finished', s.isGenerating === false);
  check('climate resolved', has(s.climateData));
  check('climate analysis produced', has(s.climateAnalysis));
  check('recommendations produced', s.recommendations.length > 0, `${s.recommendations.length}`);
  check('optimisation result present', has(s.optimization));
  check('comparison produced', has(s.comparison));
  check('metrics present', has(s.metrics));
  check('cost estimate present', has(s.cost));
  check('materials resolved', has(s.materials));
  check('geometry built', has(s.geometry));
  check('design score in range', s.score > 0 && s.score <= 100, `${s.score}`);
  check('advice parameters captured', has(s.adviceParameters));

  /* --- The pipeline stages must all be finished with real headlines --- */
  check('all 8 stages present', s.pipeline.length === 8, `${s.pipeline.length}`);
  check(
    'every stage finished',
    s.pipeline.every((stage) => stage.status === 'done'),
    s.pipeline.filter((x) => x.status !== 'done').map((x) => x.id).join(','),
  );
  check(
    'no stage is still showing the placeholder',
    s.pipeline.every((stage) => stage.headline !== '—'),
    s.pipeline.filter((x) => x.headline === '—').map((x) => x.id).join(','),
  );
  check(
    'every stage carries detail lines',
    s.pipeline.every((stage) => stage.details.length > 0),
    s.pipeline.filter((x) => x.details.length === 0).map((x) => x.id).join(','),
  );

  /* --- The optimised design must beat the conventional baseline --- */
  const improved = s.score >= s.baselineScore;
  check(
    'optimised design scores at least as well as the baseline',
    improved,
    `${s.score} vs ${s.baselineScore}`,
  );
  check(
    'energy is lower than the baseline',
    (s.metrics?.annualEnergy ?? 0) <= (s.baselineMetrics?.annualEnergy ?? Infinity),
    `${(s.metrics?.annualEnergy ?? 0).toFixed(0)} vs ${(s.baselineMetrics?.annualEnergy ?? 0).toFixed(0)} kWh`,
  );

  /* --- Manual mode must be off to begin with, and not dirty --- */
  check('starts in auto mode', s.mode === 'auto');
  check('not marked dirty after generate', s.isDirty === false);

  console.log(
    `\n  Pune → score ${s.score}/100 (baseline ${s.baselineScore}) · ` +
      `passive comfort ${(s.metrics?.adaptiveComfortHoursPct ?? 0).toFixed(1)} % · ` +
      `${(s.metrics?.energyUseIntensity ?? 0).toFixed(1)} kWh/m²·yr · ` +
      `${s.evaluations} candidates in ${s.durationMs} ms`,
  );
}

/* ------------------------------------------------------------------ */
/* 3 — The viewport's derivations are consistent                       */
/* ------------------------------------------------------------------ */

function testViewportDerivation(): void {
  section('3 — Viewport geometry matches the parameters');

  const s = useDesignStore.getState();
  const params = s.currentParameters;

  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);

  check(
    'floor area matches width × length',
    Math.abs(geometry.floorArea - params.width * params.length) < 0.05,
    `${geometry.floorArea.toFixed(2)} vs ${(params.width * params.length).toFixed(2)}`,
  );
  check('four wall panels built', geometry.walls.length === 4);
  check(
    'volume is positive and plausible',
    geometry.volume > 0 && geometry.volume < params.width * params.length * params.height * 1.3,
    `${geometry.volume.toFixed(1)} m³`,
  );
  check('glazing area is positive', geometry.glazingArea > 0);
  check(
    'glazing is a fraction of the wall area',
    geometry.glazingArea < geometry.wallArea,
    `${geometry.glazingArea.toFixed(1)} of ${geometry.wallArea.toFixed(1)} m²`,
  );

  /* The pipeline's own candidate must agree with a fresh derivation — this is
     the invariant that stops the 3D model drifting from the numbers. */
  check(
    'the pipeline geometry agrees with a fresh derivation',
    Math.abs((s.geometry?.floorArea ?? -1) - geometry.floorArea) < 0.01,
  );

  /* --- Parametric response: a slider must actually change the model --- */
  const wider = { ...params, width: params.width + 2 };
  const widerGeometry = buildShelterGeometry(wider, resolveMaterials(wider));
  check(
    'increasing width increases floor area',
    widerGeometry.floorArea > geometry.floorArea,
    `${geometry.floorArea.toFixed(1)} → ${widerGeometry.floorArea.toFixed(1)} m²`,
  );

  const roofed = buildShelterGeometry(
    { ...params, roofType: 'gable', roofAngle: 30 },
    resolveMaterials(params),
  );
  check(
    'switching to a gable roof raises the ridge',
    roofed.roof.rise > geometry.roof.rise,
    `${geometry.roof.rise.toFixed(2)} → ${roofed.roof.rise.toFixed(2)} m`,
  );

  const shaded = buildShelterGeometry(
    { ...params, shadingType: 'overhang', shadingDepth: 1.0 },
    resolveMaterials(params),
  );
  /* The optimised design already has shading of its own, so the comparison has
     to be against an explicitly unshaded envelope rather than against `params`. */
  const unshaded = buildShelterGeometry(
    { ...params, shadingType: 'none', shadingDepth: 0 },
    resolveMaterials(params),
  );
  check(
    'adding shading creates shading devices',
    shaded.shading.length > unshaded.shading.length,
    `${unshaded.shading.length} → ${shaded.shading.length}`,
  );
  check('an unshaded envelope has no shading devices', unshaded.shading.length === 0);
}

/* ------------------------------------------------------------------ */
/* 4 — Manual mode: sliders re-derive without re-fetching climate       */
/* ------------------------------------------------------------------ */

function testManualMode(): void {
  section('4 — Manual mode: a slider move re-derives the results');

  const store = useDesignStore.getState();
  store.setMode('manual');

  const before = useDesignStore.getState();
  const climateBefore = before.climateData;
  const energyBefore = before.metrics?.annualEnergy ?? 0;
  const fetchedBefore = before.climateData?.fetchedAt;

  /* Push the window-to-wall ratio to something extreme so the thermal model
     must respond — a change too small to move the numbers would prove nothing. */
  useDesignStore.getState().updateNumeric('windowToWallRatio', 0.55);

  const after = useDesignStore.getState();

  check('mode is manual', after.mode === 'manual');
  check('the parameter was written', after.currentParameters.windowToWallRatio === 0.55);
  check('the design is marked modified', after.isDirty === true);
  check(
    'the climate record was NOT re-fetched',
    after.climateData?.fetchedAt === fetchedBefore && after.climateData === climateBefore,
  );
  check('the optimiser result was kept as the reference', has(after.optimization));
  check(
    'the thermal result was re-derived',
    (after.metrics?.annualEnergy ?? 0) !== energyBefore,
    `${energyBefore.toFixed(0)} → ${(after.metrics?.annualEnergy ?? 0).toFixed(0)} kWh`,
  );
  check('the comparison was rebuilt', has(after.comparison));
  check('the geometry was rebuilt', has(after.geometry));

  console.log(
    `\n  WWR 30 % → 55 %: peak indoor ` +
      `${(after.metrics?.summerIndoorTemperature ?? 0).toFixed(1)} °C, ` +
      `energy ${(after.metrics?.annualEnergy ?? 0).toFixed(0)} kWh/yr, ` +
      `score ${after.score}`,
  );

  /* --- Programme changes rebuild the advice --- */
  const adviceBefore = useDesignStore.getState().adviceParameters;
  useDesignStore.getState().updateNumeric('numOccupants', 9);
  const adviceAfter = useDesignStore.getState().adviceParameters;
  check(
    'a programme change rebuilds the recommendation basis',
    adviceAfter !== adviceBefore && adviceAfter?.numOccupants === 9,
  );

  /* --- Adopting the climate-engine design restores the envelope --- */
  useDesignStore.getState().adoptAdvice();
  const adopted = useDesignStore.getState();
  check(
    'adopting the advice design changes the envelope',
    adopted.currentParameters.windowToWallRatio !== 0.55,
    `${adopted.currentParameters.windowToWallRatio}`,
  );
  check(
    'adopting does not silently re-fetch climate',
    adopted.climateData === climateBefore,
  );
}

/* ------------------------------------------------------------------ */
/* 5 — Changing site invalidates stale results                         */
/* ------------------------------------------------------------------ */

async function testSiteChange(): Promise<void> {
  section('5 — Changing site clears stale results, then re-generates');

  resetStore();
  useDesignStore.getState().setLocation(STATION_BY_ID.get('in-leh')!.location);
  const cleared = useDesignStore.getState();

  check('location updated', cleared.location?.city === 'Leh');
  check('stale climate cleared', cleared.climateData === null);
  check('stale metrics cleared', cleared.metrics === null);
  check('stale comparison cleared', cleared.comparison === null);
  check('stale recommendations cleared', cleared.recommendations.length === 0);
  check('pipeline reset to idle', cleared.pipeline.every((s) => s.status === 'idle'));

  await useDesignStore.getState().generate();
  const leh = useDesignStore.getState();

  check('Leh generated without error', leh.error === null, leh.error ?? '');
  check('Leh ran in auto mode', leh.mode === 'auto');
  check('the optimiser actually searched', leh.evaluations > 1, `${leh.evaluations} candidates`);
  check('Leh climate resolved', has(leh.climateData));
  check(
    'Leh is classified cold',
    leh.climateData?.climateZone === 'cold-desert' || leh.climateData?.climateZone === 'cold-sunny',
    leh.climateData?.climateZone,
  );
  check(
    'the optimiser chose a different envelope than for Pune',
    leh.currentParameters.roofType !== 'flat' ||
      leh.currentParameters.insulationLevel !== 'none',
    `${leh.currentParameters.roofType} / ${leh.currentParameters.insulationLevel}`,
  );
  check('Leh recommendations produced', leh.recommendations.length > 0);
  check(
    'Leh heating demand is real',
    (leh.metrics?.annualHeatingEnergy ?? 0) > 0,
    `${(leh.metrics?.annualHeatingEnergy ?? 0).toFixed(0)} kWh`,
  );

  console.log(
    `\n  Leh → score ${leh.score}/100 · peak indoor ` +
      `${(leh.metrics?.summerIndoorTemperature ?? 0).toFixed(1)} °C summer / ` +
      `${(leh.metrics?.winterIndoorTemperature ?? 0).toFixed(1)} °C winter · ` +
      `${(leh.metrics?.energyUseIntensity ?? 0).toFixed(1)} kWh/m²·yr`,
  );
}

/* ------------------------------------------------------------------ */
/* 6 — The demo scenario walks end to end                              */
/* ------------------------------------------------------------------ */

async function testDemoScenario(): Promise<void> {
  section('6 — The demo scenario (Pune → Leh → Jodhpur → Chennai)');

  const seen: string[] = [];

  for (const id of ['in-pune', 'in-leh', 'in-jodhpur', 'in-chennai', 'in-shillong']) {
    const station = STATION_BY_ID.get(id);
    if (!station) {
      check(`station ${id} exists`, false);
      continue;
    }

    /* Same brief, different site — which is the comparison the demo is making. */
    resetStore();
    useDesignStore.getState().setLocation(station.location);
    await useDesignStore.getState().generate();

    const s = useDesignStore.getState();

    /*
     * `score > 0` used to be asserted here, and it was the wrong assertion.
     * A passive-only shelter in a cold-desert January is genuinely uncomfortable
     * — the problem statement says so — and the composite score is allowed to
     * reach zero when the discomfort term saturates. What has to hold is that
     * the run completed and produced a coherent, finite result.
     */
    const ok =
      s.error === null &&
      s.mode === 'auto' &&
      s.evaluations > 1 &&
      s.pipeline.every((stage) => stage.status === 'done') &&
      s.metrics !== null &&
      Number.isFinite(s.score) &&
      s.score >= 0 &&
      s.recommendations.length > 0;

    check(
      `${station.location.city} runs clean`,
      ok,
      s.error ??
        `mode ${s.mode}, score ${s.score}, ${s.evaluations} candidates, ` +
          `${s.pipeline.filter((x) => x.status !== 'done').length} stage(s) incomplete`,
    );

    /* The shelter must actually shelter: warmer inside than the weather outside,
       on average, with a complete 24-hour profile behind the number. */
    const profile = s.currentThermal?.dailyProfile;
    const outdoorMean = profile
      ? profile.points.reduce((sum, p) => sum + p.outdoorTemp, 0) / profile.points.length
      : NaN;

    check(
      `${station.location.city} holds the interior above outdoor air`,
      profile !== undefined && profile.points.length === 24 && profile.indoorMean > outdoorMean,
      profile
        ? `indoor mean ${profile.indoorMean.toFixed(1)} °C vs outdoor ${outdoorMean.toFixed(1)} °C`
        : 'no daily profile on the thermal result',
    );

    seen.push(
      `${station.location.city.padEnd(12)} ${String(s.score).padStart(3)}/100  ` +
        `comfort ${(s.metrics?.adaptiveComfortHoursPct ?? 0).toFixed(0).padStart(3)}%  ` +
        `EUI ${(s.metrics?.energyUseIntensity ?? 0).toFixed(1).padStart(6)} kWh/m²·yr  ` +
        `${String(s.evaluations).padStart(4)} candidates  ${String(s.durationMs).padStart(5)} ms  ` +
        `${s.currentParameters.roofType}/${s.currentParameters.insulationLevel}`,
    );
  }

  console.log('');
  for (const line of seen) console.log(`  ${line}`);
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log('\nDASHBOARD STATE VERIFICATION');
  console.log('Exercising the Zustand store exactly as the React components do.\n');

  await testStageEvents();
  await testAutoMode();
  testViewportDerivation();
  testManualMode();
  await testSiteChange();
  await testDemoScenario();

  section('RESULT');
  console.log(`  ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
