# NiagaBio Chatbot — Supabase Project #2

Project Supabase baru khusus chatbot. Database NiagaBio utama tidak disentuh.

## Stack
- Frontend: HTML + CSS + Vanilla JS
- Backend: Supabase #2
- AI: OpenRouter
- AI proxy: Vercel Serverless Function
- Admin: halaman `/admin-master` + Supabase Auth
- Chat Admin: WhatsApp 085191245042

## Aturan inti
1. Jangan copy schema core NiagaBio.
2. RLS wajib.
3. API key AI dan service role hanya server-side.
4. Visitor dan customer punya persona AI berbeda.
5. Status registered harus diverifikasi server-side terhadap Supabase utama.
6. Tidak ada fake queue.
7. Tahap pertama Chat Admin diarahkan WhatsApp.
8. Admin Master terpisah dan protected.

## Flow identitas
User isi nama/nama toko + email + WhatsApp -> anonymous auth chatbot -> `/api/verify-contact` -> server mengecek email di Supabase utama -> `customer`, `prospect`, atau `unknown`.

`unknown` berarti lookup gagal; jangan menebak.

## UI
Gunakan `niagabio_chat_widget.html` sebagai acuan visual. Pertahankan shell chat mobile, header hijau, avatar, quick actions, typing indicator, onboarding, composer, dan menu. Buang fake queue.
