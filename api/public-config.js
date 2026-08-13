// Anon key is designed to be public (RLS enforces access). This just avoids
// hardcoding it into static JS files so one repo can serve multiple envs.
module.exports = (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.status(200).json({
    supabaseUrl: process.env.CHAT_SUPABASE_URL,
    supabaseAnonKey: process.env.CHAT_SUPABASE_ANON_KEY,
    adminWhatsappUrl: process.env.ADMIN_WHATSAPP_URL || 'https://wa.me/6285191245042'
  });
};
