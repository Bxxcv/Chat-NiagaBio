# User Flow

## First visit
1. Open chatbot.
2. Onboarding: name/store, email, WhatsApp.
3. Anonymous Supabase Auth session.
4. Server verify email against main NiagaBio Supabase.
5. Mode = `customer`, `prospect`, or `unknown`.
6. Create session.
7. AI welcome.

## Prospect mode
AI menjelaskan NiagaBio, manfaat, cara mulai, dan mengarahkan ke daftar akun. Tidak boleh pura-pura user sudah punya akun.

## Customer mode
AI membantu upload/edit produk, profile, gallery, links/social, themes, checkout settings, orders, login, public page, dan troubleshooting berdasarkan data yang terverifikasi.

## Chat Admin
User klik Chat Admin -> bot memberi CTA WhatsApp -> `https://wa.me/6285191245042`.

## Admin Master
`/admin-master` -> Supabase Auth -> role `master` untuk administrasi. Regular admin dapat monitoring sesuai RLS.
