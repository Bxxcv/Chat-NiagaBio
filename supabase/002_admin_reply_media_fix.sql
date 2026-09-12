-- 002_admin_reply_media_fix.sql
-- 1) Izinkan sender 'admin' (sebelumnya cuma user/ai/system) supaya admin
--    master bisa membalas chat langsung.
-- 2) Fix RLS chat_notifications: broadcast (recipient_admin_id null) sekarang
--    kena block untuk role 'admin' biasa (cuma 'master' yang lolos) - dilebarkan
--    supaya semua admin bisa lihat notifikasi broadcast.
-- 3) Bucket storage buat foto yang dikirim user di chat (dibaca AI vision +
--    ditampilkan di admin).

alter table public.chat_messages drop constraint if exists chat_messages_sender_check;
alter table public.chat_messages add constraint chat_messages_sender_check
  check (sender in ('user','ai','system','admin'));

alter table public.chat_sessions add column if not exists needs_admin boolean not null default false;

drop policy if exists chat_notifications_admin on public.chat_notifications;
create policy chat_notifications_admin on public.chat_notifications for all to authenticated
using (recipient_admin_id = auth.uid() or recipient_admin_id is null or public.chat_is_master())
with check (recipient_admin_id = auth.uid() or recipient_admin_id is null or public.chat_is_master());

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

drop policy if exists chat_media_read on storage.objects;
create policy chat_media_read on storage.objects for select to public
using (bucket_id = 'chat-media');

drop policy if exists chat_media_upload on storage.objects;
create policy chat_media_upload on storage.objects for insert to authenticated
with check (bucket_id = 'chat-media');
