-- ============================================================================
-- Hälsoutmaningen — 0003 private Storage buckets and policies
--
-- Two private buckets:
--   proofs   challenge/{challenge_id}/{user_id}/{challenge_date}/{uuid}.{ext}
--   avatars  {user_id}/{uuid}.{ext}
--
-- Nothing is ever public. Reads happen through short-lived signed URLs created
-- by the client after the SELECT policy below has authorised them
-- (docs/ARCHITECTURE.md §18).
-- ============================================================================

create or replace function public.try_cast_uuid(p text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then p::uuid
  end;
$$;

revoke all on function public.try_cast_uuid(text) from public, anon;
grant execute on function public.try_cast_uuid(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Buckets
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proofs', 'proofs', false, 15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- proofs policies  (path: {challenge_id}/{user_id}/{challenge_date}/{file})
-- ----------------------------------------------------------------------------
create policy "proofs: members and admins can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs'
    and (
      public.is_admin()
      or public.is_challenge_member(
           public.try_cast_uuid((storage.foldername(name))[1])
         )
    )
  );

create policy "proofs: owner can upload into own challenge folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_challenge_member(
          public.try_cast_uuid((storage.foldername(name))[1])
        )
  );

create policy "proofs: owner or admin can update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'proofs'
    and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_admin())
  )
  with check (
    bucket_id = 'proofs'
    and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_admin())
  );

create policy "proofs: owner or admin can delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proofs'
    and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_admin())
  );

-- ----------------------------------------------------------------------------
-- avatars policies  (path: {user_id}/{file})
-- ----------------------------------------------------------------------------
create policy "avatars: any authenticated user can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

create policy "avatars: owner can upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: owner can update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: owner can delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
