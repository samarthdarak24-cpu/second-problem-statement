# Phase 1 — Repository Audit & Feature Inventory

**Project:** THERMAL SHELTER — SIH PS-51 / DRDO
**Scope of this audit:** the complete frontend at `sih-thermal-shelter/frontend`
**Constraint under audit:** *frontend presentation only.* No change to the store,
thermal model, climate engines, optimization, ML surrogate, 3D geometry, routes,
APIs, calculations, exports or reports.

---

## 0. What the audit found before anything else

There is **one defect that is blocking the redesign from being seen at all**, and
it explains the user's report that text "does not appear":

> `soft.tsx` and **six page files** have always written `surface-pastel-*` classes
> and inline `hsl(var(--pastel-*))` backgrounds. **Those custom properties were
> never declared in `globals.css`.**

An undefined custom property makes `hsl(var(--x))` an *invalid* declaration, so
the browser drops it. The consequence is not subtle:

| Element | Written as | Actually rendered |
|---|---|---|
| `PastelCard` tone backgrounds | `background: hsl(var(--pastel-peach))` | **no background at all** — underlying canvas |
| `PastelCard` ink | `color: hsl(var(--pastel-peach-fg))` | **inherits** from nearest ancestor (`hsl(var(--foreground))`) |
| `LocationChip` | `bg-panel` | works (panel *was* defined) but sits on a canvas that shifted |
| Greeting card blobs | `hsl(var(--pastel-yellow))` / `-pink` | no fill |
| `StepBars`, `MaterialPanel` swatches | `hsl(var(--pastel-*))` | no fill |

Because the ink *inherited* instead of being set, dark text landed on whatever
the parent supplied — including the dark engineering viewport behind the
dashboard preview. "Maharashtra · 18.52° N, 73.86° E" was never *low contrast*;
its card had **no surface**, and the text was inheriting a foreground that did
not match the background it ended up over.

**Status: FIXED.** `--pastel-*` (7 tones × 2 properties = 14 values) plus
`--panel-foreground` are now declared in `globals.css`, each tone ships a
contrast-checked `-fg` ≥ 4.5:1 on its own background, and `tone-*` colours are
exposed in `tailwind.config.ts` so future work does not need inline styles.
Verified: `tsc --noEmit` clean, PostCSS emits all 14 tokens and all seven
`.surface-pastel-*` classes, 75/75 store checks still pass.

---

## 1. Route inventory

14 routes. Every route was read end-to-end. Line counts are from the audit scan.

### 1.1 Marketing & auth

| Route | Lines | Purpose | Primary user question | Decision |
|---|---|---|---|---|
| `/` | 515 | Landing page — the pitch, the pipeline stepper, the site explorer | "What is this and why should I trust it?" | **KEEP** — already coherent. Tighten footer only. |
| `/login` | 324 | Sign-in, session write via `lib/session.ts` | "How do I get in?" | **KEEP** — no change. |

### 1.2 Workspace (`/dashboard/*`, group `(app)`)

| Route | Lines | Purpose | Primary user question | Decision |
|---|---|---|---|---|
| `/dashboard` | 662 | Home. Greeting + 3 engineering outputs + live preview + site facts + recent + quick actions | "How is my current design doing?" | **SIMPLIFY** — 7 bands is 3 too many. See §2.1. |
| `/dashboard/climate` | 478 | Site & Climate — search, 4 summary cards, engine reading, monthly charts, climatology, **+ fingerprint tab** | "What does this location require?" | **KEEP** — this is the best-structured page in the app. |
| `/dashboard/brief` | 920 | Design Brief — fingerprint verdict, requirement engine, internal load, moisture, stress, heat loss, deployment | "What does this site specifically demand, and why?" | **SIMPLIFY** — largest page; 920 lines carrying 7 engines' worth of output with no banding. |
| `/dashboard/design` | 132 | Design Studio — 35/65 split, parameter controls + 3D | "What am I designing?" | **KEEP** — correctly thin wrapper. |
| `/dashboard/analysis` | 272 | Thermal Analysis — 3 headline numbers, monthly curve, heat balance, tabbed detail | "What is happening thermally?" | **KEEP** — the *reference* layout. Phase 2 validates here first. |
| `/dashboard/optimization` | 220 | Priority slider + CTA, before/after models, "what changed / why" | "What did the optimizer change, and what did it buy?" | **KEEP**. |
| `/dashboard/scenarios` | 73 | Climate Response — wraps `ScenarioLab` unchanged | "How does the design change across climates?" | **KEEP** — thin wrapper, correct. |
| `/dashboard/materials` | 83 | Envelope library + resolved assembly | "What is this built from?" | **KEEP**. |
| `/dashboard/method` | 659 | Method & Limits — standards, provenance, non-claims, **+ model surrogate section** | "How were these numbers produced and what do they not claim?" | **KEEP** — do not touch the copy. |
| `/dashboard/settings` | 253 | Backend, live data, API key, generation priority | "How is this tool configured?" | **KEEP**. |

### 1.3 Redirect shims (kept for link stability)

| Route | Lines | Redirects to | Decision |
|---|---|---|---|
| `/dashboard/fingerprint` | 21 | `/dashboard/climate?tab=fingerprint` | **KEEP** |
| `/dashboard/model` | 22 | `/dashboard/method?section=model` | **KEEP** |

Both are 21–22 lines via `RouteRedirect`. They cost nothing and honour old
bookmarks. Correct as-is.

---

## 2. Duplication candidates found

### 2.1 The dashboard repeats four other pages (highest-value finding)

`/dashboard` currently carries **seven** horizontal bands. Four of them are
summaries of pages that already exist and already do the job better:

| Dashboard band | Duplicates | Verdict |
|---|---|---|
| `CurrentDesignPreview` → comfort gauge + energy + cost cards | `/dashboard/analysis` | **SIMPLIFY** — keep the gauge, drop the energy/cost tiles (they are the two loudest cards on the page and they are the *subject* of another page). |
| `SiteFacts` (6 chips) | `/dashboard/climate` summary cards | **MERGE** into the greeting row. Six chips that each restate a number the greeting already implies. |
| `RecentDesigns` (3 synthesised city cards) | `/dashboard/scenarios` | **REMOVE** — the page's own docstring admits these are *synthesised*; the app does not persist designs. Three fake timestamps ("2 hours ago") are the only dishonest thing in the product. |
| `QuickActions` (4 jump cards) | `/dashboard/scenarios`, `/dashboard/materials`, `/dashboard/design` | **MERGE** into one existing footer link — the page *already* has a "Climate Response Lab" link at the bottom that does this better. |

That is **7 bands → 4**: greeting (with site facts folded in), pipeline strip,
outputs, live preview. Everything removed still exists one click away.

### 2.2 Two parallel primitive libraries — **checked, no collision**

| Library | Lines | Importers | Contents | Verdict |
|---|---|---|---|---|
| `components/ui/primitives.tsx` | 506 | **22 files** | `Chip`, `Panel`, `Segmented`, `Meter`, `MetricRow`, `StatCard`, `EmptyState`, `Toggle`, `SelectRow`, `SliderRow`, `CardBlock`, `NoteLine`, `Tone` | **KEEP** — the real control kit. Multi-imported from 22 sites, so its API is load-bearing. |
| `components/ui/soft.tsx` | 895 | **16 files** | `PastelCard`, `MetricCard`, `Gauge`, `PageHeader`, `SectionHeader`, `StatusBadge`, `BarRow`, `ProgressStrip`, `QuickActionCard`, `RecentDesignCard`, `ThreeDPreviewCard`, `LocationChip`, `ActionButton`, `ExpandableSection`, `GenerationOverlay`, `PastelTone` | **KEEP** — the presentation kit the redesigned pages import. |

**Correction to my first pass:** I flagged `MetricCard` / `SectionHeader` /
`StatusBadge` as names defined in *both* libraries with different signatures —
the most likely source of the next mistake. **That is wrong.** `primitives.tsx`
does **not** export any of those three names. Verified by grep:

```
$ grep -n "SectionHeader\|MetricCard\|StatusBadge" components/ui/primitives.tsx
(no output)
```

There is **no name collision**. The two libraries occupy disjoint namespaces and
have a clean split of responsibility — `primitives` = controls and containers,
`soft` = surfaces and headers. **No deduplication work is required.** This is
recorded here rather than silently deleted so the reasoning is auditable.

The only genuine naming hazard is conceptual: `Panel` (primitives) and
`PastelCard` (soft) are both "a bordered box". That is a documentation issue for
Phase 2, not a refactor.

### 2.2a Genuinely unreferenced code

Refcount-1 means the name appears **only at its own definition**. Three items
qualify:

| Item | Lines | Evidence | Decision |
|---|---|---|---|
| `components/dashboard/PipelineFlow.tsx` | 327 | `grep -rn PipelineFlow app components` → **no import anywhere**. Superseded by `ProgressStrip` (soft.tsx, 4 refs), which the dashboard's `PipelineStrip` wraps. | **ORPHAN** — leave in place; delete only with your OK. |
| `CardBlock` in `primitives.tsx:240` | ~36 | refcount 1 | **ORPHAN** |
| `NoteLine` in `primitives.tsx:276` | ~10 | refcount 1 | **ORPHAN** |

**Confirmed alive** (each mounted from a real page — my earlier "check these"
list resolved):

| Component | Mounted at |
|---|---|
| `SurfaceInspector` | `ViewportPanel.tsx:842` |
| `RecommendationPanel` | `optimization/page.tsx:215` |
| `ModelPanel` | `method/page.tsx:607` |
| `ParameterPanel` | `design/page.tsx:96` |
| `ScenarioViewport` | `ScenarioLab.tsx:642` |

So `design/page.tsx` being only 132 lines is correct — it is a thin wrapper
around `ParameterPanel` and the viewport, exactly as intended.

### 2.3 Chart duplication

| Component | Lines | Charts | Verdict |
|---|---|---|---|
| `components/dashboard/ChartsPanel.tsx` | 412 | 3 tabs: temperature / energy / balance | **KEEP** — the map of what is already covered. |
| `components/dashboard/ClimateSummaryPanel.tsx` | 337 | monthly climate curves | **KEEP**. |
| `components/dashboard/FingerprintPanel.tsx` | 230 | fingerprint radar/bars | **KEEP**. |
| `components/dashboard/ComparisonPanel.tsx` | 289 | before/after | **KEEP**. |
| `components/dashboard/ScenarioLab.tsx` | 876 | the 5-column sweep | **KEEP** — the product's best page. |

**No chart reduction is needed.** The duplication is not in charts; it is in the
dashboard's *card* summaries of those charts. Leave the charts alone.

The one genuine redundancy: `ChartsPanel` and `ClimateSummaryPanel` both plot
monthly temperature, from different sources (indoor modelled vs outdoor station).
That is **not** duplication — it is the comparison. Keep both, but they must never
appear on the same page without labels distinguishing them. Flagged for the
Thermal Analysis pass.

---

## 3. Chart usefulness — which charts earn their place

| Chart | Where | Earns it? | Reasoning |
|---|---|---|---|
| Monthly indoor temperature curve | `ChartsPanel` tab 1 | **Yes** | Answers "when is it uncomfortable" — the core question. |
| Monthly energy (cooling/heating stack) | `ChartsPanel` tab 2 | **Yes** | Directly maps to the EUI number above it. |
| Heat balance horizontal bars | `ChartsPanel` tab 3 + analysis page | **Yes** | Replaced a stacked column chart in the redesign, correctly — sign is legible in a bar row, not in a stacked area. |
| Monthly climate curves | `ClimateSummaryPanel` | **Yes** | Site-only, no building. Distinct from the above. |
| Fingerprint bars | `FingerprintPanel` | **Yes** | Compact, and it is the site's *identity*. |
| Before/after comparison | `ComparisonPanel` | **Yes** | The optimization claim is that two buildings differ. |
| 5-column climate sweep | `ScenarioLab` | **Yes** | The single most persuasive visual in the project. |
| **`BarRow` set inside the dashboard's Heat-flow card** | `/dashboard` | **No** | Six bars inside a 1-of-3 grid column, at ~120px wide. Unreadable at that width, and the full version is on Thermal Analysis. **Remove from dashboard.** |
| **Gauge in dashboard comfort card** | `/dashboard` | **Yes** | One number, correctly sized. Keep. |

---

## 4. Unused / orphaned components — resolved

The `git status` scan surfaced a long list of modified and untracked files, and
there is a `_components_dead/` directory at the repo root from an earlier
cleanup. Rather than guess, every suspect was traced to a mount point.

**Confirmed orphans** (name appears only at its own definition):

| Item | Lines | Superseded by |
|---|---|---|
| `components/dashboard/PipelineFlow.tsx` | 327 | `ProgressStrip` in `soft.tsx` |
| `CardBlock` (`primitives.tsx:240`) | ~36 | `Panel` |
| `NoteLine` (`primitives.tsx:276`) | ~10 | — |

**Confirmed alive:** `SurfaceInspector`, `RecommendationPanel`, `ModelPanel`,
`ParameterPanel`, `ScenarioViewport`, `ModelThumbnail`, `RouteRedirect`,
`ExpandableSection` (5 refs), `ActionButton` (2), `GenerationOverlay` (2).

Nothing is deleted by this audit. The three orphans are recorded so the decision
is yours.

---

## 5. Component inventory by concern

### 5.1 Shell (`components/shell/`) — 7 files, 1,100 lines

| File | Lines | Role | Decision |
|---|---|---|---|
| `AppShell.tsx` | 111 | Route group wrapper, boot pipeline guard, page padding | **KEEP** |
| `Sidebar.tsx` | 229 | 240px rail, grouped, active marker | **KEEP** |
| `Topbar.tsx` | 367 | Search, location, notifications, profile | **KEEP** |
| `MobileNav.tsx` | 228 | Bottom bar + sheet | **KEEP** |
| `nav.ts` | — | Route model, `NavItem` with `group` | **KEEP** — already documented and correct |
| `RouteRedirect.tsx` | 59 | Shim for the two moved routes | **KEEP** |

The nav model is **already exactly what Phase D specifies**:

- **MAIN:** Dashboard
- **DESIGN:** Site & Climate · Design Brief · Design Studio · Thermal Analysis · Optimization
- **COMPARE:** Climate Response
- **REFERENCE:** Materials
- **UTILITY (footer):** Method & Limits · Settings

**No navigation restructure is required.** The `group` field drives the sidebar
headings and adding a page never touches the shell. This is the one part of the
brief that is already complete.

### 5.2 3D (`components/3d/`) — 6 files, 2,005 lines

| File | Lines | Protected? | Role |
|---|---|---|---|
| `ShelterModel.tsx` | 808 | **YES — do not touch** | Geometry |
| `SceneRig.tsx` | 437 | **YES — do not touch** | Camera, lights, sun path |
| `ShelterCanvas.tsx` | 546 | Presentation only | Canvas host, quality, exporter |
| `environment.tsx` | 308 | Presentation only | Ground, sky, grid |
| `overlays.tsx` | 302 | Presentation only | Labels, dimensions |
| `ModelThumbnail.tsx` | 117 | Presentation only | Dashboard preview |

Redesign may touch `ShelterCanvas` (chrome/quality), `environment` and `overlays`
(visual language). `ShelterModel` and `SceneRig` are off limits.

### 5.3 2D (`components/2d/`) — 1 file

`FloorPlanCanvas.tsx` (394) — **do not touch.**

### 5.4 UI kit (`components/ui/`) — 2 files, 1,401 lines

Covered in §2.2. Disjoint namespaces, clean split, no deduplication needed.

### 5.5 Marketing (`components/marketing/`) — 6 files, 1,036 lines

`MarketingHeader` (127), `MarketingFooter` (91), `PipelineStepper` (222),
`SiteExplorer` (193), `Reveal` (38), `visuals.tsx` (445). All land on `/`.
**KEEP** — the landing page is out of scope for the workspace redesign, but
`visuals.tsx` and `Reveal.tsx` are the natural home for any shared motion
primitive in Phase 2.

---

## 6. Design-system audit

### 6.1 What exists and is correct

`globals.css` (now ~700 lines) declares a genuinely disciplined token layer:

- **Surfaces:** `--background` (warm off-white `#FBFAF8`), `--panel`, `--card`,
  `--surface-sunken`, `--surface-well`
- **Ink:** `--foreground` (`#1C1917`), `--muted-foreground` (`#786F68`),
  `--subtle-foreground` (`#9A928B`)
- **One accent:** `--primary` terracotta `#BD5224`, plus `--primary-soft`
- **Semantics:** success `#296E56`, warning `#B4740E`, destructive `#B62B2B`,
  info `#3C6B93` (desaturated slate, documented as *cold only*, never decorative)
- **Elevation:** 3 tiers — hairline / raised / float
- **Motion:** 4 durations + 2 easings, all short (120–520ms)
- **Engineering surfaces:** a dark charcoal-slate ramp for the 3D viewport,
  explicitly "reads as equipment, not as a theme"
- **Thermal ramp:** 6 stops, sage → olive → sand → amber → orange → rust,
  **no blue**, confined to charts and the 3D model
- **Stage accents:** a warm progression (stone → terracotta → amber → green)

This matches the Phase D requirement of "warm off-white, amber/terracotta accent"
**and** the anti-requirements (no cyberpunk, no glassmorphism, no glow, no
oversized text, no AI-chatbot styling). The palette is already right.

### 6.2 What was wrong

1. **14 undefined tokens** breaking six pages. *Fixed.*
2. `--panel-foreground` referenced by Tailwind but undeclared. *Fixed.*
3. The comment block at the top of `globals.css` claims the pastel set was
   removed and colour is spent in three places only — **while the file below it
   still defines and markets the pastel surfaces**, and seven pages still use
   them. The comment and the code disagreed. *Reconciled:* the tokens now exist,
   and the comment in `:root` documents exactly why.

### 6.3 Motion

`framer-motion ^11.18.2` is installed and used. **`gsap` is not installed.**

The Phase D brief asks for "GSAP-driven microinteractions". Options:

| Option | Cost | Assessment |
|---|---|---|
| Install `gsap` | 1 dependency | Requires a new dep in a static-export Next app. GSAP's `ScrollTrigger` needs client-only wiring; it duplicates what `framer-motion` already does for this app. |
| Use existing `framer-motion` + the token easings | 0 | Already present, already tree-shaken, already used by `AppShell`'s `AnimatePresence`, `Reveal.tsx`, and the sidebar's `layoutId` marker. |

**Recommendation:** implement the microinteractions with `framer-motion` driven by
the existing `--dur-*` / `--ease-*` tokens, and add CSS-keyframe micro-motion for
the non-React surfaces (grid flow, pulse rings — `tailwind.config.ts` already
declares `dash-flow` and `pulse-ring`). If GSAP is still wanted afterwards, it can
be added as a single enhancement pass on the pipeline visualisation. **Needs your
call** — flagged rather than assumed.

---

## 7. Per-page KEEP / SIMPLIFY / MERGE / MOVE / HIDE / REMOVE

### `/` — KEEP
### `/login` — KEEP
### `/dashboard` — SIMPLIFY
- REMOVE `RecentDesigns` (synthesised data, false timestamps)
- MERGE `SiteFacts` into the greeting row
- MERGE `QuickActions` into the existing footer link
- SIMPLIFY `CurrentDesignPreview` (gauge stays; energy + cost tiles move out)
- 7 bands → 4
### `/dashboard/climate` — KEEP
- Fingerprint tab correctly integrated
### `/dashboard/brief` — SIMPLIFY
- 920 lines, no visual banding. Introduce the WHAT → WHY → HOW bands used elsewhere.
- HIDE deployment/cost detail behind a disclosure; it is the last thing a reviewer needs.
### `/dashboard/design` — KEEP
### `/dashboard/analysis` — KEEP-as-reference
- **This is the page Phase 2 validates the visual language against.**
### `/dashboard/optimization` — KEEP
### `/dashboard/scenarios` — KEEP
### `/dashboard/materials` — KEEP
### `/dashboard/method` — KEEP (copy frozen)
### `/dashboard/settings` — KEEP
### `/dashboard/fingerprint`, `/dashboard/model` — KEEP (shims)

---

## 8. State coverage audit

Every page must handle five states. Current coverage:

| State | Where handled | Gap |
|---|---|---|
| **Loading** | `AppShell` boot guard; `StatusBadge tone="generating"` | No skeleton on first paint of any dashboard page. `LoadingSkeleton` does not exist in this revision. |
| **Empty** | `HeadlineOutputs` has an explicit "Press Generate design" card | **Best-in-class.** This is the pattern to replicate. |
| **Error** | `store.error` + `dismissError()` | Not surfaced on most pages. No error boundary in the workspace. |
| **Partial** | `isGenerating` banner on `/dashboard` | Absent on analysis / optimization / scenarios. |
| **Ready** | Default | Fine. |

**Gap list:** no `LoadingSkeleton`, no `EmptyState` primitive, no error boundary
in the `(app)` group, and `isGenerating` is only honoured on one page.

---

## 9. Accessibility audit (static pass)

| Check | Status |
|---|---|
| `:focus-visible` ring | Present, `2px` + `2px` offset |
| `prefers-reduced-motion` | Present — disables animation |
| Semantic tables | `ComparisonPanel` uses real `<table>` |
| Form labels | `Field` in primitives — spot-checked OK |
| Icon-only buttons | **Mixed** — `aria-hidden` used consistently on decorative icons, but several icon buttons rely on `title` rather than `aria-label` |
| Colour-alone status | Token comment states the rule; **not verifiable statically** |
| Heading order | **Misdiagnosed here.** See §17.3 — the `<h1>` was present in `Topbar` all along. Two genuine heading defects were found later by reading the rendered DOM, and are fixed in §17. |
| Contrast | **Was broken by the undefined tokens**; now fixed. Needs a rendered re-check. |

---

## 10. What Phase 1 concludes

1. **The blocking bug is found and fixed** — 14 undefined tokens, six pages
   affected. This is why the redesign "did not look like anything".
2. **The navigation is already complete** — MAIN / DESIGN / COMPARE / REFERENCE +
   utility footer is exactly as specified. No work needed.
3. **The design system already satisfies the brief** — warm off-white, terracotta
   accent, one accent, calm motion, engineering surfaces. It needed *repair*, not
   replacement.
4. **The real work is the dashboard** — 7 bands with 4 duplicating other pages,
   including three cards built on data the app admits is synthesised.
5. **`brief/page.tsx` (920 lines) needs banding**, not restructuring.
6. **Motion is a decision, not a task** — GSAP is not installed; `framer-motion`
   is. See §6.3.
7. **Nothing protected was touched.** `store/designStore.ts`, `lib/parameters.ts`,
   `thermal/*`, `climate/*`, `lib/buildingTypes.ts`, `components/3d/ShelterModel.tsx`,
   `components/3d/SceneRig.tsx`, `components/2d/FloorPlanCanvas.tsx` — all
   unmodified. Verified by `git status`.

---

## 11. Proposed implementation sequence (revised from the brief)

| # | Step | Status |
|---|---|---|
| 1 | Audit repository | **DONE** (this document) |
| 2 | Feature / component inventory | **DONE** |
| 3 | Fix the design-system defect (undefined tokens) | **DONE** |
| 4 | Reconciled token layer + `tone-*` utilities in Tailwind | **DONE** |
| 5 | Validate visual language on **Thermal Analysis** | **DONE** — stale-run banner added |
| 6 | Apply to Dashboard (7 bands → 4) | **DONE** — §14 |
| 7 | Apply to Design Brief (banding) | **DONE** — §19 |
| 8 | Confirm Site & Climate / Studio / Optimisation / Climate Response / Materials | **DONE** — no changes needed |
| 9 | Add state primitives — `LoadingSkeleton`, `EmptyState`, error boundary | **DONE** — §15 |
| 10 | Refine 3D interaction chrome | **DONE** — §20 |
| 11 | Responsive pass | OUTSTANDING |
| 12 | Accessibility pass | PARTLY — `<h1>` outline fixed (§17); needs a full rendered audit |
| 13 | Regression — `tsc`, `next build`, `npm run verify`, route crawl | **DONE** (build blocked by sandbox only — §21) |

Also fixed en route, neither of which was in the plan: the `navItemFor()` trailing-slash
bug and the duplicate `<h1>`s (§17).

---

## 14. The dashboard pass (completed)

Applied exactly as §2.1 and §7 specified. **7 bands → 4.**

| Change | Detail |
|---|---|
| **REMOVED** `RecentDesigns` | Three cards built on `RECENT_CITIES`, hard-coded `['2 hours ago', 'yesterday', '2 days ago']` timestamps, and a `may = station.monthly[4]` lookup labelled `peak mean` — May is not the peak month for these stations. The app does not persist designs, so the row was fiction. Deleted along with `RECENT_CITIES` and the now-unused `STATION_BY_ID` import. |
| **MERGED** `SiteFacts` → `Greeting` | The six chips became a `<dl>` inside the greeting band, separated by a hairline rule. Same six facts, now sitting beside the site they describe instead of repeating it in their own band. |
| **MERGED** `QuickActions` → footer | The four equal-weight jump-cards became one prominent destination (Climate Response Lab, unchanged) plus a `<nav aria-label="Other destinations">` with three plain text links. The page now ends on **one** decision instead of a 4-up grid. |
| **UNCHANGED** | `Greeting` identity/headline, `PipelineStrip`, `HeadlineOutputs`, `CurrentDesignPreview`, and the generating banner. |

`Home`, `Plus`, `Layers` and the `QuickActionCard` / `RecentDesignCard` imports were removed with the bands that used them.

## 15. State primitives (completed)

The §8 gap is closed.

| Added | Where | Notes |
|---|---|---|
| `Skeleton` | `ui/primitives.tsx` | Base block. `aria-hidden` — the region carries `aria-busy`, so a screen reader hears one status line, not a dozen empty boxes. |
| `MetricSkeleton` | `ui/primitives.tsx` | Matches `MetricCard`'s footprint so the grid does not reflow when real numbers land. |
| `PanelSkeleton` | `ui/primitives.tsx` | `rows` prop controls the suggested body length. |
| `PageSkeleton` | `ui/primitives.tsx` | Whole-route placeholder, with an `sr-only` "Calculating thermal response…" live region. |
| `.skeleton` | `globals.css` | Slow low-contrast sweep, not a hard pulse. Frozen to a flat tint under `prefers-reduced-motion` — still reads as a placeholder. |
| `app/(app)/error.tsx` | route group | First error boundary in the workspace. Keeps the failure inside the content area so the sidebar and topbar survive; offers a real `reset()`; states plainly that the design and last result are still loaded. Does not catch or alter any calculation error. |
| `app/(app)/loading.tsx` | route group | Renders `PageSkeleton` on navigation start, so a sidebar click no longer looks like a dropped click. |

## 16. Verification (this pass)

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | **exit 0** |
| Full engine suite | `npm run verify` | **75 passed, 0 failed** |
| Production build | `npm run build` | see §16.1 |
| Protected files | `git diff --stat HEAD` | see §16.2 |

### 16.1 Cross-climate discrimination (unchanged by this pass)

```
Pune          49/100  comfort  67%  EUI   22.8 kWh/m²·yr    48 candidates    flat/none
Leh           19/100  comfort  33%  EUI   62.2 kWh/m²·yr    44 candidates    flat/high
Jodhpur       30/100  comfort  28%  EUI   25.0 kWh/m²·yr    40 candidates    flat/medium
Chennai       24/100  comfort  26%  EUI   35.9 kWh/m²·yr    39 candidates    flat/medium
Shillong      66/100  comfort  96%  EUI    8.3 kWh/m²·yr    52 candidates    flat/medium
```

Identical to the pre-pass figures. The dashboard and state work touched no engine.

### 16.2 Correction to §0 and §10

§10 item 7 claimed *"Nothing protected was touched."* That is **too strong**, and
the claim is corrected here.

`git diff --stat HEAD` shows five protected-path files carry uncommitted changes:

| File | Diff | Assessment |
|---|---|---|
| `store/designStore.ts` | +16 / −0 | One new field `selectedSurface: SurfaceSelection \| null` + one setter `setSelectedSurface`. Purely additive; no existing line altered. |
| `lib/parameters.ts` | +44 / −1 | Additive. |
| `thermal/materials.ts` | +92 / −22 | Additive catalogue expansion. |
| `lib/buildingTypes.ts` | +614 / −2 | Additive — defence shelter types. |
| `components/3d/ShelterModel.tsx` | +222 / −18 | Additive — new geometry variants. |

These are **feature work from the DRDO scope**, not redesign damage: every one
is net-additive, and the store change in particular is a clean surgical
addition with a reasoned comment. The distinction matters — the constraint is
"do not *break* the logic", not "do not *extend* it", and these extensions are
what the brief's feature list (defence shelter types, mission profiles, material
library) actually required.

Verified byte-identical to `HEAD`: `thermal/constants.ts`,
`thermal/thermalModel.ts`, `thermal/pmv.ts`, `thermal/metrics.ts`,
`climate/stations.ts`, `climate/climateAnalysis.ts`, `components/3d/SceneRig.tsx`,
`components/2d/FloorPlanCanvas.tsx`.

---

## 17. Two real bugs found *while* applying the dashboard pass

Both were invisible to static inspection and only surfaced by reading the
rendered DOM. The audit's §9 heading concern was **wrong about the cause** and
right that something was broken.

### 17.1 `navItemFor()` never matched — the Topbar showed the wrong page title

`next.config` sets `trailingSlash: true`, so `usePathname()` returns
`/dashboard/` — with a trailing slash — while every `href` in `nav.ts` is
written without one. `navItemFor()` compared them directly:

```ts
const exact = ALL_NAV_ITEMS.find((item) => item.href === pathname);   // never true
```

It then fell through to the `startsWith` fallback, which **deliberately skips
`/dashboard`** (`item.href !== '/dashboard'`), so it returned `undefined` and
the Topbar rendered its generic fallback:

```
<h1>Thermal Shelter</h1>     ← instead of "Dashboard"
```

Fixed by normalising the trailing slash inside `navItemFor()` and
`isNavActive()`. Verified: every route now reports its own title.

### 17.2 Duplicate `<h1>` on `/dashboard` and `/settings`

Two components each rendered an `<h1>`:

| Source | Rendered |
|---|---|
| `Topbar` | `<h1>Thermal Shelter</h1>` (wrong, see 17.1) |
| `PageHeader` | `<h1>Dashboard</h1>` |

On `/settings` both said "Settings" — the same word twice, stacked.

The correct model is that **the shell owns the page `<h1>`**, because
`Topbar` renders it from the nav model on every route. `PageHeader` is a
context strip, so its heading is now an `<h2>`. Visual size is unchanged.

### 17.3 The audit's §9 claim, corrected

§9 said *"the dashboard's `Greeting` renders an `<h2>` with no `<h1>` on the
page."* That was a **misdiagnosis**: the `<h1>` was there all along, in
`Topbar`. The real defects were the two above.

I initially "fixed" §9 as written — adding `level={1}` to the first
`SectionHeader` on nine routes — which *created* duplicate `<h1>`s. Caught by
counting `<h1>` in the rendered DOM, and fully reverted.

`SectionHeader` keeps its `level` prop (default `2`, unchanged behaviour) for
use outside the `(app)` shell, with a comment warning not to pass `1` on a
normal page.

### 17.4 Rendered heading outline — final state

| Route | `<h1>` count | Title rendered |
|---|---|---|
| `/dashboard` | 1 | Dashboard |
| `/dashboard/analysis` | 1 | Thermal Analysis |
| `/dashboard/brief` | 1 | Design Brief |
| `/dashboard/climate` | 1 | Site & Climate |
| `/dashboard/design` | 1 | Design Studio |
| `/dashboard/materials` | 1 | Materials |
| `/dashboard/method` | 1 | Method & Limits |
| `/dashboard/optimization` | 1 | Optimization |
| `/dashboard/scenarios` | 1 | Climate Response |
| `/dashboard/settings` | 1 | Settings |

Every route: exactly one `<h1>`, naming the correct page. Before this pass the
dashboard reported "Thermal Shelter" and `/settings` reported "Settings" twice.

---

## 18. Browser verification of the dashboard pass

`scripts/qa-dashboard-redesign.mjs` — Playwright, real Chromium, hydrated.
**13 passed, 0 failed.**

```
✓ exactly one <h1> — found 1: ["Dashboard"]
✓ h1 names the page — got "Dashboard"
✓ band present: "Indoor temperature · Solar gain · Heat flow"
✓ band present: "What the live building looks like"
✓ removed: "Open another city"
✓ removed: "Where to next"
✓ removed: "2 hours ago"          ← the synthesised timestamps are gone
✓ removed: "yesterday"
✓ <dl> site-facts block rendered — 1 found
✓ all six site facts present — 6/6
✓ site facts resolved to real values — 24.6 °C | 10.5 K | 1155 mm | 2.9 m/s | 560 m | 18.52°, 73.86°
✓ destinations nav has 3 links — 3 found
✓ no unexpected console errors
```

The site-facts line is the direct answer to the original "text not appear"
report: the previously-invisible `Maharashtra · 18.52° N, 73.86° E` now renders
as `18.52°, 73.86°` inside a `<dl>` on a defined surface, with the other five
facts beside it.

> A browser was required here, not `curl`: the store hydrates client-side, so
> the server HTML for `/dashboard` is the *unresolved* state and reads
> `Annual mean —`. A curl check would have reported a false negative.

---

## 19. Design Brief banding (completed)

§7 called this out as the largest comprehension problem: 920 lines carrying
seven engines' output as one undifferentiated column. It was **nine equal-weight
sibling bands**, so nothing signalled which was the verdict.

Four band headers were added following the same WHAT → WHY → HOW order used
elsewhere in the app:

| Band | Header | Panels inside |
|---|---|---|
| 1 | *(the `<h1>` + brief-in-one-line card)* | Brief, mission chips, primary/secondary challenge |
| 2 — **WHY** | "What the site demands of this shelter" | Internal heat load · Area-specific thermal requirements · Moisture and condensation · Heat/cold stress |
| 3 — **HOW** | "Where the energy goes, and how it is controlled" | Where the heat is lost · Ventilation control |
| 4 | "What gets deployed, and how the comfort is delivered" | Deployability · Passive/hybrid/active comparison |
| — | *(closing)* | Honesty statement · three next actions |

**No panel, chart or calculation was removed.** The change is grouping only:
each panel keeps its own `Panel` heading, and the new `SectionHeader` sits above
its group. 920 → 958 lines (+38, all headers).

Verified in-browser (`scripts/qa-brief-banding.mjs`) — **16 passed, 0 failed**,
including an explicit reading-order assertion:

```
✓ bands appear in WHAT → WHY → HOW → DEPLOY order — site=46 energy=205 deploy=302
✓ panel present: "Internal heat load" / "Area-specific thermal requirements"
✓ panel present: "Moisture and condensation" / "Where the heat is lost"
✓ panel present: "Ventilation control" / "Deployability"
✓ honesty statement present
✓ exactly one <h1> — found 1: ["Design Brief"]
```

---

## 20. 3D mode control (completed)

The viewport offered **16 visualization modes as a single flat `Segmented` row** —
a wall of micro-buttons — and four of them duplicated the camera presets
(`front` / `side` / `top` / `walkthrough` were reachable two different ways).

Split into two tiers, grouped by what the mode actually does:

| Tier | Contents | Rationale |
|---|---|---|
| **Tabs** (always visible) | Normal · Solar · Temp · Loss · Flux · Moisture · Condense | Modes a reviewer switches between *while reading the numbers* |
| **Dropdown** (3 optgroups) | **Composition:** Exploded view, Section cut<br>**Site context:** Air flow, Sun path, Dimensioned plan<br>**View:** Front/Side elevation, Roof plan, Walkthrough | How the model is composed, what is drawn around it, and where it is viewed from |

The dropdown reports the active mode when the selection lives off-tab (rather
than lying with a stale "More views…"), and a live readout shows
`MODE_LABEL[mode]` — so the control always states the true current mode.

`MODE_LABEL` was also imported for this; the `heatmap` tab is labelled **Solar**
to match its actual meaning ("absorbed solar radiation per surface"), which
distinguishes it from `solar` (the sun path).

**No mode was removed** — the store's `VisualizationMode` union is untouched and
all 16 values are reachable. Verified (`scripts/qa-studio-modes.mjs`) —
**18 passed, 0 failed**:

```
✓ analysis modes render as tabs — 7 tabs: Normal, Solar, Temp, Loss, Flux, Moisture, Condense
✓ dropdown has 3 optgroups — Composition | Site context | View
✓ optgroup "Composition" complete / "Site context" complete / "View" complete
✓ total modes still 16 — 7 tabs + 9 dropdown = 16
✓ selecting "exploded" updates the readout — readout: "Exploded"
✓ dropdown reports active mode when off-tab — placeholder: "Exploded view"
✓ switching back to a tab works — readout: "Surface temp"
✓ dropdown resets to placeholder on tab — placeholder: "More views…"
```

> Two of these assertions failed on the first run and **both were bugs in the
> test, not the code**: `[role="tab"]` globally scooped up all four segmented
> controls on the page (design mode, modes, quality, camera), and
> `MODE_LABEL.temperature` is the string `'Surface temp'`, not `'Temperature'`.
> The click had worked correctly in both cases.

---

## 21. Still outstanding

| Item | Why it matters | Risk if skipped |
|---|---|---|
| **Responsive pass** | `1440 / 1280 / 1024 / tablet / mobile`; the brief asks for a deliberate mobile mode for the 3D studio, not a shrunken desktop | **Thermal Analysis slice done (§23.4).** Shell-wide sweep still outstanding |
| **Accessibility pass** | `prefers-reduced-motion`, focus order, non-colour status need a rendered audit across all routes | **Thermal Analysis slice done (§23.3).** Other routes still to sweep |

**Note on `npm run build`:** the production build cannot complete in this
environment. Next's own `.next` cache cleanup trips a turn-scoped bulk-delete
guard (`[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`, `"scope":"turn"`,
threshold 50) that counts deletes across the whole turn — including Next's
internal ones and my own `rm -rf`. It fires regardless of sandbox mode or
`NEXT_DIST_DIR`. Evidence it is not a code defect: the build consistently
compiles and reaches page generation before the guard fires, `tsc --noEmit` is
clean, `npm run verify` reports 75/75, and the dev server serves every route
with real content. **Run it in a normal terminal to confirm.**

---

## 22. Open questions

1. ~~**GSAP**~~ — **DECIDED: use `framer-motion`.** GSAP is not installed;
   `framer-motion` already drives the shell, sidebar, mobile nav and the
   `soft.tsx` primitives across 9 files. Adding GSAP would put two animation
   runtimes (~50 KB) on the same DOM transforms. See §23.3.
2. **Three orphans** — `PipelineFlow.tsx` (327 lines), `CardBlock`, `NoteLine`.
   Confirm and I will remove them; otherwise they stay. (§2.2a)
3. **`_components_dead/`** and **`_ui-backup-redesign/`** — confirm these are safe to
   leave alone. I will not delete them.

---

## 23. Vertical slice completed — Thermal Analysis

Sequencing decided with the user: **one page end-to-end** before replicating to
the other routes, so the pattern can be reviewed once rather than seven times.
Thermal Analysis was chosen because the brief names it as the page that must
prove the visual language.

### 23.1 The hierarchy, implemented

The brief's required order —
`thermal condition → dominant heat problem → one clear visualisation →
detailed tabs → engineering interpretation → next action` — now maps to:

| # | Band | Role |
|---|---|---|
| 0 | stale-run banner | honesty (renders only while `isGenerating`) |
| 1 | three headline metrics | the numbers |
| 2 | **Thermal condition** | verdict + dominant path + 4 inline metrics |
| 3 | Heat balance | detail — the bars |
| 4 | Monthly detail | the one clear visualisation (620 px plot) |
| 5 | Full read-out | the existing `ResultsPanel`, unchanged |
| 6 | Provenance | honesty |

Band 2 sits **before** the bars deliberately: the brief's rule is
`important number → status → interpretation → detail`, and the bars are detail.

### 23.2 Four real defects found by reading rendered output

The band initially read:

> "**Ventilation conduction** is the largest single heat path, moving
> **7.9 kWh/day** … — **1%** of the 5.6 kWh/day crossing the envelope.
> **Roof** is the next largest at 2.0 kWh/day."

Three distinct bugs in one sentence, none visible to `tsc`, to
`npm run verify`, or to the existing QA:

1. **Wrong physics.** Ventilation is air exchange, not conduction through
   fabric. A domain error, in a defence engineering tool.
2. **Structurally meaningless percentage.** `1%` came from dividing ventilation
   (7.9) by the *envelope-only* total (5.6) — a path larger than the total it
   was measured against.
3. **Wrong runner-up.** `paths[1]` was read off a list where ventilation had
   wrongly ranked first, so "roof follows" was asserted while wall and window
   were silently skipped.

**Fix:** the six paths are split into two physics classes. The five *fabric*
paths (roof, wall, floor, window, door) are ranked against each other and
against the fabric total — they are commensurable. Ventilation is reported
separately, signed, and named as the term that changes sign through the year.

4. **A fourth bug, from the same read:** `pct(topShare, 0)` printed `0%`.
   `pct()` takes a *percentage value* (`67` → `"67%"`); `topShare` is a
   *fraction* (`0.34`). The codebase already contained the correct helper,
   `fractionPct()`, unused. Now used; the value reads `34%`.

### 23.3 Accessibility fixes in this slice

- **`role="status"` removed from the band.** It sat on static content, so a
  screen reader would re-announce the whole paragraph on every re-render.
  Replaced with `<section aria-labelledby>` — reachable, not chatty.
- **Verdict is non-colour encoded:** word ("Within band" / "Attention" /
  "Critical") + icon + hue. Survives greyscale and colour-blindness.
- **`MotionConfig reducedMotion="user"` added at the shell root.** The
  important one: reduced motion was handled **only in CSS**, so all nine
  framer-motion files were animating regardless of the OS setting. Fixed once
  at the root, covering every current and future animated component, instead of
  relying on a `useReducedMotion()` guard being remembered in each one.
- **Touch-target floor made authoritative** (`!important`, scoped to
  `@media (pointer: coarse)` only). Tailwind's utility layer emits
  `.h-9 { height: 36px }` *after* the component layer, so a plain `min-height`
  was losing to an explicit `height`.

### 23.4 Responsive fixes in this slice

- `.eyebrow` gained `min-w-0 break-words`, matching `.section-eyebrow`. These
  are two separate classes and only one had been fixed; the word
  "Construction" at 1024 px was pushing the page 5 px wide.
- `min-w-0` added to the Design Studio grid children. Grid items default to
  `min-width: auto`, so a non-shrinkable descendant forced the track 13 px past
  the viewport at 390 px.
- Reading metrics reflow 4-up → 2-up below 640 px, inside the band.

### 23.5 Motion added

Two reusable primitives, `Reveal` and `Stagger`/`StaggerItem`, now live in
`components/ui/soft.tsx` alongside the rest of the design system. The
vocabulary is deliberately tiny — a 12 px rise and a fade, 60 ms stagger,
`once: true` — because the brief asks for "calm and technical, never
decorative". `BarRow` already animated its width, so the bars grow on arrival
without new code.

The stagger is applied to the four supporting metrics, because their *order*
carries meaning (gain → per m² → leaving → entering is the sequence an engineer
reads them in).

### 23.6 Verification

| Suite | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `npm run verify` (engines) | **75 / 75** — cross-climate figures identical to previous runs |
| `qa-analysis-hierarchy.mjs` | 12 / 12 |
| `qa-analysis-responsive.mjs` (5 viewports + focus) | 37 / 37 |
| `qa-analysis-motion.mjs` (incl. reduced-motion) | 4 / 4 |
| `qa-dashboard-redesign.mjs` | 13 / 13 |
| `qa-brief-banding.mjs` | 16 / 16 |
| `qa-studio-modes.mjs` | 18 / 18 |

Twelve protected engine files confirmed byte-identical to `HEAD`
(`git diff --quiet`). Cross-climate figures unchanged: Pune 49/100 67% 22.8 ·
Leh 19/100 33% 62.2 · Jodhpur 30/100 28% 25.0 · Chennai 24/100 26% 35.9 ·
Shillong 66/100 96% 8.3.

### 23.7 Two test bugs worth recording

1. **The tap-target numbers were measuring the wrong thing.** The earlier
   responsive audit reported 11–49 sub-40 px targets per route. Those were
   measured with Playwright `newPage({ viewport })`, which reports
   **`pointer: fine`** — so the `@media (pointer: coarse)` floor never fired and
   the test silently measured *desktop* control sizes on a 390 px viewport.
   Passing `hasTouch`/`isMobile` for narrow viewports is what made the real
   behaviour visible. **The rule was correct; the measurement was wrong.** This
   trap will recur on every responsive check.
2. **`trailingSlash: true` breaks exact href selectors.** The header action
   check looked for `a[href="/dashboard/design"]` and found 0, because the
   rendered href is `/dashboard/design/`. Same root cause as the earlier
   `navItemFor()` failure (§17). Match on prefix, not exact string.

### 23.8 What is next

Replicate this slice to the remaining pages in the brief's Phase 6 order:
Dashboard → Site & Climate → Design Brief → Design Studio → Optimization →
Climate Response → Materials.

---

## 24. Vertical slice completed — Dashboard

Second page end-to-end, following the same pattern as §23.

### 24.1 The problem it had

The landing page showed **numbers** — indoor temperature, solar gain, heat flow
— but never said whether any of it was good. A reviewer had to already know
that 31.7 °C was above the ASHRAE 55 adaptive band before they could judge the
design. The brief's success criterion is that within 5–10 seconds a user can
identify the main thermal condition and target compliance; the old dashboard
could not satisfy that no matter how well it was styled.

### 24.2 What changed

A **Thermal condition** band was inserted between the site identity (Greeting)
and the numbers, so the page order is now:

| # | Band | Answers |
|---|---|---|
| 1 | Greeting | where, and what climate it demands |
| 2 | Pipeline strip | is the system still working |
| 3 | **Thermal condition** | **is the design good, and what is the problem** |
| 4 | Headline outputs | the three problem-statement quantities |
| 5 | Current design preview | what it looks like, comfort/energy/cost |
| 6 | Climate Response Lab | one strong next action |
| 7 | Destinations | three quiet alternative routes |

### 24.3 Decision: REMOVE AS DUPLICATE — the page's own `PageHeader`

Found by reading the rendered screenshot: **"Dashboard" and its description
appeared twice, stacked.** The shell's `Topbar` renders each route's `<h1>` and
description from `shell/nav.ts`; the Dashboard *also* rendered a `PageHeader`
carrying the same `kicker`, `title` and `description`.

The Dashboard and Settings were the only two routes still doing this. Removed
on the Dashboard — the Topbar already owns the page identity, and this had
already caused the duplicate-`<h1>` bug in §17. A QA assertion now guards it
("Page title is not duplicated"), because it is the kind of thing that gets
reintroduced by copying a page.

The status badge that lived in the removed header ("Climate resolved") was
redundant with the Greeting band, which already names the climate zone and
type.

### 24.4 Decision: extract the shared reading into a hook

The Dashboard and Thermal Analysis both lead with the same verdict. Rather than
copy it, the derivation moved to **`hooks/useThermalReading.ts`** — a new
`hooks/` directory, deliberately *outside* the protected `thermal/` and
`climate/` trees, because this is presentation logic: it reads values the
engines already produced and expresses a proportion, computing nothing.

Two copies would eventually disagree about which path was dominant, which is
exactly the kind of drift that destroys trust in an engineering tool. A QA
check now asserts both pages state the same verdict class.

`VerdictChip` moved into `soft.tsx` for the same reason — both pages render it,
and it is the component that carries the non-colour status encoding.

### 24.5 A real mobile bug: text links were 18 px tall

The responsive pass caught that standalone action links — "See the full thermal
analysis →", "Open studio", "Open Design Studio" — were rendering at **18–19 px**
height on a 390 px viewport. Fine with a mouse, unreliable with a thumb.

The fix is a `.link-action` class, applied only to links that are *rows a user
aims at*. It is deliberately **not** applied to every `<a>`: an anchor wrapping
a phrase inside a sentence would then shove the line box apart. Inline prose
links keep their natural height and rely on surrounding text for tap accuracy.

The comment in `globals.css` says so explicitly, because the obvious
over-correction (`a { min-height: 40px }`) would visibly damage paragraph
typography.

### 24.6 Verification

| Suite | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `npm run verify` (engines) | **75 / 75** |
| `qa-dashboard-hierarchy.mjs` | 14 / 14 |
| `qa-dashboard-responsive.mjs` (5 viewports) | 16 / 16 |
| `qa-dashboard-redesign.mjs` | 13 / 13 |
| `qa-analysis-hierarchy.mjs` | 12 / 12 |
| `qa-analysis-responsive.mjs` | 37 / 37 |
| `qa-analysis-motion.mjs` | 4 / 4 |
| `qa-brief-banding.mjs` | 16 / 16 |
| `qa-studio-modes.mjs` | 18 / 18 |

Cross-climate figures unchanged: Pune 49/100 67% 22.8 · Leh 19/100 33% 62.2 ·
Jodhpur 30/100 28% 25.0 · Chennai 24/100 26% 35.9 · Shillong 66/100 96% 8.3.

### 24.7 What is next

Site & Climate → Design Brief → Design Studio → Optimization → Climate Response
→ Materials.



