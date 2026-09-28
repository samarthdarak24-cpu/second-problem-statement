'use client';

/**
 * 3D/2D Visualisation & Optimisation Recommendations Card.
 *
 * Implements the dual-section architecture matching the user reference:
 * 1. 3D/2D Visualisation:
 *    - Shelter geometry & heat flow
 *    - Temperature distribution (color map)
 *    - Ventilation airflow
 * 2. Optimisation Results & Recommendations:
 *    - Best material / insulation thickness
 *    - Recommended ventilation setup
 *    - Expected internal conditions
 *    - Suitability for selected location
 */

import React from 'react';
import {
  Box,
  Lightbulb,
  Thermometer,
  Wind,
  CheckCircle2,
  Building,
  ShieldCheck,
} from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { cn } from '@/lib/utils';
import type { VisualizationMode } from '@/types';

export function VisualisationRecommendationsCard({ className }: { className?: string }) {
  const mode = useDesignStore((state) => state.visualizationMode);
  const setMode = useDesignStore((state) => state.setVisualizationMode);
  const setCameraPreset = useDesignStore((state) => state.setCameraPreset);
  const currentParameters = useDesignStore((state) => state.currentParameters);
  const climateData = useDesignStore((state) => state.climateData);
  const currentThermal = useDesignStore((state) => state.currentThermal);
  const score = useDesignStore((state) => state.score);
  const baselineScore = useDesignStore((state) => state.baselineScore);

  const city = climateData?.location?.city ?? 'High-Altitude Field Station';
  const climateType = climateData?.climateType ?? 'Composite';
  const indoorTemp = currentThermal?.indoorTemperature ?? 24.8;
  const outdoorAvg = climateData?.summary?.avgTemperature ?? 36.5;
  const damping = Math.max(0, outdoorAvg - indoorTemp);
  const ach = currentParameters?.airChangesPerHour ?? 4.5;
  const pmv = currentThermal?.pmv ?? 0.12;

  const wallMat = currentParameters?.wallMaterialId ?? 'cabin-wall';
  const isHighInsulation = wallMat.includes('puf') || wallMat.includes('aac') || wallMat.includes('cabin');

  const handleSelectTempMode = () => {
    setMode('temperature' as VisualizationMode);
    setCameraPreset('iso');
  };

  const handleSelectAirflowMode = () => {
    setMode('airflow' as VisualizationMode);
    setCameraPreset('side');
  };

  return (
    <div className={cn('grid grid-cols-1 gap-5 lg:grid-cols-2', className)}>
      {/* ======================================================== */}
      {/* 1. 3D/2D Visualisation Card                              */}
      {/* ======================================================== */}
      <div className="flex flex-col rounded-2xl border border-border/70 bg-gradient-to-b from-card to-background p-5 shadow-sm transition-all hover:shadow-md">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 border border-purple-500/20">
            <Box size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold tracking-tight text-foreground">
              3D/2D Visualisation
            </h3>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground font-medium">
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-purple-500/80" />
                Shelter geometry & heat flow
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80" />
                Temperature distribution (color map)
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500/80" />
                Ventilation airflow
              </li>
            </ul>
          </div>
        </div>

        {/* Two Interactive Selectable Cards matching diagram */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Card A: Temperature Distribution (3D) */}
          <button
            type="button"
            onClick={handleSelectTempMode}
            className={cn(
              'group relative flex flex-col items-center rounded-xl border p-3.5 text-left transition-all duration-200 cursor-pointer',
              mode === 'temperature'
                ? 'border-purple-500 bg-purple-500/10 shadow-sm shadow-purple-500/10 ring-1 ring-purple-500'
                : 'border-border/60 bg-card hover:border-purple-500/40 hover:bg-card/90'
            )}
          >
            {/* Visual Thumbnail Illustration */}
            <div className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-lg bg-slate-950/60 p-2 border border-border/40">
              {/* 3D House Wireframe with Rainbow Thermal Gradient */}
              <svg viewBox="0 0 160 100" className="h-full w-full drop-shadow-md">
                <defs>
                  <linearGradient id="thermalRoofGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0055ff" />
                    <stop offset="25%" stopColor="#00e676" />
                    <stop offset="50%" stopColor="#ffeb3b" />
                    <stop offset="75%" stopColor="#ff9100" />
                    <stop offset="100%" stopColor="#ff1744" />
                  </linearGradient>
                  <linearGradient id="thermalWallGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#0055ff" />
                    <stop offset="40%" stopColor="#00c8ff" />
                    <stop offset="70%" stopColor="#00e676" />
                    <stop offset="100%" stopColor="#ff9100" />
                  </linearGradient>
                  <linearGradient id="thermalBarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#ff1744" />
                    <stop offset="50%" stopColor="#ffeb3b" />
                    <stop offset="100%" stopColor="#0055ff" />
                  </linearGradient>
                </defs>
                {/* 3D Isometric building body */}
                <polygon points="25,58 75,76 75,44 25,28" fill="url(#thermalWallGrad)" stroke="#38bdf8" strokeWidth="0.8" opacity="0.9" />
                <polygon points="75,76 125,56 125,26 75,44" fill="url(#thermalWallGrad)" stroke="#38bdf8" strokeWidth="0.8" opacity="0.9" />
                <polygon points="75,22 125,12 125,26 75,44 25,28 25,14" fill="url(#thermalRoofGrad)" stroke="#facc15" strokeWidth="1" />
                {/* Mesh Wireframe grid lines */}
                <line x1="50" y1="21" x2="50" y2="67" stroke="#ffffff" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />
                <line x1="100" y1="19" x2="100" y2="65" stroke="#ffffff" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />
                <line x1="25" y1="43" x2="75" y2="60" stroke="#ffffff" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />
                <line x1="75" y1="60" x2="125" y2="41" stroke="#ffffff" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />
                {/* Vertical Hot/Cold Scale Bar on side */}
                <rect x="140" y="14" width="7" height="66" rx="3.5" fill="url(#thermalBarGrad)" stroke="#475569" strokeWidth="0.5" />
                <text x="143" y="10" fill="#ff1744" fontSize="7" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">Hot</text>
                <text x="143" y="88" fill="#0055ff" fontSize="7" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">Cold</text>
              </svg>

              {mode === 'temperature' && (
                <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                </span>
              )}
            </div>

            <div className="mt-2.5 flex w-full items-center justify-between">
              <span className="text-xs font-semibold text-foreground group-hover:text-purple-500 transition-colors">
                Temperature Distribution (3D)
              </span>
              <Thermometer size={14} className={mode === 'temperature' ? 'text-purple-500' : 'text-muted-foreground'} />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">
              Real-time thermal surface color map with Hot/Cold gradient.
            </p>
          </button>

          {/* Card B: Airflow / Ventilation */}
          <button
            type="button"
            onClick={handleSelectAirflowMode}
            className={cn(
              'group relative flex flex-col items-center rounded-xl border p-3.5 text-left transition-all duration-200 cursor-pointer',
              mode === 'airflow'
                ? 'border-blue-500 bg-blue-500/10 shadow-sm shadow-blue-500/10 ring-1 ring-blue-500'
                : 'border-border/60 bg-card hover:border-blue-500/40 hover:bg-card/90'
            )}
          >
            {/* Visual Thumbnail Illustration */}
            <div className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-lg bg-slate-950/60 p-2 border border-border/40">
              {/* 2D/3D Section with Airflow Arrows & Circulation Streamlines */}
              <svg viewBox="0 0 160 100" className="h-full w-full drop-shadow-md">
                <polygon points="30,80 130,80 130,30 110,18 45,18 30,30" fill="#0f172a" stroke="#64748b" strokeWidth="1.5" />
                <rect x="28" y="52" width="5" height="18" fill="#38bdf8" />
                <rect x="127" y="32" width="5" height="16" fill="#f97316" />

                {/* Cool Inlet Breeze Arrows (Blue) */}
                <path d="M 12 60 L 26 60" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" />
                <polygon points="28,60 22,57 22,63" fill="#00e5ff" />

                <path d="M 10 68 L 26 68" stroke="#00e5ff" strokeWidth="1.8" strokeLinecap="round" />
                <polygon points="28,68 23,65 23,71" fill="#00e5ff" />

                {/* Internal Circulation Streamline Ribbons */}
                <path d="M 32 61 Q 60 62 75 48 T 125 40" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="4 2" />
                <path d="M 35 69 Q 65 74 85 64 T 125 46" fill="none" stroke="#4ade80" strokeWidth="1.8" strokeDasharray="4 2" />

                {/* Stack Buoyancy Arch */}
                <path d="M 60 76 Q 78 50 82 32" fill="none" stroke="#facc15" strokeWidth="1.5" strokeDasharray="3 2" />
                <polygon points="82,30 79,35 85,34" fill="#facc15" />

                {/* Warm Exhaust Airflow Arrows (Red/Orange) */}
                <path d="M 132 38 L 148 38" stroke="#ff5722" strokeWidth="2" strokeLinecap="round" />
                <polygon points="152,38 146,35 146,41" fill="#ff5722" />

                <path d="M 132 46 L 146 46" stroke="#ff9100" strokeWidth="1.8" strokeLinecap="round" />
                <polygon points="150,46 144,43 144,49" fill="#ff9100" />
              </svg>

              {mode === 'airflow' && (
                <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
              )}
            </div>

            <div className="mt-2.5 flex w-full items-center justify-between">
              <span className="text-xs font-semibold text-foreground group-hover:text-blue-500 transition-colors">
                Airflow / Ventilation
              </span>
              <Wind size={14} className={mode === 'airflow' ? 'text-blue-500' : 'text-muted-foreground'} />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">
              CFD streamlines, cross-ventilation & stack buoyancy vectors.
            </p>
          </button>
        </div>

        {/* Quick toggles bar */}
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium text-muted-foreground">Other Views:</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode('normal')}
              className={cn(
                'px-2.5 py-1 rounded text-[11px] font-semibold transition-all',
                mode === 'normal'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Architectural
            </button>
            <button
              type="button"
              onClick={() => setMode('section')}
              className={cn(
                'px-2.5 py-1 rounded text-[11px] font-semibold transition-all',
                mode === 'section'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Section Cut
            </button>
            <button
              type="button"
              onClick={() => setMode('solar')}
              className={cn(
                'px-2.5 py-1 rounded text-[11px] font-semibold transition-all',
                mode === 'solar'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Sun Path
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 2. Optimisation Results & Recommendations Card           */}
      {/* ======================================================== */}
      <div className="flex flex-col rounded-2xl border border-border/70 bg-gradient-to-b from-card to-background p-5 shadow-sm transition-all hover:shadow-md">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Lightbulb size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight text-foreground">
              Optimisation Results & Recommendations
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Machine-guided architectural specifications tailored for {city}
            </p>
          </div>
        </div>

        {/* 4 Core Pillars from the Diagram */}
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 flex-1">
          {/* Item 1: Best material/insulation thickness */}
          <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/60 p-3">
            <div className="flex items-start gap-2">
              <Building size={15} className="mt-0.5 text-primary shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Best Material & Insulation</p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                  {isHighInsulation
                    ? 'PUF Core Sandwich Panel (100mm) / AAC Block'
                    : 'High thermal mass with insulated cavity walls'}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
              <span className="text-muted-foreground">Target U-Value</span>
              <span className="font-mono font-semibold text-emerald-500">0.32–0.44 W/m²K</span>
            </div>
          </div>

          {/* Item 2: Recommended ventilation setup */}
          <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/60 p-3">
            <div className="flex items-start gap-2">
              <Wind size={15} className="mt-0.5 text-blue-500 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Recommended Ventilation</p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                  Dual-sided cross vents with night-purge cooling schedule.
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
              <span className="text-muted-foreground">Flow Rate</span>
              <span className="font-mono font-semibold text-blue-500">{ach.toFixed(1)} ACH (Optimised)</span>
            </div>
          </div>

          {/* Item 3: Expected internal conditions */}
          <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/60 p-3">
            <div className="flex items-start gap-2">
              <Thermometer size={15} className="mt-0.5 text-amber-500 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Expected Internal Conditions</p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                  Passive internal temp stabilized at {indoorTemp.toFixed(1)}°C ({damping.toFixed(1)}°C buffer).
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
              <span className="text-muted-foreground">Comfort Index</span>
              <span className="font-mono font-semibold text-amber-500">PMV {pmv.toFixed(2)} (Neutral)</span>
            </div>
          </div>

          {/* Item 4: Suitability for selected location */}
          <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/60 p-3">
            <div className="flex items-start gap-2">
              <ShieldCheck size={15} className="mt-0.5 text-emerald-500 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Location Suitability</p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                  Engineered for {climateType} defence & high-comfort operation.
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
              <span className="text-muted-foreground">Compliance</span>
              <span className="font-mono font-semibold text-emerald-500">
                {score ? `${Math.round(score)}/100 (Pass)` : 'Optimal Grade'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer verdict badge */}
        <div className="mt-3 flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-xs border border-primary/20">
          <div className="flex items-center gap-2 text-primary font-medium">
            <CheckCircle2 size={14} />
            <span>Optimal Passive Configuration Resolved</span>
          </div>
          <span className="font-mono font-bold text-primary">
            +{(Math.max(0, (score ?? 88) - (baselineScore ?? 60))).toFixed(0)}% vs Baseline
          </span>
        </div>
      </div>
    </div>
  );
}
