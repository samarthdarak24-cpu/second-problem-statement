/**
 * Integration check: does the dashboard actually reach the FastAPI service?
 *
 * WHY THIS EXISTS
 * Every other suite in this project runs offline, which is the right default —
 * `verify:model`, `verify:geometry` and `verify:dashboard` must pass on a fresh
 * clone with no server running. The cost of that choice is that nothing proved
 * the *client* could talk to the service. `screenDesignsWithBackend` sat in
 * `api/client.ts` fully typed and completely unused: the endpoint worked when
 * called with curl and the app never called it. A green suite and a broken
 * integration are not mutually exclusive.
 *
 * So this script is deliberately the opposite: it needs a live backend, and it
 * *skips* rather than fails when one is not there. Run it with the service up.
 *
 * WHAT IT ASSERTS
 *   1. `/api/health` answers.
 *   2. `/api/ml/registry` reports a model that cleared the gate for every
 *      target. Without that the screening path is correctly unreachable, so the
 *      script skips instead of asserting something the service refuses to do.
 *   3. `generateDesign({ preferBackend: true })` resolves climate from the
 *      service, not from the local provider chain.
 *   4. The same run populates `surrogateScreening` with a ranked shortlist, and
 *      every row carries all three predictions *and* their held-out error bars.
 *   5. `preferBackend: false` leaves `surrogateScreening` null, so the opt-in is
 *      real rather than always-on.
 *
 * Run:  npx tsx scripts/verify-integration.ts
 *       npx tsx scripts/verify-integration.ts --url http://localhost:8000
 */

import type { Location } from '@/types';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const baseUrl = arg('url', process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(
  /\/+$/,
  '',
);

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log('\n========================================================================');
  console.log('Integration check — dashboard → FastAPI');
  console.log('========================================================================');
  console.log(`\n  backend  ${baseUrl}\n`);

  /*
   * The client reads `NEXT_PUBLIC_API_URL` at request time, not at module load,
   * so setting it here is enough — but the pipeline must be imported *after* it
   * is set, which is why these are dynamic imports rather than top-level ones.
   */
  process.env.NEXT_PUBLIC_API_URL = baseUrl;

  /* --- 1 — Is the service there at all? --- */
  let health: { status?: string; version?: string; surrogateReady?: boolean };
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health = (await response.json()) as typeof health;
  } catch (error) {
    console.log(
      '  SKIPPED — no backend reachable.\n' +
        `  ${error instanceof Error ? error.message : String(error)}\n\n` +
        '  This suite needs the service running:\n' +
        '    cd backend && .venv/Scripts/python run.py\n' +
        '  Everything else in the project runs offline, so this is not a failure.\n',
    );
    return;
  }

  check('backend answers /api/health', health.status === 'ok', `v${health.version ?? '?'}`);

  /* --- 2 — Is there a model allowed to answer? --- */
  const registry = (await (await fetch(`${baseUrl}/api/ml/registry`)).json()) as {
    ready: number;
    gate: { minSpearman: number[] };
  };

  if (registry.ready === 0) {
    console.log(
      '\n  SKIPPED — no model has cleared the validation gate, so `/api/optimize`\n' +
        '  is correctly refusing and there is nothing to screen with.\n' +
        '  Train one with:  npx tsx scripts/train-surrogate.ts\n',
    );
    return;
  }

  check('a gated model is registered', registry.ready > 0, `ready: ${registry.ready}`);
  check('health agrees the surrogate is ready', health.surrogateReady === true);

  /* --- 3 & 4 — Run the real pipeline with the backend enabled. --- */
  const { generateDesign } = await import('@/optimization/pipeline');
  const { defaultRequirements } = await import('@/lib/parameters');

  const pune: Location = {
    id: 'in-pune',
    country: 'India',
    state: 'Maharashtra',
    city: 'Pune',
    latitude: 18.52,
    longitude: 73.86,
    elevation: 560,
  };

  const withBackend = await generateDesign(pune, defaultRequirements(), {
    mode: 'auto',
    preferBackend: true,
  });

  check(
    'climate resolved through the service',
    withBackend.climateProvider === 'backend',
    `provider: ${withBackend.climateProvider}`,
  );

  const screening = withBackend.surrogateScreening;
  check('surrogate screening came back', screening !== null);

  if (screening) {
    check('leaderboard is non-empty', screening.leaderboard.length > 0, `${screening.leaderboard.length} rows`);
    check('candidates were evaluated', screening.candidatesEvaluated > 0, `${screening.candidatesEvaluated}`);
    check('a model id is reported', screening.modelId.length > 0, screening.modelId.slice(0, 8));
    check('the response carries a disclaimer', screening.disclaimer.length > 20);

    const targets = [
      'energy_use_intensity_kwh_m2_yr',
      'adaptive_comfort_hours_pct',
      'cost_per_m2_inr',
    ];

    const complete = screening.leaderboard.every((candidate) =>
      targets.every(
        (target) =>
          Number.isFinite(candidate.predictions[target]) &&
          Number.isFinite(candidate.errorBars[target]),
      ),
    );
    // A point estimate with no error bar is the specific thing that makes a
    // surrogate dangerous, so this is asserted rather than assumed.
    check('every row has 3 predictions and 3 error bars', complete);

    const ranked = screening.leaderboard.every(
      (candidate, index, all) => index === 0 || all[index - 1]!.objective <= candidate.objective,
    );
    check('the shortlist is ranked best-first', ranked);

    console.log('\n  Surrogate shortlist for Pune:');
    console.log(
      '  ' +
        'rank'.padEnd(6) +
        'design'.padEnd(44) +
        'score'.padStart(7) +
        'EUI'.padStart(10) +
        'comfort'.padStart(11),
    );
    for (const [index, candidate] of screening.leaderboard.slice(0, 5).entries()) {
      const energy = candidate.predictions.energy_use_intensity_kwh_m2_yr!;
      const comfort = candidate.predictions.adaptive_comfort_hours_pct!;
      console.log(
        '  ' +
          String(index + 1).padEnd(6) +
          candidate.label.slice(0, 42).padEnd(44) +
          String(candidate.score).padStart(7) +
          energy.toFixed(1).padStart(10) +
          comfort.toFixed(1).padStart(11),
      );
    }
    console.log(
      `\n  ${screening.candidatesEvaluated} candidates ranked of ` +
        `${screening.spaceSize.toLocaleString()} in ${Math.round(screening.durationMs)} ms`,
    );
  }

  /* --- 5 — The opt-in must be real. --- */
  const withoutBackend = await generateDesign(pune, defaultRequirements(), {
    mode: 'auto',
    preferBackend: false,
  });
  check(
    'screening is absent when the backend is not requested',
    withoutBackend.surrogateScreening === null,
  );

  /* --- Summary --- */
  console.log('\n========================================================================');
  console.log('RESULT');
  console.log('========================================================================');
  console.log(`  ${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exitCode = 1;
}

void main();
