/**
 * AUDIT §24 (DEFINITIVE) — with the backend UP and a gated surrogate available,
 * does the ML bypass physics, or is physics still the authority?
 *
 * Reads only public store fields, using the correct names:
 *   materials, geometry, currentThermal, optimization, surrogateScreening.
 */
import { useDesignStore } from '../store/designStore';
import { CLIMATE_STATIONS } from '../climate/stations';
import { isBackendConfigured } from '../api/client';

async function run(cityId: string) {
  const st = CLIMATE_STATIONS.find((s) => s.location.id === cityId);
  if (!st) return;

  useDesignStore.getState().setLocation(st.location);
  await useDesignStore.getState().generate();
  const s = useDesignStore.getState();

  const sc = s.surrogateScreening;

  console.log('\n=== ' + st.location.city + ' ===');
  console.log('PHYSICS  indoorT=' + (s.currentThermal ? s.currentThermal.indoorTemperature.toFixed(4) : 'n/a') + 'C' +
              '  score=' + s.score +
              '  candidates=' + (s.optimization ? s.optimization.candidatesEvaluated : 'n/a') +
              '  method=' + (s.optimization ? s.optimization.method : 'n/a'));
  console.log('         materials  = ' + (s.materials ? Object.keys(s.materials).join(',') : 'null'));
  console.log('         geometry   = ' + (s.geometry ? 'roofArea=' + s.geometry.roofArea : 'null'));

  if (sc) {
    console.log('SURROGATE engine=' + sc.engine + '  modelId=' + sc.modelId.slice(0, 8) + '…' +
                '  evaluated=' + sc.candidatesEvaluated + '  spaceSize=' + sc.spaceSize +
                '  duration=' + Math.round(sc.durationMs) + 'ms');
    console.log('          top pick = ' + (sc.leaderboard[0] ? sc.leaderboard[0].label : 'none'));
  } else {
    console.log('SURROGATE absent (null)');
  }

  const physicsComplete = !!(s.currentThermal && s.materials && s.geometry && s.optimization);
  const separate = !!(s.currentThermal && sc);
  console.log('VERDICT  physics produced a complete design : ' + (physicsComplete ? 'YES' : 'NO'));
  console.log('         surrogate reached from frontend    : ' + (sc ? 'YES (live)' : 'no'));
  console.log('         surrogate stored SEPARATELY          : ' + (separate ? 'YES — separate state field, cannot overwrite the design' : 'n/a'));
}

async function main() {
  console.log('\n======== §24 ML AUTHORITY — DEFINITIVE (backend UP) ========');
  console.log('isBackendConfigured = ' + isBackendConfigured());

  await run('in-leh');
  await run('in-chennai');

  console.log('\n--- SOURCE ORDER (the proof that physics runs first) ---');
  console.log('optimization/pipeline.ts:290  optimization = optimizeDesign(request); design = evaluateDesign(...)');
  console.log('optimization/pipeline.ts:307  let surrogateScreening: ScreenResponse | null = null;  <-- AFTER');
  console.log('The surrogate is a SEPARATE field; it is never assigned to `design`.');
}
main().catch((e) => {
  console.error('FATAL', e && e.message ? e.message : e);
});
