# 🏆 SIH26051 — 3-Minute Pitch & Presentation Script

> **Problem Statement ID:** SIH26051  
> **Title:** Software Based Model Development for Design of Area Specific Shelter for Thermal Comfort Maintenance  
> **Organization:** Defence Research and Development Organisation (DRDO), Ministry of Defence  
> **Target Duration:** Exactly 3 Minutes (180 Seconds)  
> **Format:** Spoken Pitch + Live Screen Demonstration  

---

## 💡 The Core Story in One Sentence

* **The Problem:** *"How can we design a shelter specifically for the climate of a particular area so that it maintains thermal comfort without excessive external energy?"*
* **Our Solution:** *"Our software takes the area's climate and shelter parameters, creates a live parametric 3D shelter, simulates solar energy and heat flow over time, predicts 24h indoor temperatures, compares alternative designs, and identifies the optimal area-specific passive shelter configuration."*

---

## ⏱️ Presentation Timeline at a Glance

| Time | Story Step | On-Screen Action | Key Talking Points |
| :--- | :--- | :--- | :--- |
| **0:00 – 0:45** | **1. The SIH Story & What DRDO Wants** | Design Studio & PS Modal | The Leh paradox: 1 shelter sent everywhere fails. DRDO wants simulation before construction. |
| **0:45 – 1:15** | **2. Our Solution & Ladakh Climate Data** | Topbar & Station Dropdown | Ingesting real climate data for Leh, Dras (-35°C), Kargil, and Nyoma (4,180m). |
| **1:15 – 2:00** | **3. The 3 Mandatory HERO Outputs** | Core Simulation Results | 1) 24h Indoor Temp, 2) Solar Thermal Energy, 3) Component Heat Loss breakdown. |
| **2:00 – 2:35** | **4. Parametric 3D & Comparison A vs B vs C** | 3D Viewport & Parameter Sliders | Moving sliders dynamically changes 3D model & physics. Auto AI vs Manual mode. |
| **2:35 – 3:00** | **5. Optimization & 1-Click Engineering Dossier** | Optimization & PDF Report | Baseline vs Optimized results, ₹3.3L fuel logistics saved, exportable defense report. |

---

## 🎤 Verbatim Spoken Script with Exact Screen Actions

---

### [0:00 – 0:45] Step 1: The Problem in One Simple Story
*(Tone: Engaging, crystal clear, authoritative)*

**Action on Screen:**  
Start on the live dashboard (`http://localhost:3000/dashboard/design/`). Click the red **`[SIH26051 PS Audit]`** button in the header so the modal opens with the DRDO problem statement details.

**Spoken Script:**  
> "Respected Jury members,
>
> Think of the SIH problem in one simple story:
> 
> Imagine DRDO has to build a shelter for soldiers in Leh, Ladakh. Historically, the same generic shelter design—thin corrugated tin walls, low insulation, large unshaded windows—gets shipped to different locations.
>
> But Leh is unique:
> * ☀️ **During the day**: The high-altitude sun brings intense solar radiation (>1,000 W/m²), warming up the shelter.
> * 🌙 **At night**: Outdoor temperatures plunge to **$-20^\circ\text{C}$ to $-30^\circ\text{C}$**, and all that captured heat immediately escapes through the walls, roof, and openings.
> 
> Soldiers are left freezing and must burn **15 to 25 litres of kerosene daily** in bukhari stoves, risking deadly carbon monoxide poisoning and costing ₹200+ per litre in airlift logistics.
>
> **What does DRDO want?**  
> DRDO wants software that answers: *'Before I physically construct 10 shelters and test them by trial-and-error, what geometry, orientation, and materials should I use so that the shelter stays thermally comfortable with minimum external heating?'*
>
> That is exactly what our platform solves."

---

### [0:45 – 1:15] Step 2: Climate Engine with Full Ladakh Microclimates
*(Tone: Confident, technical, engineering-focused)*

**Action on Screen:**  
Close the modal. Point to the topbar site selector. Click the red **`[DRDO Leh Benchmark]`** badge. Open the city selector to show Ladakh's forward defense stations (**Leh, Dras, Kargil, Nyoma**).

**Spoken Script:**  
> "Our platform takes four inputs: **Location, Climate, Geometry, and Materials**.
> 
> In the topbar, we click `[DRDO Leh Benchmark]`. The platform instantly ingests verified climatological normals for Ladakh:
> * **Leh** (3,500m elevation, cold desert),
> * **Dras** (3,280m, the 2nd coldest inhabited place on earth at $-35^\circ\text{C}$),
> * **Kargil** (valley wind corridors), and
> * **Nyoma** (4,180m high-altitude LAC forward base).
> 
> The climate engine calculates hourly solar radiation, dry-bulb temperatures, relative humidity, and wind vectors across all 12 months."

---

### [1:15 – 2:00] Step 3: The 3 Mandatory SIH Outputs — THE HERO
*(Tone: High energy, pointing directly to the 3 hero cards on screen)*

**Action on Screen:**  
Scroll down to the **`Mandatory SIH26051 Outputs`** section placed immediately below the 3D model.

**Spoken Script:**  
> "This is where our system directly answers DRDO’s three mandated deliverables:
>
> 1. **Output 1 — 24-Hour Indoor Temperature vs Time**:  
>    Outside in Leh, the temperature swings by 15°C down to $-14.5^\circ\text{C}$. But inside our simulated shelter, the passive thermal mass damps **87% of the outdoor swing**, holding the interior at a stable, livable temperature without active heating.
> 
> 2. **Output 2 — Solar Thermal Energy Generation vs Time**:  
>    The system calculates exactly how much useful energy enters through the glazing and opaque fabric: **30.8 kWh/day**, covering **65% of the shelter's gross heat loss**.
> 
> 3. **Output 3 — Component-by-Component Heat Flow Breakdown**:  
>    Instead of a black-box number, DRDO sees where every kilowatt-hour goes:
>    * Walls: $-7.11\,\text{kWh/day}$
>    * Roof: $-13.41\,\text{kWh/day}$
>    * Windows: $-15.66\,\text{kWh/day}$
>    * Ventilation: $-9.04\,\text{kWh/day}$
>    The engineer instantly knows the roof and windows are the primary heat leak paths!"

---

### [2:00 – 2:35] Step 4: Parametric 3D Model & Design Comparison (A vs B vs C)
*(Tone: Demonstrative, interactive)*

**Action on Screen:**  
On the left **Parameter Panel**, show the **Control Mode Toggle**:
1. Click **`[Manual Mode (Customise All)]`** or click **`[Unlock]`** on the Envelope group.
2. Drag the **Orientation slider** to 180° (South).
3. Drag **Insulation thickness** from 0.05m to 0.15m.
4. In the 3D viewport, click through the 3D visualization modes: **Solar → Temp → Loss → Flux → Walkthrough**.

**Spoken Script:**  
> "Notice how our 3D model is not just a visual picture—it is **parametric and directly connected to the physics**:
> * We provide dual control: **Auto Mode** where the AI optimizer solves the envelope, and **Manual Mode** where all 21+ sliders are completely unlocked.
> * As we increase insulation or rotate the shelter South, the 3D geometry updates in real-time, the U-values recalculate, and the 24-hour temperature curve instantly updates.
> * We can inspect the physics using our 7 visual modes: **Solar exposure, Temperature gradient, Envelope Heat Loss, and Heat Flux**.
> 
> In our **Design Comparison module**, DRDO can test:
> * **Design A** (Uninsulated Tin Shed): Indoor $-10^\circ\text{C}$, fuel-dependent.
> * **Design B** (Standard Brick/RCC): Indoor $+2^\circ\text{C}$, high heat loss.
> * **Design C** (DRDO Passive Solar with composite PUF + Trombe wall): Indoor $+14^\circ\text{C}$, zero fuel required."

---

### [2:35 – 3:00] Step 5: Optimization, Fuel Savings & Defense Report
*(Tone: Concluding, impactful, inspiring)*

**Action on Screen:**  
Navigate to `/dashboard/scenarios` or click **`[View Engineering Report]`**. Show the automated PDF/dossier generation with complete Bill of Materials and fuel logistical savings.

**Spoken Script:**  
> "Instead of the engineer manually testing hundreds of combinations, our **Multi-Objective Optimization Engine** explores the parameter space and recommends the ideal balance between thermal comfort, payload weight, and transport cost.
>
> **The Real-World Defense Impact:**
> * **Fuel Savings**: Eliminates 18 litres of kerosene per shelter per day, saving over **₹3.3 Lakhs annually per post** in airlift logistics.
> * **Troop Safety**: Zero risk of carbon monoxide poisoning or bunker fires.
> * **Validation**: Verified across **52 automated scientific checks** and 36 meteorological stations.
> 
> With one click, the software generates a comprehensive **Engineering Dossier** ready for military procurement and deployment.
> 
> Thank you, and we welcome your questions!"

---

## 💡 Quick Q&A Cheat-Sheet for Judges

* **Q: Why does the 3D model matter?**  
  *A:* It is a parametric digital twin. When an engineer changes window size or wall thickness, the 3D model updates its geometry, and the thermal engine immediately recalculates the solar gain, envelope conduction, and 24h temperature.
* **Q: How is the climate data handled?**  
  *A:* We support offline pre-computed normals for high-altitude defense locations (Leh, Dras, Kargil, Nyoma) plus live Open-Meteo ERA5 reanalysis via latitude/longitude anywhere on Earth.
* **Q: What are the 3 mandatory SIH outputs?**  
  *A:* 1) Predicted Indoor Temperature vs Time (24h diurnal curve), 2) Thermal Energy from Solar Radiation vs Time (kWh/day), and 3) Heat Flow through Envelope and Openings (kWh/day broken down by walls, roof, floor, windows, and ventilation).
