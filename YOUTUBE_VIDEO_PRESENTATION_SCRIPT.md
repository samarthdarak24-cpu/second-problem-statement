# 🎬 YouTube Video Presentation Script (3.5 – 4 Minutes)

> **Project:** Climate-Responsive Area-Specific Shelter Simulation Platform  
> **Problem Statement ID:** SIH26051 (DRDO / Ministry of Defence)  
> **Video Title:** *Designing Zero-Fuel Thermal Shelters for Ladakh | SIH26051 DRDO Solution Walkthrough*  
> **Target Duration:** 3 Minutes 30 Seconds to 4 Minutes  
> **Format:** Screen Recording + Voiceover Narration + Live UI Demonstration  

---

## 📌 YouTube Video Metadata

* **Recommended Title:**  
  `Zero-Fuel Passive Thermal Shelters for Ladakh (SIH26051) | DRDO Solution Full Walkthrough`
* **Video Description:**  
  ```text
  Full walkthrough and live demonstration of our software platform developed for Smart India Hackathon (SIH26051) sponsored by DRDO.
  
  THE CORE STORY:
  1. The Problem: A conventional shelter sent to different regions fails in extreme climates like Ladakh. With intense daytime sun (>1000 W/m²) but freezing nights (-20°C to -30°C), uninsulated shelters rapidly lose captured heat, forcing troops to burn 20+ litres of kerosene daily.
  2. What DRDO Wants: Instead of physically building 10 prototype shelters and testing them, DRDO needs software to simulate Design A vs B vs C, predict thermal performance before construction, and recommend optimal passive shelter designs.
  3. Our Solution: Ingests real climate data (Leh, Dras, Kargil, Nyoma), creates a live parametric 3D model, runs continuous 24h heat flow & solar simulations, and delivers the 3 DRDO-mandated outputs: transient indoor temperature, solar thermal energy, and component heat flow breakdowns.

  Timestamps:
  0:00 - The SIH Problem in One Simple Story (Leh Paradox)
  0:40 - What DRDO Wants: Simulation Before Construction
  1:10 - Climate Engine & Ladakh Defense Stations (Leh, Dras, Kargil, Nyoma)
  1:40 - The 3 Mandatory HERO Outputs (24h Temp, Solar Gain, Component Heat Loss)
  2:15 - Parametric 3D Twin & Unlocked Sliders (Auto AI vs Manual Mode)
  2:45 - 3D FEA Simulation Modes (Solar, Temp, Loss, Flux, Walkthrough)
  3:15 - Design Comparison (A vs B vs C) & Multi-Objective Optimization
  3:45 - 1-Click Engineering Dossier & Real-World Impact
  ```
* **Tags:**  
  `Smart India Hackathon, SIH2026, SIH26051, DRDO, Ladakh, Dras, Kargil, Nyoma, Passive Solar Architecture, Thermal Comfort, High Altitude Shelter, ThreeJS, Energy Simulation, Defense Innovation`

---

## 🕒 Video Timeline & Screen Recording Guide

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                            YOUTUBE VIDEO DEMO TIMELINE                                      │
├───────────────┬────────────────────────────────┬────────────────────────────────────────────┤
│ Timestamp     │ Video Segment                  │ Visual On-Screen Action                    │
├───────────────┼────────────────────────────────┼────────────────────────────────────────────┤
│ 0:00 – 0:40   │ The Problem in One Story       │ Full-screen Design Studio / PS Audit modal │
│ 0:40 – 1:10   │ What DRDO Wants: Simulation    │ Topbar, workflow tabs, architecture view   │
│ 1:10 – 1:40   │ Climate Engine & Ladakh Data   │ Click [DRDO Leh Benchmark] in topbar       │
│ 1:40 – 2:15   │ The 3 Mandatory Outputs (HERO) │ Zoom into 24h temp curve, solar gain, flow │
│ 2:15 – 2:45   │ Parametric 3D & Unlocked Mode  │ Switch to Manual Mode, drag sliders        │
│ 2:45 – 3:15   │ 3D FEA Heat Transfer Modes     │ Switch modes: Solar → Temp → Loss → Flux   │
│ 3:15 – 3:45   │ Design Comparison (A vs B vs C)│ Compare baseline vs optimized passive      │
│ 3:45 – 4:00   │ Engineering Report & Outro     │ Click View Report / Export PDF dossier     │
└───────────────┴────────────────────────────────┴────────────────────────────────────────────┘
```

---

## 🎙️ Complete Voiceover & Screen Recording Script

---

### Segment 1: The SIH Problem in One Simple Story (0:00 – 0:40)
**Visual on Screen:**  
Start on the live dashboard (`http://localhost:3000/dashboard/design/`). Click the red **`[SIH26051 PS Audit]`** button in the top right so the modal opens with the official DRDO problem statement details visible.

**Voiceover Narration:**  
> *"Think of the SIH Problem Statement 26051 in one simple story:
> 
> Imagine DRDO has to build a shelter for soldiers in Leh, Ladakh. Historically, the same generic shelter design—thin metal walls, low insulation, and flat roofs—gets shipped to different locations.
> 
> But Ladakh has an extreme microclimate:
> * ☀️ **During the daytime**: At 3,500 meters altitude, intense solar radiation (>1,000 W/m²) hits the shelter, heating it up.
> * 🌙 **At night**: The thin, dry Himalayan atmosphere causes severe radiative cooling. Outdoor temperatures plunge to **$-20^\circ\text{C}$ and even $-30^\circ\text{C}$**.
> 
> Because the shelter has thin insulation and generic windows, all that captured heat immediately escapes through the roof, walls, and openings. Soldiers are left freezing and must burn **15 to 25 litres of kerosene daily** in *bukhari* stoves.
> 
> Airlifting this fuel to forward outposts costs over ₹200 to ₹300 per litre, and toxic fumes create constant carbon monoxide poisoning and fire hazards. This is the exact crisis SIH asks us to solve."*

---

### Segment 2: What DRDO Wants (0:40 – 1:10)
**Visual on Screen:**  
Close the modal. Pan across the clean, modern dual-pane workspace: parameter sliders on the left (35%) and the procedural 3D model on the right (65%).

**Voiceover Narration:**  
> *"What does DRDO want?  
> DRDO essentially wants software that can answer:
> 
> *'Before I construct this shelter in a particular location, what design, orientation, and materials should I use so that the interior stays thermally comfortable with minimum external fuel?'*
> 
> Instead of physically building 10 shelters in high-altitude terrain and testing them by trial-and-error:
> Design A ─┐  
> Design B ─┼→ Computer Simulation → Compare → Optimal Design  
> Design C ─┘  
> 
> Our software simulates the complete physics before a single brick or panel is laid."*

---

### Segment 3: Climate Engine & Ladakh Defense Stations (1:10 – 1:40)
**Visual on Screen:**  
Move the cursor to the top action bar. Hover over and click the red badge: **`[DRDO Leh Benchmark]`**. The UI smoothly resolves the station. Click the city dropdown to reveal Ladakh coverage: **Leh, Dras, Kargil, and Nyoma**.

**Voiceover Narration:**  
> *"Our software begins with the **Area-Specific Climate Engine**.
> 
> Clicking `[DRDO Leh Benchmark]` loads authenticated climatological normals for Ladakh at 3,500m elevation. We also incorporate data for:
> * **Dras**—the 2nd coldest inhabited place on earth at $-35^\circ\text{C}$,
> * **Kargil** with its valley wind funnels, and
> * **Nyoma** at 4,180m near the LAC.
> 
> The engine resolves hourly dry-bulb temperatures, direct and diffuse solar irradiance, relative humidity, and wind vectors across all 12 months."*

---

### Segment 4: The 3 Mandatory SIH Outputs — THE HERO (1:40 – 2:15)
**Visual on Screen:**  
Scroll down to the **`Mandatory SIH26051 Outputs`** section placed immediately below the 3D model. Hover over each card and chart.

**Voiceover Narration:**  
> *"This brings us to the core of our solution—the **3 outputs explicitly mandated by DRDO**:
> 
> 1. **Output 1 — 24-Hour Predicted Indoor Temperature**:  
>    Outside in Leh, temperatures swing across a 15-degree band down to $-14.5^\circ\text{C}$. But inside our simulated shelter, the passive thermal mass damps **87% of the swing**, keeping indoor temperatures stable between $+10^\circ\text{C}$ and $+15^\circ\text{C}$ without active heaters!
> 
> 2. **Output 2 — Solar Thermal Energy Generation**:  
>    The system tracks solar radiation entering through high-altitude glazing: **30.8 kWh/day**, covering **65% of the shelter's total heat loss**.
> 
> 3. **Output 3 — Component-by-Component Heat Flow Breakdown**:  
>    The software tells DRDO exactly where the heat goes:
>    * Roof: $-13.41\,\text{kWh/day}$
>    * Windows: $-15.66\,\text{kWh/day}$
>    * Walls: $-7.11\,\text{kWh/day}$
>    * Ventilation: $-9.04\,\text{kWh/day}$
>    The engineer immediately sees that insulating the roof and adding double glazing provides the highest thermal return."*

---

### Segment 5: Parametric 3D Digital Twin & Unlocked Sliders (2:15 – 2:45)
**Visual on Screen:**  
On the left **Parameter Panel**, show the **Control Mode Toggle**:
1. Click **`[Manual Mode (Customise All)]`** or click **`[Unlock]`** on Envelope (10), Form (6), or Ventilation (5).
2. Point out that all 21+ sliders are live.
3. Drag the **Orientation slider** to 180° (South).
4. Increase **Insulation thickness** to 0.12m.
5. In the 3D viewport, watch the geometry and materials update smoothly.

**Voiceover Narration:**  
> *"Our 3D model is not a static drawing—it is a **living parametric digital twin**:
> * In **Auto Mode**, the AI optimizer automatically chooses the optimal envelope.
> * With one click, the engineer can switch to **Manual Mode** to unlock all 21+ parameters across Envelope, Form, and Ventilation.
> * Watch what happens when we rotate the shelter South or increase wall insulation:  
>   The 3D model updates in real time, the U-values recalculate, and the 24-hour thermal simulation updates instantly on the fly!"*

---

### Segment 6: 3D Heat Transfer Visualization Modes (2:45 – 3:15)
**Visual on Screen:**  
In the 3D viewport control bar, click through the 7 visualization modes:  
**Solar → Temp → Loss → Flux → Walkthrough**.  
Show the 60fps color-ramped thermal heat maps and particle convective flows.

**Voiceover Narration:**  
> *"To give defense engineers complete physical insight, our WebGL viewport includes 7 animated analysis modes:
> * **Solar Mode**: Visualizes direct sunbeam penetration and sun path tracking.
> * **Temp Mode**: Displays finite-element surface temperature heat maps from blue (cold exterior) to warm amber (cozy interior).
> * **Loss & Flux Modes**: Animate heat escaping through thermal bridges, showing exactly where insulation is needed.
> * **Walkthrough Mode**: Allows an inspector to step inside the shelter and verify troop bunk layouts and thermal comfort zones."*

---

### Segment 7: Design Comparison & Optimization (3:15 – 3:45)
**Visual on Screen:**  
Switch to the **Design Comparison & Optimization** section. Show the comparison table between Design A (Conventional Tin), Design B (Standard), and Design C (DRDO Passive Solar).

**Voiceover Narration:**  
> *"Now comes the decisive step: **Design Comparison and Optimization**.
> 
> Under identical Leh weather conditions, our software compares:
> * **Design A (Uninsulated Tin Shed)**: Indoor $-10^\circ\text{C}$, burns 22L fuel/day.
> * **Design B (Standard Brick/RCC)**: Indoor $+2^\circ\text{C}$, high heat loss.
> * **Design C (DRDO Passive Solar)**: South-facing, PUF insulation, Trombe wall, and night shutters. Indoor $+14^\circ\text{C}$, zero fuel required!
> 
> Our multi-objective optimizer automates this search across thousands of configurations to find the optimal trade-off between thermal comfort, airlift payload weight, and transport logistics."*

---

### Segment 8: Engineering Report & Outro (3:45 – 4:00)
**Visual on Screen:**  
Click **`[View Engineering Report]`** or open `/dashboard/scenarios`. Show the exportable defense report with complete Bill of Materials, equations, and logistical fuel savings.

**Voiceover Narration:**  
> *"Finally, with a single click, our software exports a comprehensive **Engineering Dossier** complete with thermal equations, compliance with NBC 2016 and ASHRAE 55, and fuel savings of **₹3.3 Lakhs per post annually**.
> 
> This is our solution for Smart India Hackathon PS-51: enabling DRDO to design high-altitude shelters that protect our soldiers with zero external energy.
> 
> Thank you for watching! Check out our GitHub repository and live demo link in the description below."*
