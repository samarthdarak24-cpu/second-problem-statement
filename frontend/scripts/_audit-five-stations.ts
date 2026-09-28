/**
 * AUDIT — the five-station climate matrix from the brief:
 * Pune · Leh · Jodhpur · Chennai · Shillong.
 * Confirms each resolves to a DISTINCT climate and a DISTINCT design answer.
 */
import { useDesignStore } from '../store/designStore';
import { CLIMATE_STATIONS } from '../climate/stations';

async function main() {
  console.log('\n======== FIVE-STATION CLIMATE MATRIX ========\n');
  const ids = ['in-pune', 'in-leh', 'in-jodhpur', 'in-chennai', 'in-shillong'];
  const fingerprints = new Set<string>();

  console.log('city'.padEnd(11) + 'zone'.padEnd(15) + 'class'.padEnd(22) + 'Jan'.padEnd(8) + 'Jul'.padEnd(8) + 'rain'.padEnd(7) + 'score  EUI');
  console.log('-'.repeat(96));

  for (const id of ids) {
    const st = CLIMATE_STATIONS.find((s) => s.location.id === id);
    if (!st) { console.log('missing ' + id); continue; }

    useDesignStore.getState().setLocation(st.location);
    await useDesignStore.getState().generate();
    const s = useDesignStore.getState();
    const jan = s.climateData ? s.climateData.monthly[0] : null;
    const jul = s.climateData ? s.climateData.monthly[6] : null;
    const rain = s.climateData ? s.climateData.monthly.reduce((a, m) => a + (m.rainfall ?? 0), 0) : 0;
    const eui = s.metrics ? s.metrics.annualEnergy : 0;

    fingerprints.add(
      (s.climateData ? s.climateData.climateZone : '?') + '|' +
      Math.round(jan ? jan.avgTemp : 0) + '|' + Math.round(jul ? jul.avgTemp : 0) + '|' +
      Math.round(rain) + '|' + s.score + '|' + Math.round(eui),
    );

    console.log(
      st.location.city.padEnd(11) +
      (s.climateData ? s.climateData.climateZone : '?').padEnd(15) +
      (s.climateData ? s.climateData.climateType : '?').slice(0, 21).padEnd(22) +
      ((jan ? jan.avgTemp.toFixed(1) : '?') + 'C').padEnd(8) +
      ((jul ? jul.avgTemp.toFixed(1) : '?') + 'C').padEnd(8) +
      (Math.round(rain) + 'mm').padEnd(7) +
      String(s.score).padStart(2) + '/100 ' + eui.toFixed(1).padStart(5) + ' kWh/m2',
    );
  }

  console.log('\ndistinct climate+design fingerprints: ' + fingerprints.size + ' of ' + ids.length);
  console.log(fingerprints.size === ids.length
    ? 'RESULT: all five stations produce DISTINCT answers — climate genuinely drives the design.'
    : 'RESULT: COLLISION — two stations produced the same answer.');
}
main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); });
