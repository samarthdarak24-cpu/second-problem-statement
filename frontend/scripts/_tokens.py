import io

path = 'app/globals.css'
src = io.open(path, encoding='utf-8').read()

start = src.index('/* ============================================================\n   Design tokens')
end_marker = '  * {\n    @apply border-border;\n  }'
end = src.index(end_marker)

new_tokens = '''/* ============================================================
   DESIGN TOKENS — restrained engineering palette

   ONE accent, ONE neutral ramp, semantics only when they mean something.

   WHY THERE IS NO SECOND COLOUR
   The previous revision carried a "pastel" set — blue, lavender, pink,
   mint, peach, yellow — used as card surfaces. It made every screen look
   like a different product, and it competed with the one place colour
   actually carries information: the thermal charts and the 3D model.

   So there is exactly one brand accent (terracotta) and one warm neutral
   ramp. Hierarchy is built from elevation, hairline borders, whitespace
   and type weight — not from tint. Colour is spent in three places only:

     1. the primary action and the active nav state (terracotta)
     2. semantic status — good / warning / critical (green / amber / red)
     3. the scientific thermal ramp, which lives in charts and the 3D view
        and is never used as page decoration

   `--info` is a desaturated slate, reserved for the COLD end of a
   temperature reading. It is not a decorative blue: nothing in this
   interface is blue unless it is telling you something is cold.

   NEVER COLOUR ALONE
   Every status in the UI pairs its colour with a label, an icon, a number
   or a sentence. The tokens below support that rule; they do not replace it.
   ============================================================ */
@layer base {
  :root {
    /* ---- Surfaces: a warm neutral ramp, four steps, no hue ---- */
    --background: 36 24% 98%; /* #FBFAF8 warm off-white canvas */
    --panel: 0 0% 100%; /* #FFFFFF raised surface — panels, cards */
    --card: 0 0% 100%;
    --surface-sunken: 36 22% 96%; /* #F7F5F2 inset block, table stripe */
    --surface-well: 34 18% 92%; /* #EFEBE5 track, well, inactive segment */
    --popover: 0 0% 100%;

    /* ---- Ink ---- */
    --foreground: 24 10% 10%; /* #1C1917 deep warm charcoal */
    --card-foreground: 24 10% 10%;
    --popover-foreground: 24 10% 10%;
    --muted-foreground: 27 9% 43%; /* #786F68 secondary text */
    --subtle-foreground: 27 8% 56%; /* #9A928B tertiary, captions, units */

    /* ---- The single accent: terracotta.
       Every primary action, every active nav item, every focus ring. ---- */
    --primary: 18 68% 44%; /* #BD5224 */
    --primary-foreground: 40 40% 99%;
    --primary-soft: 18 62% 96%; /* tint for an active row, never a card */

    /* ---- Neutral secondary ---- */
    --secondary: 36 18% 94%;
    --secondary-foreground: 24 12% 20%;
    --muted: 36 18% 95%;

    /* ---- Semantic. Only when it means something. ---- */
    --success: 158 46% 30%; /* #296E56 good / within target */
    --success-soft: 158 40% 95%;
    --success-foreground: 0 0% 100%;
    --warning: 35 85% 38%; /* #B4740E warning / marginal */
    --warning-soft: 38 80% 95%;
    --warning-foreground: 0 0% 100%;
    --destructive: 0 62% 44%; /* #B62B2B critical / failing */
    --destructive-soft: 0 60% 96%;
    --destructive-foreground: 0 0% 100%;
    /* Cold. Semantic only — the low end of a temperature reading. */
    --info: 205 42% 40%; /* #3C6B93 desaturated slate */
    --info-soft: 205 40% 95%;
    --info-foreground: 0 0% 100%;

    --border: 30 14% 88%; /* #E5E0DA hairline */
    --border-strong: 30 12% 80%; /* #D5CEC6 emphasised divider */
    --input: 36 18% 94%;
    --ring: 18 68% 44%;

    --radius: 0.5rem;

    /* ---- Motion. Calm and short: this is instrumentation, not a toy. ---- */
    --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
    --dur-fast: 120ms;
    --dur-base: 180ms;
    --dur-slow: 320ms;
    --dur-reveal: 520ms;

    /* ---- Elevation. Borders and layering first, shadow second. ---- */
    --shadow-hairline: 0 1px 2px 0 hsl(24 20% 20% / 0.04);
    --shadow-raised: 0 1px 2px 0 hsl(24 20% 20% / 0.05), 0 4px 12px -6px hsl(24 20% 20% / 0.08);
    --shadow-float: 0 2px 4px 0 hsl(24 20% 20% / 0.06), 0 12px 28px -10px hsl(24 20% 20% / 0.16);

    /* ---- Engineering surfaces.
       Dark, desaturated charcoal-slate, for the 3D studio viewport and
       data-dense instrument panels. It reads as equipment, not as a theme. */
    --engineering: 220 14% 13%; /* #1D2129 */
    --engineering-raised: 220 13% 17%; /* #262B33 */
    --engineering-border: 220 10% 27%; /* #3D444E */
    --engineering-foreground: 36 20% 96%; /* #F5F3F0 */
    --engineering-muted: 220 9% 63%; /* #969DA7 */

    --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
    --font-display: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
    --font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo,
      Consolas, monospace;

    /* ---- Scientific thermal ramp.
       Warm, cool-to-hot, no blue: sage → olive → sand → amber → orange → rust.
       Confined to charts, the 3D model and the thermal legend. This is the
       one place a full colour range is allowed, because here the colour IS
       the data. ---- */
    --thermal-0: #6b7f6a;
    --thermal-1: #8fa07a;
    --thermal-2: #c9b267;
    --thermal-3: #e0a03c;
    --thermal-4: #d2701f;
    --thermal-5: #a8391a;

    /* Stage accents for the input→output pipeline. A warm ramp, so the
       chain reads as a progression rather than as four categories. */
    --stage-input: 28 10% 42%; /* stone */
    --stage-analysis: 18 68% 44%; /* terracotta */
    --stage-optimize: 35 85% 38%; /* amber */
    --stage-output: 158 46% 30%; /* deep green */
  }

'''

src = src[:start] + new_tokens + src[end:]
io.open(path, 'w', encoding='utf-8').write(src)
print('tokens replaced')
