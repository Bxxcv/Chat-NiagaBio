# NiagaBio Chatbot (Supabase #2)

Implementasi sesuai `MASTER-PROMPT.md`. Stack: HTML/CSS/Vanilla JS + Vercel Serverless Functions + Supabase.

## Struktur
- `index.html`, `css/`, `js/` — widget chat (public).
- `admin-master/` — dashboard admin (login Supabase Auth + RLS).
- `api/` — serverless functions (verify-contact, chat, request-admin, public-config).
- `supabase/schema.sql` — schema DB (sama seperti sebelumnya).

## Setup
1. Buat project Supabase baru (#2), jalankan `supabase/schema.sql`.
2. Enable **Anonymous Sign-Ins** di Supabase Auth settings.
3. Buat 1 Auth user pertama (dashboard Supabase) untuk admin, lalu insert manual row di `chat_admin_users` dengan `role='master'`.
4. Copy `.env.example` -> isi semua env di Vercel Project Settings.
5. **PENTING**: `MAIN_NIAGABIO_TABLE` / `MAIN_NIAGABIO_EMAIL_COLUMN` harus disesuaikan dengan skema Supabase #1 (NiagaBio utama) — cek nama tabel/kolom email akun seller yang sebenarnya. Default: `profiles.email`.
6. `npm install` lalu `vercel deploy`.

## Yang belum termasuk (next iteration)
- Realtime chat (masih polling untuk admin).
- Upload foto tersimpan ke storage (saat ini foto customer hanya preview lokal, belum dikirim ke AI/admin — perlu Supabase Storage bucket).
- Settings & notifications UI di admin (tabel `chat_settings`/`chat_notifications` sudah ada, endpoint/UI belum dibuat).
- Rate limit saat ini per-session via DB count (bukan per-IP).
