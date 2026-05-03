-- Lock down the unused receipts storage bucket
update storage.buckets set public = false where id = 'receipts';

drop policy if exists "Public can view receipts" on storage.objects;
drop policy if exists "Anyone can upload receipts" on storage.objects;

-- No replacement policies: bucket is unused (uploads go to Google Drive).
-- Without policies, RLS denies all access by default (service role still works).