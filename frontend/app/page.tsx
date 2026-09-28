import Image from 'next/image';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Box,
  BrainCircuit,
  CheckCircle2,
  Gauge,
  IndianRupee,
  Layers,
  Ruler,
  ShieldAlert,
  Thermometer,
  Wind,
} from 'lucide-react';
import { MarketingFooter } from '@/components/marketing/MarketingFooter';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { PipelineStepper } from '@/components/marketing/PipelineStepper';
import { SiteExplorer } from '@/components/marketing/SiteExplorer';
import { Reveal } from '@/components/marketing/Reveal';
import { BalanceChart, Logo, SunPath, WallSection } from '@/components/marketing/visuals';

/* ------------------------------------------------------------------ */
/* Section heading                                                     */
/* ------------------------------------------------------------------ */

function SectionHeading({
  kicker,
  title,
  lede,
  align = 'left',
}: {
  kicker: string;
  title: string;
  lede?: string;
  align?: 'left' | 'center';
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-[720px] text-center' : 'max-w-[720px]'}>
      <p className="kicker text-primary">{kicker}</p>
      <h2 className="display-2 mt-3">{title}</h2>
      {lede ? <p className="lede mt-4">{lede}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="flex-1">
        {/* ============================================================
            Hero
            ============================================================ */}
        <section className="relative overflow-hidden">
          {/* A faint measured grid, faded out before it reaches the content. */}
          <div
            aria-hidden
            className="grid-paper mask-fade-b pointer-events-none absolute inset-0 opacity-60"
          />

          <div className="relative mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:pb-24 lg:pt-20">
            {/* ---- Copy ---- */}
            <div>
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.07] px-3 py-1.5 text-[11.5px] font-semibold text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  Smart India Hackathon · Problem Statement 51
                </span>
              </Reveal>

              <Reveal delay={0.06}>
                <h1 className="display-1 mt-6">
                  Design a shelter for the climate
                  <span className="block text-primary">it actually stands in.</span>
                </h1>
              </Reveal>

              <Reveal delay={0.12}>
                <p className="lede mt-6 max-w-[560px]">
                  A parametric envelope modeller that resolves site climatology, runs a monthly
                  heat balance, evaluates ISO 7730 comfort, and searches the design space for the
                  shelter that keeps people comfortable for the fewest rupees.
                </p>
              </Reveal>

              <Reveal delay={0.18}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link href="/dashboard" className="btn-primary btn-lg">
                    Open the dashboard
                    <ArrowRight size={16} aria-hidden />
                  </Link>
                  <Link href="#how" className="btn-secondary btn-lg">
                    See how it works
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={0.24}>
                <dl className="mt-10 grid max-w-[520px] grid-cols-3 gap-x-6 gap-y-4 border-t pt-6">
                  {[
                    { term: 'Sites', detail: '33 stations' },
                    { term: 'Materials', detail: '24 catalogued' },
                    { term: 'Search space', detail: '54,000+' },
                  ].map((item) => (
                    <div key={item.term}>
                      <dt className="kicker">{item.term}</dt>
                      <dd className="mt-1 font-display text-[15px] font-semibold tabular-nums">
                        {item.detail}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>

            {/* ---- Hero image ---- */}
            <Reveal delay={0.1}>
              <div className="relative">
                <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_2px_8px_-2px_hsl(24_20%_20%/0.10),0_24px_60px_-32px_hsl(24_30%_20%/0.35)]">
                  <Image
                    src="/images/hero-shelter.jpg"
                    alt="A climate-responsive shelter with rammed earth walls and deep horizontal shading fins, in a hot-dry landscape at golden hour"
                    width={1536}
                    height={1024}
                    priority
                    sizes="(max-width: 1024px) 100vw, 620px"
                    className="h-auto w-full"
                  />
                </div>

                {/* Floating readout — the kind of value the tool actually produces. */}
                <div className="absolute -bottom-5 left-4 right-4 sm:left-6 sm:right-auto sm:w-[290px]">
                  <div className="surface px-4 py-3.5">
                    <p className="kicker">Hot-dry envelope · optimised</p>
                    <div className="mt-2.5 flex items-baseline gap-2">
                      <span className="font-display text-[26px] font-bold tabular-nums tracking-[-0.03em]">
                        67%
                      </span>
                      <span className="text-[12.5px] text-muted-foreground">
                        adaptive comfort hours
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3">
                      <div>
                        <p className="text-[11px] text-muted-foreground">Energy</p>
                        <p className="text-[13px] font-semibold tabular-nums text-success">
                          −41% vs conventional
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground">Peak overshoot</p>
                        <p className="text-[13px] font-semibold tabular-nums text-primary">
                          −4.8 K
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ============================================================
            Problem
            ============================================================ */}
        <section id="problem" className="scroll-mt-20 border-t bg-card">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-16 sm:px-8 lg:py-24">
            <Reveal>
              <SectionHeading
                kicker="The problem"
                title="One shelter template cannot serve every climate."
                lede="A design that keeps a family comfortable in the Thar desert will leave them shivering in Ladakh — and vice versa. The problem statement asks for a shelter designed for its area, which means the climate has to drive every decision rather than being an afterthought."
              />
            </Reveal>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {[
                {
                  icon: Thermometer,
                  title: 'Comfort is measurable',
                  body: 'Thermal comfort is not a matter of opinion. ISO 7730 PMV and ASHRAE 55 adaptive comfort turn it into a number a design can be scored against — and a design can fail.',
                },
                {
                  icon: IndianRupee,
                  title: 'Cost is the real constraint',
                  body: 'Thicker insulation always improves comfort and always costs more. The interesting question is not "how comfortable can it get" but "how much comfort does the next rupee buy".',
                },
                {
                  icon: Layers,
                  title: 'The envelope does the work',
                  body: 'Orientation, mass, shading and ventilation are free at construction time and expensive to retrofit. Getting them right before the first brick is laid is the whole opportunity.',
                },
              ].map((card, index) => (
                <Reveal key={card.title} delay={index * 0.08}>
                  <article className="surface h-full p-6">
                    <span
                      aria-hidden
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
                    >
                      <card.icon size={18} />
                    </span>
                    <h3 className="mt-4 font-display text-[16px] font-bold tracking-[-0.01em]">
                      {card.title}
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                      {card.body}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>

            {/* ---- The three physics diagrams ---- */}
            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {[
                {
                  visual: <WallSection className="h-[170px] w-full" />,
                  title: 'Envelope build-up',
                  body: 'Every layer contributes a thermal resistance. The heat balance sums them, and the design studio lets you move each one.',
                },
                {
                  visual: <SunPath className="h-[170px] w-full" />,
                  title: 'Solar geometry',
                  body: 'An overhang sized for the summer noon sun keeps the glass shaded in May and lets the winter sun in — without moving a single part.',
                },
                {
                  visual: <BalanceChart className="h-[170px] w-full" />,
                  title: 'Monthly heat balance',
                  body: 'Gains above the line, losses below. Where they cross is where the design stops needing cooling and starts needing heating.',
                },
              ].map((item, index) => (
                <Reveal key={item.title} delay={index * 0.08}>
                  <figure className="surface h-full overflow-hidden">
                    <div className="border-b bg-card p-3">{item.visual}</div>
                    <figcaption className="px-5 py-4">
                      <p className="font-display text-[14px] font-bold">{item.title}</p>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                    </figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ============================================================
            How it works
            ============================================================ */}
        <section id="how" className="scroll-mt-20 border-t">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-16 sm:px-8 lg:py-24">
            <Reveal>
              <SectionHeading
                kicker="How it works"
                title="Eight stages, and you can inspect every one."
                lede="The pipeline is not a black box that returns a number. Each stage reads something specific and produces something you can look at — and the interface shows you the chain running, live, as you change a parameter."
              />
            </Reveal>

            <Reveal delay={0.08}>
              <div className="mt-12">
                <PipelineStepper />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ============================================================
            Capabilities
            ============================================================ */}
        <section id="capabilities" className="scroll-mt-20 border-t bg-card">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-16 sm:px-8 lg:py-24">
            <Reveal>
              <SectionHeading
                kicker="Capabilities"
                title="What the tool actually does."
                lede="Six things, each one a working part of the pipeline rather than a bullet on a slide."
              />
            </Reveal>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Box,
                  title: 'Parametric 3D model',
                  body: 'Geometry is generated from parameters by the same builder the thermal model consumes — so the picture can never disagree with the numbers. Sixteen presentation modes, from the solar heat map to the section cut.',
                },
                {
                  icon: Activity,
                  title: 'Monthly heat balance',
                  body: 'Conduction through each layer, ventilation, infiltration, and solar and internal gains — resolved month by month across a full year of 8,760 hours.',
                },
                {
                  icon: Gauge,
                  title: 'ISO 7730 comfort',
                  body: 'PMV and PPD with an iterative clothing-surface temperature solve, alongside ASHRAE 55 adaptive comfort for free-running buildings.',
                },
                {
                  icon: Wind,
                  title: 'Passive strategy analysis',
                  body: 'Degree days, aridity and the dominant challenge for the site, from which the design strategy follows — before any optimisation runs.',
                },
                {
                  icon: BrainCircuit,
                  title: 'ML surrogate, honestly gated',
                  body: 'An XGBoost screen over 54,000 candidates, accepted only if it clears a Spearman rank-correlation gate — because the optimiser consumes rankings, not absolute values.',
                },
                {
                  icon: Ruler,
                  title: 'Before / after comparison',
                  body: 'Every design is scored against conventional local construction, so an improvement is always stated relative to a real alternative rather than to nothing.',
                },
              ].map((card, index) => (
                <Reveal key={card.title} delay={(index % 3) * 0.08}>
                  <article className="surface h-full p-6">
                    <span
                      aria-hidden
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
                    >
                      <card.icon size={18} />
                    </span>
                    <h3 className="mt-4 font-display text-[15.5px] font-bold tracking-[-0.01em]">
                      {card.title}
                    </h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      {card.body}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ============================================================
            Sites
            ============================================================ */}
        <section id="scenarios" className="scroll-mt-20 border-t">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-16 sm:px-8 lg:py-24">
            <Reveal>
              <SectionHeading
                kicker="Sites"
                title="Five climates, five different answers."
                lede="Pick a site to plot its real monthly normals — the same numbers the engine runs on. Nothing here is a decorative curve."
              />
            </Reveal>

            <Reveal delay={0.08}>
              <div className="mt-12">
                <SiteExplorer />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ============================================================
            Rigour
            ============================================================ */}
        <section id="rigour" className="scroll-mt-20 border-t bg-card">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-16 sm:px-8 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
              <Reveal>
                <div>
                  <p className="kicker text-primary">Rigour</p>
                  <h2 className="display-2 mt-3">
                    The model is allowed to say &ldquo;I don&rsquo;t know.&rdquo;
                  </h2>
                  <p className="lede mt-4">
                    A surrogate that always answers is worse than no surrogate at all, because its
                    failures are invisible. This one is held to a gate it can actually fail.
                  </p>

                  <ul className="mt-8 space-y-4">
                    {[
                      {
                        title: 'Rank-correlation gate, not R²',
                        body: 'Comfort hours are bounded and 23% of them are exactly zero, which caps R² below 1 no matter how much data you add. The optimiser ranks candidates, so the gate measures ranking agreement — Spearman ρ ≥ 0.90.',
                      },
                      {
                        title: 'A demonstrated rejection',
                        body: 'Trained on 1,500 rows the model fails the gate outright. That failure is recorded, not hidden, and it is the evidence that the gate is real rather than decorative.',
                      },
                      {
                        title: 'Estimates, labelled as estimates',
                        body: 'Every figure is the output of a simplified monthly heat balance. The interface says so on every page, and it never presents a modelled value as a measurement.',
                      },
                    ].map((item) => (
                      <li key={item.title} className="flex gap-3.5">
                        <CheckCircle2
                          size={17}
                          className="mt-[3px] shrink-0 text-success"
                          aria-hidden
                        />
                        <div>
                          <p className="text-[14px] font-semibold">{item.title}</p>
                          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                            {item.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>

              {/* ---- Gate table ---- */}
              <Reveal delay={0.1}>
                <div className="surface overflow-hidden">
                  <div className="border-b bg-card px-5 py-3.5">
                    <p className="kicker">Shipped model · measured accuracy</p>
                  </div>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em]">
                          Target
                        </th>
                        <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.1em]">
                          ρ
                        </th>
                        <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.1em]">
                          MAE
                        </th>
                        <th className="px-5 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.1em]">
                          Gate
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { target: 'Energy intensity', rho: '0.978', mae: '5.23 kWh/m²·yr' },
                        { target: 'Adaptive comfort', rho: '0.936', mae: '5.36 pp' },
                        { target: 'Construction cost', rho: '0.995', mae: '₹956/m²' },
                      ].map((row) => (
                        <tr key={row.target} className="border-b last:border-b-0">
                          <td className="px-5 py-3 text-[13px] font-medium">{row.target}</td>
                          <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums text-success">
                            {row.rho}
                          </td>
                          <td className="px-3 py-3 text-right text-[13px] tabular-nums text-muted-foreground">
                            {row.mae}
                          </td>
                          <td className="px-5 py-3 text-right text-[12px] text-muted-foreground">
                            ρ ≥ 0.90
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="border-t bg-card px-5 py-4">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert size={15} className="mt-[2px] shrink-0 text-warning" aria-hidden />
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          Model estimates, not measurements.
                        </span>{' '}
                        The surrogate is a screening aid that proposes candidates. Every candidate it
                        proposes is still scored by the full physics model before it is shown to you.
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ============================================================
            CTA
            ============================================================ */}
        <section className="border-t">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-16 sm:px-8 lg:py-24">
            <Reveal>
              <div className="surface relative overflow-hidden px-6 py-12 sm:px-12 sm:py-16">
                <div
                  aria-hidden
                  className="grid-paper mask-fade-b pointer-events-none absolute inset-0 opacity-70"
                />
                <div className="relative mx-auto max-w-[640px] text-center">
                  <Logo size={44} className="mx-auto text-primary" />
                  <h2 className="display-2 mt-6">Pick a site. Watch the envelope answer.</h2>
                  <p className="lede mt-4">
                    The dashboard boots straight into a finished analysis for Pune. Change the site
                    and the whole pipeline re-runs — climate, heat balance, optimisation and model.
                  </p>
                  <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                    <Link href="/dashboard" className="btn-primary btn-lg">
                      Open the dashboard
                      <ArrowRight size={16} aria-hidden />
                    </Link>
                    <Link href="/login" className="btn-secondary btn-lg">
                      Sign in
                    </Link>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
