UPDATE storage.buckets SET public = true WHERE id = 'receipts';

DROP POLICY IF EXISTS "Public read receipts" ON storage.objects;
CREATE POLICY "Public read receipts"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'receipts');