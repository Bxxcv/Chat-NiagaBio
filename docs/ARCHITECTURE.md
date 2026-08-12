# Architecture

```text
Browser (Vanilla JS)
  -> Vercel /api/verify-contact
  -> Supabase #1 (server-side lookup)

Browser
  -> Vercel /api/chat
  -> OpenRouter
  -> Supabase #2 chat DB

Admin Master
  -> Supabase #2 Auth/RLS
```

## Separation
### Supabase #1
Source of truth untuk seller/account/product/order NiagaBio.

### Supabase #2
Chat-only:
- contact
- session
- messages
- leads
- admin
- presence
- settings
- notifications

Jangan menyalin profiles/products/orders ke Supabase #2.

## Modes
- `prospect`: visitor belum terdaftar; edukasi + CTA daftar.
- `customer`: user terdaftar; bantuan fitur + troubleshooting.
- `unknown`: verifikasi gagal; jawaban umum tanpa klaim akun.

## Admin handoff
User klik Chat Admin -> lead event -> tombol WhatsApp `https://wa.me/6285191245042`.
Tidak ada antrean palsu dan tidak ada klaim admin online.
