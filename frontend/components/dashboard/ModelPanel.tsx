'use client';

/**
 * The learned component, and what it is allowed to claim.
 *
 * WHY THIS IS A SECTION AND NOT A PAGE
 * The surrogate is the one component in the system whose output is learned
 * rather than derived, so it belongs with the rest of the method and fidelity
 * discussion rather than as a destination of its own. It lives here so the
 * Method & Limits page can state, in one place, what every number in the app is
 * and is not — the physics *and* the thing that screens it.
 *
 * A learned component that cannot be inspected is not something you should
 * trust, so this panel reports what the model was trained on, what it scored on
 * held-out data, and whether it cleared the gate.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react';
import {
  checkBackendHealth,
  fetchSurrogateRegistry,
  type BackendHealth,
  type SurrogateRegistry,
} from '@/api/client';
import { useDesignStore } from '@/store/designStore';
import { Chip, EmptyState, Panel } from '@/components/ui/primitives';
import { SectionHeader, StatusBadge } from '@/components/ui/soft';
import { num } from '@/utils/format';
import { cn } from '@/lib/utils';

const TARGET_LABEL: Record<string, string> = {
  energy_use_intensity_kwh_m2_yr: 'Energy use intensity',
  adaptive_comfort_hours_pct: 'Adaptive comfort hours',
  cost_per_m2_inr: 'Construction cost',
};

const TARGET_UNIT: Record<string, string> = {
  energy_use_intensity_kwh_m2_yr: 'kWh/m²·yr',
  adaptive_comfort_hours_pct: '%',
  cost_per_m2_inr: '₹/m²',
};

/** The measured learning curve, quoted from the README so the page cannot drift. */
const LEARNING_CURVE = [
  { rows: 1500, energyR2: 0.875, comfortR2: 0.762, comfortRho: null as number | null, verdict: 'failed' },
  { rows: 12000, energyR2: 0.959, comfortR2: 0.882, comfortRho: 0.927, verdict: 'passed' },
  { rows: 40000, energyR2: 0.979, comfortR2: 0.892, comfortRho: 0.936, verdict: 'shipped' },
];

export function ModelPanel() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [registry, setRegistry] = useState<SurrogateRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const useBackend = useDesignStore((state) => state.useBackend);
  const setUseBackend = useDesignStore((state) => state.setUseBackend);
  const backendConfigured = useDesignStore((state) => state.backendConfigured);
  const engineDescription = useDesignStore((state) => state.engineDescription);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const probe = await checkBackendHealth(4000);
    setHealth(probe);

    if (!probe) {
      setRegistry(null);
      setLoading(false);
      return;
    }

    try {
      setRegistry(await fetchSurrogateRegistry());
    } catch (cause) {
      setRegistry(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = registry?.ready ?? 0;

  return (
    <div className="space-y-4">
      {/* ---------------- Identity ---------------- */}
      <SectionHeader
        eyebrow="Method · the learned component"
        title="The surrogate, and what it is allowed to claim"
        description="The one component in the system whose output is learned rather than derived. A learned component that cannot be inspected is not something you should trust — so this page reports what it was trained on, what it scored on held-out data, and whether it cleared the gate."
        right={
          <StatusBadge
            tone={loading ? 'generating' : ready > 0 ? 'ready' : health ? 'updated' : 'idle'}
            label={loading ? 'Probing' : ready > 0 ? 'Surrogate ready' : health ? 'No gated model' : 'Offline'}
          />
        }
      />

      {/* ---------------- The authority question, answered up front ---------------- */}
      <div className="soft-card flex flex-wrap items-start gap-x-8 gap-y-4 px-6 py-5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'hsl(var(--pastel-lavender))', color: 'hsl(var(--pastel-lavender-fg))' }}
        >
          <BrainCircuit size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-foreground">
            The physics engine is the authority. The surrogate is a screening aid.
          </p>
          <p className="mt-1 max-w-[880px] text-[13px] leading-relaxed text-muted-foreground">
            The surrogate ranks candidate designs so the optimiser can pick a winner quickly. It
            never produces the design that gets built — the browser&rsquo;s physics optimiser
            evaluates that. If the service is not running, this page says so and the rest of the
            application is unaffected.
          </p>
        </div>
      </div>

      {/* ---------------- Service status ---------------- */}
      <Panel
        title="Service"
        subtitle="The FastAPI backend that trains and serves the surrogate"
        accent="analysis"
        right={
          <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}>
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} aria-hidden />
            Refresh
          </button>
        }
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Server size={14} aria-hidden />
                Configured
              </span>
              <span className="text-[13px] font-semibold text-foreground">
                {backendConfigured ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Database size={14} aria-hidden />
                Reachable
              </span>
              <span className="text-[13px] font-semibold text-foreground">
                {loading ? 'Checking…' : health ? `Yes · v${health.version}` : 'No'}
              </span>
            </div>
            {health ? (
              <>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[13px] text-muted-foreground">Catalogue</span>
                  <span className="text-[13px] font-semibold tabular-nums text-foreground">
                    {health.stations ?? 0} stations · {health.materials ?? 0} materials
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[13px] text-muted-foreground">Engines</span>
                  <span className="text-[12px] font-medium text-foreground">
                    {(health.engines ?? []).join(' · ')}
                  </span>
                </div>
              </>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {loading ? (
                <Chip tone="neutral">
                  <Loader2 size={13} className="animate-spin" aria-hidden />
                  Probing service
                </Chip>
              ) : ready > 0 ? (
                <Chip tone="good">
                  <CheckCircle2 size={13} aria-hidden />
                  Surrogate ready
                </Chip>
              ) : health ? (
                <Chip tone="warn">
                  <AlertTriangle size={13} aria-hidden />
                  No gated model
                </Chip>
              ) : (
                <Chip tone="neutral">
                  <XCircle size={13} aria-hidden />
                  Offline
                </Chip>
              )}
            </div>

            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {backendConfigured ? (
                <>
                  {useBackend
                    ? 'The app is routing climate resolution and design screening through this service.'
                    : 'The app is running entirely on its in-browser physics engine. Turn the backend on to use the surrogate for screening.'}
                </>
              ) : (
                <>
                  No service is configured, so everything runs in the browser. That is a supported
                  mode, not a degraded one — the physics engine is the authority and needs no
                  server.
                </>
              )}
            </p>

            {backendConfigured ? (
              <button
                type="button"
                className={cn('btn', useBackend ? 'btn-primary' : 'btn-secondary')}
                onClick={() => setUseBackend(!useBackend)}
              >
                <Server size={14} aria-hidden />
                {useBackend ? 'Backend routing is on' : 'Turn backend routing on'}
              </button>
            ) : (
              <div className="rounded-lg border bg-card/40 px-3.5 py-3">
                <p className="text-[12px] font-semibold text-foreground">To enable the backend</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-muted-foreground">
                  <li>
                    <code className="rounded bg-muted px-1 py-0.5 text-[11.5px]">
                      cd backend &amp;&amp; .venv/Scripts/python run.py
                    </code>
                  </li>
                  <li>
                    Add{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-[11.5px]">
                      NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
                    </code>{' '}
                    to <code className="text-[11.5px]">.env.local</code>
                  </li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* ---------------- The gate ---------------- */}
      <Panel
        title="Validation gate"
        subtitle="What a model must prove before it is allowed to answer"
        accent="optimize"
      >
        <div className="space-y-5">
          <p className="max-w-[820px] text-[13px] leading-relaxed text-muted-foreground">
            The gate is <strong className="font-semibold text-foreground">Spearman rank
            correlation plus held-out MAE</strong> — not R². The surrogate exists to <em>rank</em>
            {' '}candidate designs so the optimiser can pick a winner, and one target is a poor fit
            for R²: <code className="rounded bg-muted px-1 py-0.5 text-[12px]">
            adaptive_comfort_hours_pct</code> is a count of comfortable hours out of 8,760, so it
            is bounded, quantised by the thermal model&apos;s time resolution, and has about a
            quarter of its mass pinned at exactly zero. A squared-error regressor cannot fit
            quantisation noise that is not a function of its inputs, so R² is capped below 1
            however much data it is given. R² is still reported, so the effect stays visible.
          </p>

          {registry ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Target</th>
                    <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                      Min ρ
                    </th>
                    <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                      Max MAE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {registry.targets.map((target, index) => (
                    <tr key={target} className="border-b border-border/50">
                      <td className="py-2.5 pr-4 text-foreground">
                        {TARGET_LABEL[target] ?? target}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">
                        {num(registry.gate.minSpearman[index] ?? 0, 2)}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">
                        {num(registry.gate.maxMae[index] ?? 0, 0)}{' '}
                        <span className="text-muted-foreground">
                          {TARGET_UNIT[target] ?? ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              The gate is defined in <code className="rounded bg-muted px-1 py-0.5">ml/surrogate.ts</code>{' '}
              and mirrored in <code className="rounded bg-muted px-1 py-0.5">backend/app/ml.py</code>.
              Start the service to read it from the registry.
            </p>
          )}
        </div>
      </Panel>

      {/* ---------------- Registry ---------------- */}
      <Panel
        title="Model registry"
        subtitle="Every model the service has trained, including the ones that failed"
        accent="input"
      >
        {loading ? (
          <EmptyState message="Loading registry…" />
        ) : !health ? (
          <EmptyState
            message="The service is not running"
            hint="Training and serving a surrogate is a server-side job. Everything else in this app works without it."
          />
        ) : error ? (
          <EmptyState message="Could not read the registry" hint={error} />
        ) : !registry || registry.models.length === 0 ? (
          <EmptyState
            message="No model has been trained"
            hint="Run: npx tsx scripts/train-surrogate.ts — from the project root, with the service running."
          />
        ) : (
          <div className="space-y-4">
            {registry.models.map((model) => (
              <div key={model.modelId} className="rounded-lg border bg-card/40">
                <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
                  <BrainCircuit size={15} className="text-primary" aria-hidden />
                  <span className="font-mono text-[12.5px] text-foreground">
                    {model.modelId.slice(0, 8)}
                  </span>
                  {model.passedGate ? (
                    <Chip tone="good">
                      <CheckCircle2 size={13} aria-hidden />
                      Serving
                    </Chip>
                  ) : (
                    <Chip tone="bad">
                      <XCircle size={13} aria-hidden />
                      Refused
                    </Chip>
                  )}
                  <span className="ml-auto text-[12px] text-muted-foreground">
                    {new Date(model.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="px-4 py-2 font-medium text-muted-foreground">Target</th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          ρ (gate)
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          MAE
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          R²
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Verdict
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.targets.map((target) => {
                        const stale = target.stale === true;
                        return (
                          <tr key={target.target} className="border-b border-border/40 last:border-0">
                            <td className="px-4 py-2.5 text-foreground">
                              {TARGET_LABEL[target.target] ?? target.target}
                              {stale ? (
                                <span className="ml-2 text-[13px] text-muted-foreground">
                                  (older contract)
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                              {target.spearman === null || target.spearman === undefined
                                ? '—'
                                : num(target.spearman, 3)}
                              <span className="ml-1 text-muted-foreground">
                                ({num(target.gateMinSpearman ?? 0, 2)})
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                              {target.mae === null || target.mae === undefined
                                ? '—'
                                : num(target.mae, 1)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                              {target.r2 === null || target.r2 === undefined
                                ? '—'
                                : num(target.r2, 3)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {target.passedGate ? (
                                <span style={{ color: 'hsl(var(--success))' }}>pass</span>
                              ) : (
                                <span style={{ color: 'hsl(var(--destructive))' }}>fail</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {model.topFeatures.length > 0 ? (
                  <p className="border-t px-4 py-2.5 text-[12px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">Top features:</span>{' '}
                    {model.topFeatures.slice(0, 6).join(' · ')}
                  </p>
                ) : null}
              </div>
            ))}

            <p className="text-[12px] leading-relaxed text-muted-foreground/70">
              {registry.explanation}
            </p>
          </div>
        )}
      </Panel>

      {/* ---------------- Measured learning curve ---------------- */}
      <Panel
        title="Measured accuracy"
        subtitle="What the model scores on held-out data as the training set grows"
        accent="output"
      >
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 font-medium text-muted-foreground">Training rows</th>
                  <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                    Energy R²
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                    Comfort R²
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                    Comfort ρ
                  </th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {LEARNING_CURVE.map((row) => (
                  <tr key={row.rows} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-4 tabular-nums text-foreground">
                      {row.rows.toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">
                      {num(row.energyR2, 3)}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">
                      {num(row.comfortR2, 3)}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">
                      {row.comfortRho === null ? '—' : num(row.comfortRho, 3)}
                    </td>
                    <td className="py-2.5 text-right">
                      <span
                        style={{
                          color:
                            row.verdict === 'failed'
                              ? 'hsl(var(--destructive))'
                              : 'hsl(var(--success))',
                        }}
                      >
                        {row.verdict === 'shipped' ? 'shipped' : row.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="max-w-[820px] text-[12.5px] leading-relaxed text-muted-foreground">
            Comfort R² asymptotes just under 0.90 while its rank correlation is already 0.936 — the
            model orders designs correctly and only fails to match a bounded, censored label&apos;s
            absolute variance. That is the measurement the gate is calibrated against. Note also
            that 1,500 rows <em>fails</em>: the gate rejects an under-trained model rather than
            shipping it, which is the whole point of having one.
          </p>
        </div>
      </Panel>

      {/* ---------------- Active engine ---------------- */}
      <Panel title="Active engine" subtitle="What is answering right now" accent="neutral">
        <p className="max-w-[820px] text-[13px] leading-relaxed text-muted-foreground">
          {engineDescription ||
            'The rule-based climate engine drives recommendations; the physics optimiser evaluates the design that gets built.'}
        </p>
      </Panel>

      {/* ---------------- No version of the truth is hidden ---------------- */}
      <div className="soft-card px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <b className="text-foreground/85">What this page is not.</b> It reports held-out accuracy,
          not field performance. The learning curve above is quoted from the project README so the
          page cannot drift away from the measurement it claims — and the 1,500-row row{' '}
          <em>fails</em> the gate on purpose, because a gate that always passes is not a gate.
        </p>
      </div>
    </div>
  );
}

export default ModelPanel;
