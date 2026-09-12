import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let supabase = null;
let currentRole = null;
let currentAdminId = null;
let sessions = [];
let activeSessionId = null;
let pollTimer = null;

init();

function init() {
  // Bind events FIRST and synchronously — must work even if config/network fails,
  // otherwise a submit falls back to native form submit (page just reloads).
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.querySelectorAll('.admin-tabs button').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.getElementById('addAdminForm').addEventListener('submit', handleAddAdmin);
  document.getElementById('notifBell').addEventListener('click', toggleNotifDropdown);
  document.addEventListener('click', (e) => {
    if (!document.getElementById('notifDropdown').contains(e.target) && e.target.closest('#notifBell') == null) {
      document.getElementById('notifDropdown').classList.add('hidden');
    }
  });

  loadConfigAndRestoreSession();
}

async function loadConfigAndRestoreSession() {
  try {
    const cfg = await fetch('/api/public-config').then(r => r.json());
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('missing_env');
    supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (e) {
    showLoginError('Server belum dikonfigurasi (env Supabase belum diisi di Vercel). Hubungi developer.');
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await enterDashboard();
}

function showLoginError(msg) {
  const errEl = document.getElementById('loginError');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  if (!supabase) { showLoginError('Server belum siap. Cek env Vercel, lalu coba lagi.'); return; }
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = 'Login gagal: email/password salah.';
    errEl.classList.remove('hidden');
    return;
  }
  await enterDashboard();
}

async function enterDashboard() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: adminRow, error } = await supabase
    .from('chat_admin_users')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !adminRow) {
    document.getElementById('loginError').textContent = 'Akun ini bukan admin terdaftar.';
    document.getElementById('loginError').classList.remove('hidden');
    await supabase.auth.signOut();
    return;
  }

  currentRole = adminRow.role;
  currentAdminId = user.id;
  document.getElementById('adminName').textContent = `${adminRow.display_name} (${adminRow.role})`;
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  if (currentRole === 'master') document.getElementById('tabAdminsBtn').classList.remove('hidden');

  await loadSessions();
  await loadLeads();
  await loadNotifications();
  pollTimer = setInterval(() => { loadSessions(); loadNotifications(); }, 15000);
}

async function handleLogout() {
  clearInterval(pollTimer);
  await supabase.auth.signOut();
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}

function switchTab(tab) {
  document.querySelectorAll('.admin-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  if (tab === 'admins') loadAdmins();
}

async function loadSessions() {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('id,status,mode,title,last_message_at,updated_at,chat_contacts:visitor_id(name,email,whatsapp)')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) { console.error(error); return; }
  sessions = data || [];
  renderSessionList();
}

function renderSessionList() {
  const el = document.getElementById('sessionList');
  el.innerHTML = sessions.map(s => `
    <div class="admin-list-item ${s.id === activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <div class="name">${escapeHTML(s.chat_contacts?.name || 'Unknown')}</div>
      <div class="meta">${s.mode} • ${s.status} • ${formatTime(s.updated_at)}</div>
    </div>
  `).join('') || '<p class="admin-empty">Belum ada sesi.</p>';
  el.querySelectorAll('.admin-list-item').forEach(item => item.addEventListener('click', () => openSession(item.dataset.id)));
}

async function openSession(id) {
  activeSessionId = id;
  renderSessionList();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', id)
    .order('created_at', { ascending: true });
  const el = document.getElementById('sessionThread');
  if (error) { el.innerHTML = '<p class="admin-empty">Gagal memuat pesan.</p>'; return; }
  el.innerHTML = (data || []).map(m => `<div class="thread-msg ${m.sender}">${escapeHTML(m.content)}</div>`).join('') || '<p class="admin-empty">Belum ada pesan.</p>';
  el.scrollTop = el.scrollHeight;
}

async function loadLeads() {
  const { data, error } = await supabase
    .from('chat_lead_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  const body = document.getElementById('leadsBody');
  if (error) { body.innerHTML = ''; return; }
  body.innerHTML = (data || []).map(l => {
    const suspicious = l.event_type === 'suspicious_prompt';
    const eventLabel = suspicious
      ? `<span class="badge-danger"><i class="bi bi-shield-exclamation"></i> suspicious_prompt</span>`
      : escapeHTML(l.event_type);
    return `<tr class="${suspicious ? 'row-danger' : ''}"><td>${formatTime(l.created_at)}</td><td>${eventLabel}</td><td>${l.score}</td><td>${l.session_id ? l.session_id.slice(0, 8) : '-'}</td></tr>`;
  }).join('');
}

async function loadAdmins() {
  const { data, error } = await supabase.from('chat_admin_users').select('*').order('created_at', { ascending: true });
  const body = document.getElementById('adminsBody');
  if (error) { body.innerHTML = ''; return; }
  body.innerHTML = (data || []).map(a => `
    <tr><td>${escapeHTML(a.display_name)}</td><td>${a.role}</td><td>${a.is_active ? 'aktif' : 'nonaktif'}</td></tr>
  `).join('');
}

async function handleAddAdmin(e) {
  e.preventDefault();
  const userId = document.getElementById('newAdminUserId').value.trim();
  const displayName = document.getElementById('newAdminName').value.trim();
  const role = document.getElementById('newAdminRole').value;
  if (!userId || !displayName) return;
  const { error } = await supabase.from('chat_admin_users').insert({ user_id: userId, display_name: displayName, role });
  if (error) { alert('Gagal menambah admin: ' + error.message); return; }
  document.getElementById('addAdminForm').reset();
  loadAdmins();
}

async function loadNotifications() {
  const { data, error } = await supabase
    .from('chat_notifications')
    .select('*')
    .or(`recipient_admin_id.is.null,recipient_admin_id.eq.${currentAdminId}`)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) { console.error(error); return; }
  const list = data || [];
  const unread = list.filter(n => !n.read_at).length;
  const badge = document.getElementById('notifBadge');
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);

  const listEl = document.getElementById('notifList');
  listEl.innerHTML = list.length ? list.map(n => `
    <div class="notif-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}">
      <div class="notif-item-title"><i class="bi ${n.type === 'security' ? 'bi-shield-exclamation' : 'bi-person-badge'}"></i> ${escapeHTML(n.title)}</div>
      <div class="notif-item-body">${escapeHTML(n.body)}</div>
      <div class="notif-item-time">${formatTime(n.created_at)}</div>
    </div>
  `).join('') : '<p class="admin-empty">Tidak ada notifikasi.</p>';

  listEl.querySelectorAll('.notif-item').forEach(item => item.addEventListener('click', () => {
    const notif = list.find(n => n.id === item.dataset.id);
    if (notif?.session_id) { switchTab('sessions'); openSession(notif.session_id); }
    markNotifRead(item.dataset.id);
    document.getElementById('notifDropdown').classList.add('hidden');
  }));
}

function toggleNotifDropdown() {
  document.getElementById('notifDropdown').classList.toggle('hidden');
}

async function markNotifRead(id) {
  await supabase.from('chat_notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  loadNotifications();
}

function formatTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHTML(str) {
  return String(str || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
