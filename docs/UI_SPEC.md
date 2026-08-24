# UI specification

## Visual reference

Primary reference: [Assemble / Onsemble](https://www.onassemble.com/), inspected on 24 August 2026.

The product should borrow its visual grammar, not copy its brand, assets, layout, or content. The healthcare application must remain clinically calm, accessible, and optimized for dense operational workflows.

## Reference traits to carry forward

- Near-white canvas with strong black typography and restrained neutral grays.
- Oversized, tightly composed headings on public and onboarding surfaces.
- Pale acid-lime highlights used sparingly for emphasis, focus, and a small number of active states.
- Dark charcoal pill buttons with concise labels and directional arrow icons.
- Fine gray grids and calendar lines as a recurring scheduling motif.
- Large product surfaces with generous corner radii, thin borders, and diffused shadows.
- Small tactile floating objects or healthcare glyphs on marketing/auth screens only.
- Crisp, minimal navigation and substantial whitespace.

## Healthcare adaptation

| Reference behavior | Healthcare interpretation |
|---|---|
| Calendar-led hero | Appointment calendar and availability become the visual anchor |
| Floating objects | Subtle calendar, prescription, message, and check-up tokens; no stock medical illustrations |
| Acid-lime highlight | Active slot, current step, keyboard focus, and low-risk success emphasis |
| Dark pill CTA | Primary actions such as Book appointment, Confirm slot, Complete visit |
| Thin project timeline | Daily schedule, appointment history, reminder timeline |
| Spacious marketing layout | Calm patient portal and onboarding |
| Dense product preview | Faster doctor/admin operational views |

## Design tokens

Initial targets for Gemini to refine in the design system:

```css
:root {
  --canvas: #fbfbf8;
  --surface: #ffffff;
  --ink: #111111;
  --ink-muted: #626262;
  --line: #e7e7e2;
  --accent: #efff72;
  --accent-strong: #dff34d;
  --danger: #b42318;
  --warning: #9a6700;
  --success: #26734d;
  --radius-control: 999px;
  --radius-panel: 24px;
  --shadow-panel: 0 24px 70px rgb(17 17 17 / 8%);
}
```

Clinical status colors must retain readable text contrast and must not rely on color alone. The lime accent is decorative/interactive—not the sole warning or success signal.

## Typography

- Use a modern grotesk sans serif with excellent UI legibility and a licensed web delivery path.
- Public headings: very bold, compact line height, responsive rather than fixed oversized text.
- Application body: neutral, slightly softened, with tabular numerals for dates and times.
- Doctor/admin tables prioritize scan speed over dramatic scale.

## Motion and spatial depth

Antigravity effects are allowed only where they improve orientation or delight without slowing care tasks:

- Public/auth screens may use restrained floating tokens and soft parallax.
- Dashboard panels may use a subtle elevation change on hover, never strong tilts.
- Booking-step transitions should be short and directional.
- No scroll hijacking, continuously animated shadows, or motion-dependent content.
- Honor `prefers-reduced-motion`; every flow must remain complete with animation disabled.
- Avoid glassmorphism on forms, clinical summaries, tables, and any content where transparency reduces readability.

## Shared shell

All portals use the same typography, token set, controls, icon language, and spacing scale. Density changes by role:

- Patient: calm, spacious, guided.
- Doctor: fast, timeline-led, information-dense.
- Admin: operational, table-driven, bulk-action aware.

Desktop navigation uses a compact header or sidebar according to task density. Mobile navigation keeps the primary role actions within thumb reach.

## Patient information architecture

- Dashboard: upcoming appointment, medication reminders, recent visit summaries, quick booking.
- Find doctors: search, specialization filters, availability-aware cards.
- Doctor profile: credentials, specialization, working schedule, available slots.
- Booking wizard: Doctor → Time → Symptoms → Review → Confirmation.
- Appointment detail: status, countdown for active hold, reschedule/cancel actions, integration status where relevant.
- Visit summary: plain-language notes, structured medication plan, follow-up steps.

## Doctor information architecture

- Today timeline with available time, patient identity, symptom brief, and urgency.
- Appointment workspace with AI pre-visit brief alongside original symptoms.
- Visit notes that always preserve the original input.
- Structured prescription editor for medication, dosage, frequency, dates, and instructions.
- Completion review before the visit is finalized.

## Admin information architecture

- Overview with appointment and integration health.
- Doctor CRUD and working-hours management.
- Leave management with affected-appointment preview and explicit confirmation.
- Appointment operations.
- Notification health for email, calendar, LLM, and retry state.

## Core components

- Application shell, role-aware navigation, command/search entry.
- Timeline calendar, slot picker, slot-hold countdown.
- Doctor card, appointment row/card, status badge, empty state, skeleton.
- Stepper, validated form controls, dialogs, confirmation sheets, toasts.
- Data table with responsive alternate presentation.
- Structured prescription editor and medication schedule preview.
- Integration-health summary and retry-state detail.

Use shadcn/ui primitives, Tailwind CSS, Radix behavior, Lucide icons, TanStack Query, React Hook Form, Zod, date-fns, Sonner, and Recharts where needed. Do not add a competing component framework.

## Accessibility and safety

- Meet WCAG 2.2 AA for implemented flows.
- Full keyboard operation, visible focus, semantic headings, explicit labels, and accessible error summaries.
- Minimum 44 × 44 px touch targets on mobile.
- Never expose sensitive clinical details in toast notifications or dashboard previews unnecessarily.
- Confirmation language must distinguish cancel, reschedule, mark leave, and complete visit.
- Urgency labels are informational and may not present generated output as a diagnosis.

## Gemini Antigravity handoff boundary

Gemini owns only `apps/web/**`. It may read `docs/**` and the generated client, but it must not change backend logic, database schemas, API contracts, or generated client internals. It should begin with mocked typed fixtures and replace them through the generated client during integration.

Deliver responsive patient, doctor, and admin views using the same design system, including loading, empty, error, offline/retry, and reduced-motion states.
