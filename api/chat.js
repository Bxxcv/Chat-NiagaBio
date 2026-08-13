const { chatAdminClient, requireAuthUser } = require('./_supabase');

const MAX_MSG_LEN = 2000;
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX = 4;

const SYSTEM_PROMPTS = {
  prospect: `Anda adalah NiagaBio Assistant, staf dukungan resmi NiagaBio yang ramah dan profesional — bicara seperti manusia lewat chat, bukan seperti daftar fitur.
Fakta: NiagaBio = link-bio + katalog produk + checkout manual + dashboard seller, untuk UMKM/online seller/creator di Indonesia, bisa dikelola dari HP. Produksi: https://niaga-bio.vercel.app
Gaya bahasa: singkat, hangat, natural, seperti admin toko yang membalas chat pelanggan. JANGAN pakai format markdown (tanda bintang **, pagar #, dsb) karena tidak akan dirender. Kalau perlu daftar, tulis dalam kalimat mengalir atau baris baru biasa, jangan bullet dengan simbol.
Aturan: jelaskan sederhana dan meyakinkan, dorong pendaftaran secara natural, JANGAN pernah mengklaim pengunjung sudah punya akun, JANGAN mengarang harga/fitur premium/payment gateway/kebijakan.`,
  customer: `Anda adalah NiagaBio Assistant, staf dukungan resmi NiagaBio yang ramah dan profesional — bicara seperti manusia lewat chat, bukan seperti daftar fitur.
Fokus: upload/edit produk, profil/toko, galeri, links/social, tema, pengaturan checkout, pesanan, notifikasi, login/halaman publik, troubleshooting.
Gaya bahasa: singkat, hangat, natural. JANGAN pakai format markdown (tanda bintang **, pagar #, dsb) karena tidak akan dirender.
JANGAN pernah meminta password, API key, service role key, atau payment secret.`,
  unknown: `Verifikasi akun gagal. Jangan menebak status pendaftaran. Jawab pertanyaan umum dengan aman, bahasa natural tanpa markdown, dan jangan mengklaim status akun apa pun.`
};

function sanitizeText(t) {
  return String(t || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?[^>]+>/g, '')
    .trim()
    .slice(0, MAX_MSG_LEN);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let user;
  try {
    user = await requireAuthUser(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const rawMessage = (req.body || {}).message;
  let sessionId = (req.body || {}).session_id || null;
  const message = sanitizeText(rawMessage);
  if (!message) return res.status(400).json({ error: 'empty_message' });

  const chat = chatAdminClient();

  const { data: contact, error: contactErr } = await chat
    .from('chat_contacts')
    .select('*')
    .eq('visitor_id', user.id)
    .maybeSingle();
  if (contactErr || !contact) return res.status(403).json({ error: 'contact_not_found' });

  const mode = contact.mode || 'unknown';

  if (!sessionId) {
    const { data: session, error: sessErr } = await chat
      .from('chat_sessions')
      .insert({ visitor_id: user.id, mode, title: 'NiagaBio Chat' })
      .select()
      .single();
    if (sessErr) return res.status(500).json({ error: 'session_create_failed' });
    sessionId = session.id;
  } else {
    const { data: session, error: sessErr } = await chat
      .from('chat_sessions')
      .select('id,visitor_id,status')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessErr || !session || session.visitor_id !== user.id) {
      return res.status(403).json({ error: 'session_forbidden' });
    }
    if (session.status === 'closed') return res.status(409).json({ error: 'session_closed' });
  }

  // Rate limit: recent user messages in this session
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentCount } = await chat
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('sender', 'user')
    .gte('created_at', since);
  if ((recentCount || 0) >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  await chat.from('chat_messages').insert({
    session_id: sessionId,
    sender: 'user',
    content: message
  });

  // Recent context
  const { data: history } = await chat
    .from('chat_messages')
    .select('sender,content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(10);
  const orderedHistory = (history || []).reverse();

  const openrouterMessages = [
    { role: 'system', content: SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.unknown },
    ...orderedHistory.map(m => ({
      role: m.sender === 'ai' ? 'assistant' : 'user',
      content: m.content
    }))
  ];

  let aiText = '';
  let errorCode = null;
  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
        messages: openrouterMessages,
        temperature: 0.6,
        max_tokens: 700
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!orRes.ok) {
      const errBody = await orRes.text().catch(() => '');
      throw new Error(`openrouter_${orRes.status}: ${errBody.slice(0, 300)}`);
    }
    const orData = await orRes.json();
    aiText = sanitizeText(orData?.choices?.[0]?.message?.content || '');
    if (!aiText) throw new Error('empty_ai_response');
  } catch (e) {
    errorCode = e.name === 'TimeoutError' ? 'openrouter_timeout' : (e.message || 'openrouter_error');
    aiText = 'Maaf, sistem sedang mengalami gangguan. Silakan coba lagi sebentar, atau hubungi Admin.';
    console.error('chat AI error:', errorCode);
  }

  const { data: aiMsg } = await chat.from('chat_messages').insert({
    session_id: sessionId,
    sender: 'ai',
    content: aiText,
    provider: 'openrouter',
    model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
    error_code: errorCode
  }).select().single();

  return res.status(200).json({
    session_id: sessionId,
    mode,
    reply: aiText,
    message_id: aiMsg?.id || null,
    degraded: !!errorCode
  });
};
