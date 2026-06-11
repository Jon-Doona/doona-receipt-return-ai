
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

create policy "Public can view receipts"
on storage.objects for select
using (bucket_id = 'receipts');

create policy "Anyone can upload receipts"
on storage.objects for insert
with check (bucket_id = 'receipts');
