const { createClient } = require('@supabase/supabase-js');

function chatAdminClient() {
  return createClient(
    process.env.CHAT_SUPABASE_URL,
    process.env.CHAT_SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function mainAdminClient() {
  return createClient(
    process.env.MAIN_NIAGABIO_SUPABASE_URL,
    process.env.MAIN_NIAGABIO_SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Verifies the caller's chat Supabase access token (anonymous or real user)
// and returns the auth user id. Throws on invalid/missing token.
async function requireAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    const err = new Error('missing_token');
    err.status = 401;
    throw err;
  }
  const client = chatAdminClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error('invalid_token');
    err.status = 401;
    throw err;
  }
  return data.user;
}

module.exports = { chatAdminClient, mainAdminClient, requireAuthUser };
