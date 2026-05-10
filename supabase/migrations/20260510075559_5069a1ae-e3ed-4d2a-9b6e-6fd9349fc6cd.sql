-- Lock down the unused 'receipts' storage bucket.
-- The frontend stores receipts in Google Drive via Apps Script, not Supabase
-- Storage. Until that changes, deny all client access on storage.objects for
-- this bucket. The service-role key bypasses RLS so server-side access still
-- works if needed in the future.

-- Storage RLS is already enabled by default; just add deny-all policies.
DROP POLICY IF EXISTS "receipts_deny_select" ON storage.objects;
DROP POLICY IF EXISTS "receipts_deny_insert" ON storage.objects;
DROP POLICY IF EXISTS "receipts_deny_update" ON storage.objects;
DROP POLICY IF EXISTS "receipts_deny_delete" ON storage.objects;

CREATE POLICY "receipts_deny_select"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id <> 'receipts');

CREATE POLICY "receipts_deny_insert"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id <> 'receipts');

CREATE POLICY "receipts_deny_update"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id <> 'receipts')
WITH CHECK (bucket_id <> 'receipts');

CREATE POLICY "receipts_deny_delete"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id <> 'receipts');