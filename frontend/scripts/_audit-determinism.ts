/**
 * AUDIT — PIPELINE DETERMINISM (diagnostic).
 * Runs the real store generate() in-process and reports exactly what came back,
 * so a failure is attributable rather than guessed at.
 */
import { useDesignStore } from '../store/designStore';
import { CLIMATE_STATIONS } from '../climate/stations';

type Snap = Record<string, string | number>;

function snap(): Snap {
  // Only the store's PUBLIC fields are read here. `result` is internal to the
  // store's applyGenerated(); the public surface exposes currentThermal,
  // optimization, score and the resolved metrics — which is what the UI reads.
  const s = useDesignStore.getState();
  return {
    hasLocation: s.location ? s.location.city : 'NONE',
    isGenerating: String(s.isGenerating),
    error: s.error ?? 'none',
    status: s.statusMessage ?? 'none',
    hasThermal: s.currentThermal ? 'yes' : 'no',
    score: s.score ?? NaN,
    indoorT: s.currentThermal ? s.currentThermal.indoorTemperature : NaN,
    comfort: s.currentThermal ? s.currentThermal.comfortScore : NaN,
    candidates: s.optimization ? s.optimization.candidatesEvaluated : NaN,
  };
}

async function main() {
  console.log('\n======== DETERMINISM DIAGNOSTIC ========\n');

  const stations = ['in-leh', 'in-pune'];
  for (const id of stations) {
    const st = CLIMATE_STATIONS.find((s) => s.location.id === id);
    if (!st) {
      console.log('missing ' + id);
      continue;
    }
    useDesignStore.getState().setLocation(st.location);
    console.log('--- ' + st.location.city + ' ---');
    console.log('after setLocation:', JSON.stringify(snap()));

    const runs: Snap[] = [];
    for (let i = 0; i < 3; i++) {
      try {
        await useDesignStore.getState().generate();
      } catch (e) {
        console.log('generate threw: ' + (e && (e as Error).message));
      }
      runs.push(snap());
    }
    runs.forEach((r, i) => console.log('  run' + (i + 1) + ': ' + JSON.stringify(r)));
    const same = runs.every((r) => r.indoorT === runs[0].indoorT && r.score === runs[0].score);
    console.log('  deterministic: ' + (same ? 'YES' : 'NO') + '\n');
  }
}
main().catch((e) => {
  console.error('FATAL', e && e.stack ? e.stack : e);
});
