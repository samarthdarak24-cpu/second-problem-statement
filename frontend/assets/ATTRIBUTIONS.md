# Attributions

This document records the open-source software, data sources, algorithms and
**investigated third-party 3D assets** that **Thermal Shelter** builds upon.

**No external 3D model, texture, font or GLB asset is bundled with this
project.** The building geometry is generated procedurally in code. Section 2
records the asset repositories that were investigated, the licence found for
each, and the decision taken — so that the "no imported assets" position is a
documented finding rather than an omission.

---

## 1. Open-source software

| Project | Licence | Used for |
| --- | --- | --- |
| [Next.js](https://nextjs.org/) | MIT | React application framework, routing, build. |
| [React](https://react.dev/) / [react-dom](https://react.dev/) | MIT | UI. |
| [Three.js](https://threejs.org/) | MIT | WebGL rendering of the parametric model. |
| [@react-three/fiber](https://github.com/pmndrs/react-three-fiber) | MIT | React renderer for Three.js. |
| [@react-three/drei](https://github.com/pmndrs/drei) | MIT | Camera controls, grid, helpers. |
| [Recharts](https://recharts.org/) | MIT | Results charts. |
| [Framer Motion](https://www.framer.com/motion/) | MIT | Marketing-page transitions. |
| [lucide-react](https://lucide.dev/) | ISC | Icon set (no icon-font dependency). |
| [Leaflet](https://leafletjs.com/) / [react-leaflet](https://react-leaflet.js.org/) | BSD-2-Clause | Site/location picker map. |
| [clsx](https://github.com/lukeed/clsx) | MIT | Conditional class names. |
| [TypeScript](https://www.typescriptlang.org/) | Apache-2.0 | Type safety. |

All of the above are redistributed under their own permissive licences; nothing
here is copied into this repository's source tree.

---

## 2. Third-party 3D assets — investigation and decision

The brief asked that openly licensed architectural assets be investigated and
used where useful, with every included asset documented. Five repositories were
examined. The findings are recorded in full, including the ones that were
**rejected**, because "we checked and could not use it" is a materially
different statement from "we did not check".

### 2.1 Repositories examined

| # | Repository | Author / owner | Licence found | Assets offered | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 | [`mikeypikey7/modular-home-configurator`](https://github.com/mikeypikey7/modular-home-configurator) | mikeypikey7 | **None — no `LICENSE` file in the repository** | React + Three.js procedural massing, materials, floor plans, walkthrough | **Rejected.** No licence means all rights reserved by default. Nothing may be copied. Used only as a conceptual reference for "geometry separated from physics", which is an idea and not a copyrightable work. |
| 2 | [`ch-bas/threejs-sims-house-builder`](https://github.com/ch-bas/threejs-sims-house-builder) | Bassem Chagra | **MIT** | Procedural walls, floors, roofs, windows, doors, interior layout | **Reference only.** Licence permits reuse, but the code targets a *different* problem (a free-form house editor with no physics). No code copied; the repository is credited below. |
| 3 | [`JaronKBragg7337/asset-pack-ue-threejs-blender-unity`](https://github.com/JaronKBragg7337/asset-pack-ue-threejs-blender-unity) ("ModKit") | Jaron K. Bragg | **CC0 1.0 Universal** (public domain, no attribution required) | Modular building kit — walls, window walls, doors, pillars, stairs, roofs, parapets — in GLB / FBX / `.blend` | **Not needed.** Licence is clean and the kit is genuinely suitable for a *static* building. See 2.2 for why a static kit does not serve this project. |
| 4 | [`SpectraStudios/SourceCityToolkit_glb`](https://github.com/SpectraStudios/SourceCityToolkit_glb) | Spectra Studios | **CC0 1.0 with a stated exception** | Apartment blocks, market courtyard, night market, rooftop, intersection scenes (`.glb`) | **Rejected.** The repository states that models containing textures derived from photographs from Textures.com are **excluded from the CC0 grant** — those photographs "may not be redistributed by default". The exception is not mapped to individual files, so no asset in the pack can be shown to be unambiguously CC0. Per the brief ("If an external asset does not have a clear licence, do not include it"), nothing was taken. |
| 5 | [`ToxSam/open-source-3d-assets`](https://github.com/ToxSam/open-source-3d-assets) | ToxSam | **Registry metadata: CC0 1.0.** Individual assets: per-collection, must be read from `projects.json` | An index of 991+ GLB models with licence and download metadata | **Not needed.** This is a *registry*, not an asset set. It was useful for confirming that no better-fitting architectural asset exists under a clean licence; the Polygonal Mind collections it indexes are environments and props, not climate-responsive envelopes. |

### 2.2 Why no external mesh is bundled

The decisive reason is architectural, not legal:

> **A static mesh cannot answer the optimiser.**

The whole claim of this project is that the building on screen is the building
the numbers were computed for. If the search recommends a 21 % window-to-wall
ratio, a 0.45 m overhang, or a second storey, then the window-to-wall ratio,
the overhang and the storey count have to change *in the mesh*. A downloaded
`.glb` of a house has those decisions baked into its vertices. Bolting one on
would produce a picture that no longer corresponds to the thermal model — which
is exactly the failure mode the rest of this codebase is built to prevent.

So every element that the optimiser can move is generated:

| Element | How it is generated | Source file |
| --- | --- | --- |
| Walls, with real holes cut for each opening | 2D outline extruded with holes (`ExtrudeGeometry`) | `components/3d/geometry.ts` |
| Roofs — flat, shed, gable, hip, vaulted | A sampled height field over the plan | `components/3d/geometry.ts` |
| Floor slabs, one per storey | Box geometry per `floorSlabs` entry | `components/3d/geometry.ts` |
| Parapets, partitions, module joints | Extruded frames and boxes | `components/3d/geometry.ts` |
| Shading devices — overhang, louvre, blind, fin, verandah | Decomposed into boxes in wall-local space | `components/3d/geometry.ts` |
| Wall and roof surface patterns | Procedurally drawn to a cached canvas | `components/3d/textures.ts` |
| Site, sky, fog, ground, human-scale figure | Procedural geometry and shaders | `components/3d/environment.tsx` |

This is why the repository ships with zero binary assets and an `assets/`
directory containing only this file.

### 2.3 If an asset is ever added

An asset may be added only if **all** of the following hold, and it must be
recorded in the table in 2.4:

1. It has an unambiguous licence permitting redistribution (CC0, MIT,
   Apache-2.0, BSD, or an explicit public-domain dedication).
2. It is a *detail* that the optimiser never moves — furniture, vegetation, a
   street fixture, a ground texture.
3. Its licence text is reproduced in `assets/licenses/`.
4. Its source URL, author and the exact file it is used in are recorded below.

An asset that fails (1) is not added regardless of how well it fits.

### 2.4 Bundled assets

**None.** There are no third-party binary assets in this repository.

| Asset name | Source repository | Author | URL | Licence | Used in |
| --- | --- | --- | --- | --- | --- |
| *(none)* | — | — | — | — | — |

---

## 3. Climate data

- **Live reanalysis** is fetched from the
  [Open-Meteo](https://open-meteo.com/) archive API (ERA5). Open-Meteo is free
  for non-commercial use and requires no API key. Monthly normals are aggregated
  by this app from the daily archive.
- **Offline mode** falls back to a bundled monthly-normals database shipped with
  the app, so the tool runs with no network connection. The database is clearly
  labelled as a model input in the UI and is never presented as a measurement.

## 4. Solar geometry

- Sun position (declination, equation of time, altitude, azimuth) follows the
  **NOAA Solar Calculator** algorithm. The same solar direction drives both the
  on-screen shadows and the thermal model's solar gain, so the picture and the
  physics cannot disagree.

## 5. Map tiles

- If the location picker renders map tiles, they are
  [OpenStreetMap](https://www.openstreetmap.org/copyright) data, used under the
  OpenStreetMap contributor terms.

## 6. Reference implementations

This project was informed by two reference codebases during design:

- [`mikeypikey7/modular-home-configurator`](https://github.com/mikeypikey7/modular-home-configurator)
  — **no licence file**; used only to validate the *approach* of a parametric
  massing engine driven by a parameter object. No code, asset or text copied.
- [`ch-bas/threejs-sims-house-builder`](https://github.com/ch-bas/threejs-sims-house-builder)
  — MIT, © Bassem Chagra. Used only to validate the approach of procedural
  wall/roof geometry in React Three Fiber. No code copied.

All geometry and physics in this repository is original code.

## 7. Algorithmic building blocks

- Adaptive comfort uses **ASHRAE 55** running-mean adaptive limits.
- Conditioned comfort uses **ISO 7730** PMV/PPD.
- Optimisation uses a curated coordinate-descent search over a building-type
  palette; an optional ML surrogate (gradient-boosted model trained on the
  physics engine's own output) screens candidates and is shown *separately* and
  labelled as a prediction, never as a simulated result.
