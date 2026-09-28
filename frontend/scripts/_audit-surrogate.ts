/**
 * AUDIT — is the ML surrogate actually REACHED from the frontend, and does the
 * physics still own the answer? Run with the backend up.
 */
import {
  isBackendConfigured,
  fetchSurrogateRegistry,
  screenDesignsWithBackend,
  checkBackendHealth,
} from '../api/client';
import type { Location, BuildingParameters } from '../types';

const LEH = {
  id: 'in-leh',
  city: 'Leh',
  state: 'Ladakh',
  country: 'India',
  latitude: 34.15,
  longitude: 77.58,
  elevation: 3500,
} as unknown as Location;

async function main() {
  console.log('\n======== SURROGATE REACHABILITY (backend up) ========\n');

  console.log('isBackendConfigured() =', isBackendConfigured());
  const health = await checkBackendHealth(6000);
  console.log('backend health        =', health ? JSON.stringify(health).slice(0, 220) : 'UNREACHABLE');

  try {
    const registry = await fetchSurrogateRegistry();
    console.log('models in registry    =', registry.models.length);
    console.log('models passing gate   =', registry.models.filter((m) => m.passedGate).length);
  } catch (e) {
    console.log('registry FAILED       =', (e as Error).message);
  }

  console.log('\n--- calling screenDesignsWithBackend (the surrogate) ---');
  try {
    const r = await screenDesignsWithBackend({ location: LEH, requirements: {} as BuildingParameters, limit: 6 });
    console.log('surrogate RESPONDED   = yes');
    console.log('payload keys          =', Object.keys(r as object).join(', '));
    console.log('json                  =', JSON.stringify(r).slice(0, 700));
  } catch (e) {
    console.log('surrogate FAILED      =', (e as Error).message);
  }
}
main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
