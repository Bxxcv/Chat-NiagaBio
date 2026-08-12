# MASTER PROMPT — NiagaBio Chatbot

Act as Senior Full-Stack Engineer + UX Engineer + Supabase Architect.

## Context
Core NiagaBio:
- https://niaga-bio.vercel.app
- https://github.com/Bxxcv/NiagaBio
- HTML/CSS/Vanilla JS + Supabase.

Build a NEW chatbot backend in a NEW Supabase project. Do not touch the core DB schema.

## Frontend
- HTML/CSS/Vanilla JS.
- Mobile-first.
- Use `niagabio_chat_widget.html` as the UI/UX source of truth.
- Preserve its visual character: green gradient header, bot avatar, quick options, typing indicator, onboarding, composer, menu.
- Do not copy fake queue behavior.
- Do not use Tailwind CDN runtime; use local CSS. Bootstrap Icons are allowed.

## Backend
Supabase #2 tables:
- chat_contacts
- chat_sessions
- chat_messages
- chat_lead_events
- chat_admin_users
- chat_admin_presence
- chat_settings
- chat_notifications

Use the SQL in `supabase/schema.sql` exactly as the baseline. Do not replace RLS with public/open policies.

## Identity flow
Onboarding fields:
- name/store
- email
- WhatsApp

Create anonymous auth session. Then call `/api/verify-contact` server-side. Verify the email against MAIN_NIAGABIO_SUPABASE_URL using MAIN_NIAGABIO_SUPABASE_SERVICE_ROLE_KEY. Never let the browser choose `customer`.

Modes:
- customer = registered
- prospect = not registered
- unknown = verification failed

## AI
OpenRouter primary. Browser never calls OpenRouter directly. Browser -> `/api/chat` -> OpenRouter -> validate response -> save to Supabase #2.

Use different system prompts:
- Prospect: educational, convincing, registration-oriented.
- Customer: support/troubleshooting.
- Unknown: safe general help.

Never invent prices, features, payment gateway, policies, or account state.

## Chat Admin
Phase 1:
- No internal live human chat.
- `Chat Admin` creates a lead event and gives the exact WhatsApp CTA:
  `https://wa.me/6285191245042`
- No fake queue.

## Admin Master
Route: `/admin-master`.
- Supabase Auth.
- `chat_admin_users` role `master` controls settings/admin management.
- Regular admins get monitoring capabilities according to RLS.
- Protect route server-side/database-side; hidden URL alone is not security.

## Performance
- Vanilla JS.
- Minimal dependencies.
- AI request/response only.
- Realtime optional; do not add it everywhere by default.
- Polling is acceptable for admin metrics in phase 1.

## Security
Never expose:
- Supabase service role keys
- OpenRouter key
- Gemini key

Validate/sanitize all inputs and AI output. Apply rate limit. Allowlist media URLs.

## Implementation order
1. New Supabase project.
2. SQL + RLS.
3. Anonymous auth.
4. `/api/verify-contact`.
5. `/api/chat`.
6. Chat UI.
7. Prospect/customer AI modes.
8. Admin Master.
9. WhatsApp handoff.
10. QA + deploy.

After each task: list changed files, run relevant checks, and report actual results only.
