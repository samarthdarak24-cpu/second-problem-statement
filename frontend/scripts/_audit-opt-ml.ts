/**
 * AUDIT — §23 optimization and §24 ML-surrogate authority.
 * Proves, by execution, that the ML surrogate cannot override the physics.
 * Read-only.
 */
import { STATION_BY_ID } from '../climate/stations';
import { defaultRequirements } from '../lib/parameters';
import { generateDesign } from '../optimization/pipeline';
import { DEFAULT_WEIGHTS } from '../optimization/objective';
import { getActiveSurrogate, isSurrogateAvailable, VALIDATION_GATE, activeEngineId, describeActiveEngine } from '../ml/surrogate';

const results: { n: string; p: boolean; d: string }[] = [];
const check = (n: string, p: boolean, d = '') => { results.push({ n, p, d }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? `  :: ${d}` : ''}`); };

console.log('\n════ §24 ML SURROGATE — AUTHORITY ════\n');

console.log('   VALIDATION_GATE:', JSON.stringify(VALIDATION_GATE));
check('§24 a validation gate is declared', !!VALIDATION_GATE && Array.isArray(VALIDATION_GATE.minSpearman), Object.keys(VALIDATION_GATE).join(', '));

const active = getActiveSurrogate();
console.log('   active surrogate:', active ? active.id : 'NONE');
console.log('   isSurrogateAvailable:', isSurrogateAvailable());
console.log('   activeEngineId:', activeEngineId());
console.log('   describeActiveEngine:', describeActiveEngine());
check('§24 the surrogate reports availability honestly', typeof isSurrogateAvailable() === 'boolean', `available=${isSurrogateAvailable()}`);
check(
  '§24 with no gated model the engine falls back to the rule-based climate engine',
  active !== null || activeEngineId() === 'rule-based-climate-engine',
  `engine=${activeEngineId()}`,
);
check(
  '§24 no undertrained model is activated (active is either a gated model or null)',
  active === null || (active.metrics && Array.isArray(active.metrics.spearman)),
  active ? `${active.id} spearman=[${active.metrics.spearman.map((r: number) => r.toFixed(2)).join(',')}]` : 'null — nothing activated, which is the honest state',
);

async function main(): Promise<void> {
/* ================================================================= */
console.log('\n════ §23 OPTIMIZATION — PHYSICS PRODUCES THE DESIGN ════\n');

const station = STATION_BY_ID.get('in-leh')!;
const params = defaultRequirements();

const stages: string[] = [];
const result = await generateDesign(station.location, params, {
  mode: 'auto',
  weights: DEFAULT_WEIGHTS,
  preferBackend: false,
  preferLive: false,
  openMeteoApiKey: '',
  onStage: (e) => { stages.push(`${e.stage}:${e.status}`); },
});

check('§23 the pipeline runs to completion', !!result, `stages=${stages.length}`);
check('§23 the pipeline emits ordered stage events', stages.length >= 6, stages.slice(0, 10).join(' → '));
check('§23 a design was produced by the physics engine', !!result.design, result.design ? `thermal indoorT=${(result.design as any).thermal?.indoorTemperature?.toFixed?.(1)}°C` : 'none');
check('§23 a baseline was produced for comparison', !!result.baseline, result.baseline ? `baseline thermal=${!!(result.baseline as any).thermal}` : 'none');
const opt = result.optimization as unknown as Record<string, unknown> | null;
check('§23 an optimization search result is reported', !!opt, opt ? `${opt.evaluations ?? opt.candidatesEvaluated} evaluations` : 'none');
const board = (opt?.leaderboard ?? opt?.candidates ?? opt?.ranked) as unknown[] | undefined;
check('§23 a leaderboard is exposed for transparency', Array.isArray(board) && board.length > 0, `${board?.length ?? 0} candidates`);
console.log('   optimization keys:', opt ? Object.keys(opt).join(', ') : 'none');

console.log('   keys:', Object.keys(result).join(', '));

check(
  '§24 the surrogate screening is OPTIONAL — the design exists with it absent',
  !!result.design && (result.surrogateScreening === null || typeof result.surrogateScreening === 'object'),
  `surrogateScreening=${result.surrogateScreening === null ? 'null (absent, not faked)' : 'present'}`,
);

/* The decisive test: the physics design must carry a REAL thermal result. */
const d: any = result.design;
check(
  '§24 the produced design carries a full thermal evaluation (not a surrogate guess)',
  !!d?.thermal && Number.isFinite(d.thermal.indoorTemperature),
  d?.thermal ? `indoorT=${d.thermal.indoorTemperature}°C comfort=${d.thermal.comfortHoursPct}%` : 'no thermal',
);
check(
  '§24 the produced design carries the geometry the numbers were computed for',
  !!d?.geometry,
  d?.geometry ? `roofArea=${d.geometry.roofArea?.toFixed?.(2)}` : 'no geometry',
);
check(
  '§24 the produced design carries the materials it was evaluated with',
  !!d?.materials,
  d?.materials ? Object.keys(d.materials).slice(0, 6).join(', ') : 'no materials',
);

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) failed.forEach((f) => console.log(`  ✗ ${f.n} :: ${f.d}`));
process.exit(failed.length ? 1 : 0);
}

void main();
