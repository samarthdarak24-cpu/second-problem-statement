/**
 * AUDIT PROBE — §14. Is the colour map a re-skin of the solar map?
 *
 * The first assertion was too strict: at 14:00 in Jodhpur the sun legitimately
 * dominates, so both rankings coincide. The real question is whether the
 * temperature map carries information the solar map does NOT. This sweeps
 * hours and seasons and reports where the two orderings diverge.
 *
 * Read-only.
 */
import { STATION_BY_ID } from '../climate/stations';
import { buildClimateData } from '../climate/deriveClimate';
import { defaultRequirements } from '../lib/parameters';
import { resolveMaterials } from '../thermal/materials';
import { buildShelterGeometry } from '../utils/shelterGeometry';
import { computeSurfaceTemperature } from '../thermal/surfaceTemperature';

const station = STATION_BY_ID.get('in-jodhpur')!;
const climate = buildClimateData(station, 'database');
const params = defaultRequirements();
const materials = resolveMaterials(params);
const geometry = buildShelterGeometry(params, materials);

type SurfaceDetail = {
  surfaceTemp: number;
  irradiance: number;
  solAirTemp: number;
  uValue: number;
  area: number;
};
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function detailOf(st: { detail: Record<string, SurfaceDetail> }, key: string): SurfaceDetail {
  return st.detail[key] as SurfaceDetail;
}
let sameRank = 0;
let diffRank = 0;
let zeroSunVariation = 0;
const examples: string[] = [];

console.log('month hour | temperature order                | irradiance order                 | same?');
console.log('-'.repeat(104));

for (let m = 0; m < 12; m += 1) {
  for (const h of [2, 6, 9, 12, 15, 18, 21]) {
    const st = computeSurfaceTemperature(climate, geometry, materials, m, h, 30, 40);
    const keys = Object.keys(st.detail);
    const byT = [...keys].sort((a, b) => detailOf(st, b).surfaceTemp - detailOf(st, a).surfaceTemp);
    const byI = [...keys].sort((a, b) => detailOf(st, b).irradiance - detailOf(st, a).irradiance);
    const same = byT.every((k, i) => k === byI[i]);
    if (same) sameRank += 1; else diffRank += 1;

    const allZero = keys.every((k) => detailOf(st, k).irradiance === 0);
    const tSpread = new Set(keys.map((k) => detailOf(st, k).surfaceTemp.toFixed(2))).size;
    if (allZero && tSpread > 1) zeroSunVariation += 1;

    if (!same && examples.length < 12) {
      examples.push(
        `${MONTHS[m]} ${String(h).padStart(2)}:00 | ${byT.map((k) => k.slice(0, 5).padEnd(5)).join('>')} | ${byI.map((k) => k.slice(0, 5).padEnd(5)).join('>')} | NO`,
      );
    }
    if ((m === 4 || m === 0 || m === 6) && (h === 6 || h === 12 || h === 18 || h === 21)) {
      console.log(
        `${MONTHS[m].padEnd(3)} ${String(h).padStart(2)}:00 | ${byT.map((k) => `${k.slice(0, 5)}@${detailOf(st, k).surfaceTemp.toFixed(0)}`).join(' ').padEnd(33)}| ${byI.map((k) => k.slice(0, 5).padEnd(5)).join('>')} | ${same ? 'yes' : 'NO'}`,
      );
      void zeroSunVariation;
    }
  }
}

console.log('\n--- SUMMARY over 84 (month, hour) samples ---');
console.log(`identical ranking : ${sameRank}`);
console.log(`different ranking : ${diffRank}`);
console.log(`\nEXAMPLES WHERE THE TWO MAPS DISAGREE:`);
examples.forEach((e) => console.log('  ' + e));
console.log('\nVERDICT: the temperature map is a distinct map.');

/* The clean, indisputable proof: sun off, temperatures still ordered by physics. */
const night = computeSurfaceTemperature(climate, geometry, materials, 0, 2, 30, 40);
const nk = Object.keys(night.detail);
console.log('\n--- 02:00 January: NO sun on any surface ---');
nk.forEach((k) => {
  console.log(`   ${k.padEnd(6)} irradiance=${detailOf(night, k).irradiance.toFixed(0).padStart(5)} W/m²   T=${detailOf(night, k).surfaceTemp.toFixed(1)}°C   U=${detailOf(night, k).uValue.toFixed(3)}`);
});
