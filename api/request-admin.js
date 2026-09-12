const { chatAdminClient, requireAuthUser } = require('./_supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let user;
  try {
    user = await requireAuthUser(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const sessionId = (req.body || {}).session_id || null;
  const chat = chatAdminClient();

  if (sessionId) {
    const { data: session } = await chat
      .from('chat_sessions')
      .select('id,visitor_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (!session || session.visitor_id !== user.id) {
      return res.status(403).json({ error: 'session_forbidden' });
    }
  }

  if (sessionId) {
    await chat.from('chat_sessions').update({ needs_admin: true }).eq('id', sessionId);
  }

  await chat.from('chat_lead_events').insert({
    visitor_id: user.id,
    session_id: sessionId,
    event_type: 'request_admin',
    score: 10
  });
  await chat.from('chat_notifications').insert({
    recipient_admin_id: null,
    type: 'request_admin',
    title: 'Ada yang minta bicara dengan Admin',
    body: 'Pengunjung meminta dialihkan ke Admin manusia di sesi chat ini.',
    session_id: sessionId
  });

  const waUrl = process.env.ADMIN_WHATSAPP_URL || 'https://wa.me/6285191245042';
  return res.status(200).json({ whatsapp_url: waUrl });
};
