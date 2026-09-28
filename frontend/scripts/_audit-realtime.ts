/**
 * AUDIT — REAL-TIME / LIVE DATA PATH.
 * Answers: does the app pull real data from the network, and does it differ
 * from the offline climatology? Verified by calling the real provider.
 */
import { resolveClimate, resolveClimateOffline, resetClimateCache } from '../climate/climateService';
import { CLIMATE_STATIONS } from '../climate/stations';

async function main() {
  const cities = ['in-pune', 'in-leh', 'in-chennai', 'in-jodhpur', 'in-shillong'];
  console.log('\n======== LIVE vs OFFLINE CLIMATE DATA ========\n');
  let liveOk = 0;
  let offlineOk = 0;
  let differ = 0;

  for (const id of cities) {
    const st = CLIMATE_STATIONS.find((s) => s.location.id === id);
    if (!st) {
      console.log('SKIP ' + id + ' - not in station DB');
      continue;
    }
    const loc = st.location;

    const offline = resolveClimateOffline(loc);
    const offJan = offline.data.monthly[0];
    const offJul = offline.data.monthly[6];
    const offRain = offline.data.monthly.reduce((a, m) => a + (m.rainfall ?? 0), 0);

    resetClimateCache();
    let live: Awaited<ReturnType<typeof resolveClimate>> | null = null;
    try {
      live = await resolveClimate(loc, { preferLive: true, liveTimeoutMs: 12000 });
    } catch {
      /* fall through — provider chain should never throw */
    }

    const prov = live ? live.provider : 'FAILED';
    const liveJan = live ? live.data.monthly[0] : undefined;
    const liveJul = live ? live.data.monthly[6] : undefined;
    const liveRain = live ? live.data.monthly.reduce((a, m) => a + (m.rainfall ?? 0), 0) : 0;
    const same = liveJan && offJan
      ? Math.abs((liveJan.avgTemp ?? 0) - (offJan.avgTemp ?? 0)) < 0.05
      : true;

    if (prov === 'open-meteo') liveOk++;
    if (prov === 'database') offlineOk++;
    if (!same) differ++;

    console.log(loc.city + '  provider=' + prov + '  source=' + (live ? live.data.source : '-'));
    console.log('  offline Jan avg=' + (offJan ? offJan.avgTemp.toFixed(1) : '?') + 'C  Jul avg=' + (offJul ? offJul.avgTemp.toFixed(1) : '?') + 'C  annualRain=' + offRain.toFixed(0) + 'mm');
    if (liveJan) {
      console.log('  live    Jan avg=' + liveJan.avgTemp.toFixed(1) + 'C  Jul avg=' + (liveJul ? liveJul.avgTemp.toFixed(1) : '?') + 'C  annualRain=' + liveRain.toFixed(0) + 'mm');
      console.log('  -> data differs from offline: ' + (same ? 'no (coincides)' : 'YES'));
      console.log('  -> note: ' + (live ? live.note : '-'));
    }
    console.log('');
  }
  console.log('live provider used: ' + liveOk + '/' + cities.length + ' | offline used: ' + offlineOk + ' | data differs: ' + differ);
  console.log(liveOk > 0 ? '\nRESULT: REAL-TIME DATA PATH IS LIVE AND FUNCTIONAL' : '\nRESULT: live path did NOT engage');
}
main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
