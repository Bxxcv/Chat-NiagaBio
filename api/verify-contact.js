const { chatAdminClient, mainAdminClient, requireAuthUser } = require('./_supabase');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+][0-9\s-]{7,16}$/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
function normalizePhone(phone) {
  let p = String(phone || '').trim().replace(/[\s-]/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  if (p.startsWith('+')) p = p.slice(1);
  return p;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let user;
  try {
    user = await requireAuthUser(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const { name, email, whatsapp, store_name } = req.body || {};
  if (!name || !email || !whatsapp) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const cleanEmail = normalizeEmail(email);
  const cleanPhone = normalizePhone(whatsapp);
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'invalid_email' });
  if (!PHONE_RE.test(cleanPhone)) return res.status(400).json({ error: 'invalid_whatsapp' });
  const cleanName = String(name).trim().slice(0, 120);

  // Verify against main NiagaBio Supabase (source of truth for accounts).
  // Table/column configurable — set MAIN_NIAGABIO_TABLE / MAIN_NIAGABIO_EMAIL_COLUMN
  // to match the actual core schema.
  let mode = 'unknown';
  let verifiedAt = null;
  try {
    const main = mainAdminClient();
    const table = process.env.MAIN_NIAGABIO_TABLE || 'profiles';
    const col = process.env.MAIN_NIAGABIO_EMAIL_COLUMN || 'email';
    const { data, error } = await main
      .from(table)
      .select(col)
      .ilike(col, cleanEmail)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      mode = 'customer';
      verifiedAt = new Date().toISOString();
    } else {
      mode = 'prospect';
    }
  } catch (e) {
    // Lookup failure -> unknown, never guess.
    mode = 'unknown';
    console.error('verify-contact lookup failed:', e.message);
  }

  const chat = chatAdminClient();
  const { data: contact, error: upsertErr } = await chat
    .from('chat_contacts')
    .upsert({
      visitor_id: user.id,
      name: cleanName,
      email: cleanEmail,
      whatsapp: cleanPhone,
      store_name: store_name ? String(store_name).trim().slice(0, 120) : null,
      mode,
      registered_verified_at: verifiedAt,
      updated_at: new Date().toISOString()
    }, { onConflict: 'visitor_id' })
    .select()
    .single();

  if (upsertErr) {
    console.error('verify-contact upsert failed:', upsertErr.message);
    return res.status(500).json({ error: 'save_failed' });
  }

  return res.status(200).json({ mode, contact });
};
