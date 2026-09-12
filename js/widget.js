import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STORAGE_PROFILE_KEY = 'nb_chat_profile'; // display-only cache (name), not the source of truth
const MAX_FILE_SIZE_MB = 3;

let supabase = null;
let session = null; // supabase auth session
let chatSessionId = null;
let pendingAttachment = null;

const chatInput = document.getElementById('chatInput');
const msgContainer = document.getElementById('dynamicMessages');
const chatBody = document.getElementById('chatBody');
const typingIndicator = document.getElementById('typingIndicator');
const sendBtn = document.getElementById('sendBtn');
const chatBlockOverlay = document.getElementById('chatBlockOverlay');

init();

function init() {
  // Bind events FIRST and synchronously — must work even if config/network fails,
  // otherwise submit falls back to native form submit (page just reloads, looks dead).
  bindStaticEvents();
  document.getElementById('onboardingScreen').classList.remove('hidden');
  loadConfigAndRestoreSession();
}

async function loadConfigAndRestoreSession() {
  let cfg;
  try {
    cfg = await fetch('/api/public-config').then(r => r.json());
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('missing_env');
  } catch (e) {
    showOnboardingError('Server Sedang Error.');
    return;
  }
  window.__adminWhatsappUrl = cfg.adminWhatsappUrl;
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  const { data: { session: existing } } = await supabase.auth.getSession();
  session = existing;

  const cachedProfile = localStorage.getItem(STORAGE_PROFILE_KEY);
  if (session && cachedProfile) {
    document.getElementById('onboardingScreen').classList.add('hidden');
    startChatFlow(JSON.parse(cachedProfile));
  }
}

function showOnboardingError(msg) {
  const errEl = document.getElementById('onboardingError');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

function bindStaticEvents() {
  document.getElementById('menuBtn').onclick = () => document.getElementById('headerDropdown').classList.toggle('hidden');
  document.getElementById('resetBtn').onclick = resetSession;
  document.getElementById('closeSessionBtn').onclick = closeChatSession;
  document.getElementById('onboardingForm').addEventListener('submit', handleOnboarding);
  document.getElementById('chatForm').addEventListener('submit', handleSend);
  document.getElementById('uploadBtn').onclick = () => document.getElementById('imageInput').click();
  document.getElementById('imageInput').addEventListener('change', handleImageUpload);
  document.getElementById('cancelAttachBtn').onclick = cancelAttachment;
  document.getElementById('closeImageModalBtn').onclick = closeImageModal;
}

async function handleOnboarding(e) {
  e.preventDefault();
  if (!supabase) { showOnboardingError('Server belum siap. Cek env Vercel, lalu coba lagi.'); return; }
  const btn = document.getElementById('onboardingSubmit');
  const errEl = document.getElementById('onboardingError');
  errEl.classList.add('hidden');
  btn.disabled = true;

  const name = document.getElementById('inputName').value.trim();
  const email = document.getElementById('inputEmail').value.trim();
  const phone = document.getElementById('inputPhone').value.trim();

  try {
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      session = data.session;
    }
    const res = await fetch('/api/verify-contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ name, email, whatsapp: phone })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'verify_failed');

    const profile = { name, mode: body.mode };
    localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(profile));
    document.getElementById('onboardingScreen').classList.add('hidden');
    startChatFlow(profile);
  } catch (err) {
    errEl.textContent = 'Gagal memverifikasi data. Coba lagi.';
    errEl.classList.remove('hidden');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

function startChatFlow(profile) {
  const firstName = profile.name ? profile.name.split(' ')[0] : 'Kak';
  showTyping();
  setTimeout(() => {
    hideTyping();
    addBotMessage(`Halo <b>${escapeHTML(firstName)}</b>, selamat datang Perkenalkan saya Nia, Assistant Niaga Bio. Ada yang bisa saya bantu?`, [
      { text: '<i class="bi bi-person-badge"></i> Bicara dengan Admin', action: () => requestAdmin() }
    ]);
  }, 900);
}

async function requestAdmin() {
  addUserMessage('Saya butuh bantuan Admin.');
  showTyping();
  try {
    const res = await fetch('/api/request-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ session_id: chatSessionId })
    });
    const body = await res.json();
    hideTyping();
    if (!res.ok) throw new Error(body.error);
    addBotMessage(`Siap. Saya arahkan ke Admin NiagaBio supaya kamu bisa lanjut ngobrol langsung.`, [
      { text: '<i class="bi bi-whatsapp"></i> Buka WhatsApp Admin', action: () => window.open(body.whatsapp_url || window.__adminWhatsappUrl, '_blank') }
    ]);
  } catch (e) {
    hideTyping();
    addBotMessage('Maaf, gagal menghubungkan ke Admin. Coba lagi sebentar.');
  }
}

async function handleSend(e) {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text && !pendingAttachment) return;

  if (pendingAttachment) {
    addUserImageMessage(pendingAttachment.dataUrl, text);
    cancelAttachment();
    chatInput.value = '';
    showTyping();
    setTimeout(() => {
      hideTyping();
      addBotMessage('Foto diterima. Untuk saat ini AI Assistant hanya memproses teks — jelaskan kendalanya ya, atau hubungi Admin untuk kirim foto.');
    }, 600);
    return;
  }

  const msgId = addUserMessage(text);
  chatInput.value = '';
  sendBtn.disabled = true;

  // Kirim request-nya sekarang juga (nggak nunggu animasi), tapi tampilan
  // "Dibaca" + "mengetik" tetap dipacing biar terasa manusiawi, bukan instan.
  const fetchPromise = fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ session_id: chatSessionId, message: text })
  });

  await sleep(500 + Math.random() * 400);
  markAsRead(msgId);
  showTyping();
  const typingStartedAt = Date.now();

  try {
    const res = await fetchPromise;
    const body = await res.json();

    if (res.status === 429) {
      await waitRemaining(typingStartedAt, humanTypingDelay('Pesan terlalu cepat, tunggu sebentar ya.'));
      hideTyping();
      addBotMessage('Pesan terlalu cepat, tunggu sebentar ya.');
      return;
    }
    if (!res.ok) throw new Error(body.error || 'chat_failed');
    chatSessionId = body.session_id;

    await waitRemaining(typingStartedAt, humanTypingDelay(body.reply));
    hideTyping();
    addBotMessage(formatReply(body.reply));
  } catch (err) {
    await waitRemaining(typingStartedAt, 900);
    hideTyping();
    addBotMessage('Maaf, terjadi gangguan. Silakan coba lagi atau hubungi Admin.', [
      { text: '<i class="bi bi-person-badge"></i> Bicara dengan Admin', action: () => requestAdmin() }
    ]);
    console.error(err);
  } finally {
    sendBtn.disabled = false;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitRemaining(since, targetMs) {
  const elapsed = Date.now() - since;
  if (elapsed < targetMs) await sleep(targetMs - elapsed);
}

function resetSession() {
  localStorage.removeItem(STORAGE_PROFILE_KEY);
  chatSessionId = null;
  msgContainer.innerHTML = '';
  document.getElementById('headerDropdown').classList.add('hidden');
  document.getElementById('onboardingScreen').classList.remove('hidden');
}

function closeChatSession() {
  document.getElementById('headerDropdown').classList.add('hidden');
  setBlockOverlay('Sesi chat ditutup. Klik untuk memulai sesi baru.', true);
  addBotMessage('Sesi chat telah ditutup. Terima kasih.');
}

function setBlockOverlay(text, withReload = false) {
  chatBlockOverlay.classList.remove('hidden');
  chatBlockOverlay.innerHTML = withReload
    ? `<i class="bi bi-chat-square-x" style="font-size:22px;color:#ef4444;"></i><span>${text}</span><button onclick="location.reload()" style="margin-top:6px;background:linear-gradient(to right,#0f9f68,#08794f);color:#fff;border:none;padding:8px 16px;border-radius:10px;cursor:pointer;">Mulai Baru</button>`
    : `<span>${text}</span>`;
}

/* Image attach (client-side preview only; no fake "tim kami" claims) */
function handleImageUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Pilih file foto yang valid.'); e.target.value = ''; return; }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) { alert(`Maksimal ${MAX_FILE_SIZE_MB}MB.`); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = (evt) => {
    pendingAttachment = { dataUrl: evt.target.result, name: file.name, sizeStr: (file.size / 1024).toFixed(0) + ' KB' };
    document.getElementById('previewThumb').src = pendingAttachment.dataUrl;
    document.getElementById('previewName').textContent = pendingAttachment.name;
    document.getElementById('previewSize').textContent = pendingAttachment.sizeStr;
    document.getElementById('attachmentPreview').classList.remove('hidden');
    chatInput.placeholder = 'Tulis caption (opsional)...';
    chatInput.focus();
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function cancelAttachment() {
  pendingAttachment = null;
  document.getElementById('attachmentPreview').classList.add('hidden');
  chatInput.placeholder = 'Tulis pesan kamu...';
}

function addUserImageMessage(imgSrc, caption) {
  const row = document.createElement('div');
  row.className = 'msg-row user';
  row.innerHTML = `<div class="msg-bubble"><img src="${imgSrc}" style="max-width:100%;border-radius:12px;cursor:pointer;" onclick="window.__openImg('${imgSrc}')">${caption ? `<p style="margin-top:6px;">${escapeHTML(caption)}</p>` : ''}</div>`;
  msgContainer.appendChild(row);
  scrollToBottom();
}
window.__openImg = openImageModal;

function openImageModal(src) {
  document.getElementById('modalImg').src = src;
  document.getElementById('imageModal').classList.remove('hidden');
}
function closeImageModal() { document.getElementById('imageModal').classList.add('hidden'); }

/* Messaging */
function addUserMessage(text) {
  const row = document.createElement('div');
  const msgId = 'u' + Date.now() + Math.random().toString(36).slice(2, 6);
  row.className = 'msg-row user';
  row.dataset.msgId = msgId;
  row.innerHTML = `<div class="msg-bubble">${escapeHTML(text)}<div class="msg-meta"><i class="bi bi-check2"></i> Terkirim</div></div>`;
  msgContainer.appendChild(row);
  scrollToBottom();
  return msgId;
}

function markAsRead(msgId) {
  if (!msgId) return;
  const row = msgContainer.querySelector(`[data-msg-id="${msgId}"]`);
  if (!row) return;
  const meta = row.querySelector('.msg-meta');
  if (meta) meta.innerHTML = '<i class="bi bi-check2-all" style="color:#34b7f1"></i> Dibaca';
}

/* Simulasikan waktu "mengetik" manusia berdasarkan panjang balasan, supaya
   tidak terasa instan/kaku walau API-nya cepat. Dijaga di rentang wajar. */
function humanTypingDelay(replyText) {
  const words = String(replyText || '').trim().split(/\s+/).length;
  const ms = 350 + words * 90; // ~ kecepatan mengetik natural
  return Math.max(700, Math.min(ms, 3200));
}

function addBotMessage(htmlContent, options = []) {
  const row = document.createElement('div');
  row.className = 'msg-row bot';
  let optsHTML = '';
  if (options.length) {
    optsHTML = '<div class="msg-options">' + options.map((o, i) => `<button data-i="${i}">${o.text}</button>`).join('') + '</div>';
  }
  row.innerHTML = `<div class="msg-avatar"><img src="assets/bot-avatar.webp" onerror="this.onerror=null;this.src='https://chat-niaga-bio.vercel.app/assets/bot-avatar.webp';"></div><div class="msg-bubble">${htmlContent}${optsHTML}</div>`;
  msgContainer.appendChild(row);
  if (options.length) {
    row.querySelectorAll('.msg-options button').forEach((btn, i) => btn.addEventListener('click', () => options[i].action()));
  }
  scrollToBottom();
}

function showTyping() { typingIndicator.classList.remove('hidden'); scrollToBottom(); }
function hideTyping() { typingIndicator.classList.add('hidden'); }
function scrollToBottom() { chatBody.scrollTop = chatBody.scrollHeight; }

function formatReply(text) {
  const escaped = escapeHTML(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

function escapeHTML(str) {
  return String(str || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
