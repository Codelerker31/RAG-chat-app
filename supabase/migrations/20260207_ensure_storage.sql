-- Ensure the 'documents' storage bucket exists
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

-- Ensure policy exists for uploading files to the 'documents' bucket
create policy "Allow public uploads to documents"
on storage.objects for insert
with check ( bucket_id = 'documents' );

-- Ensure policy exists for reading files from the 'documents' bucket (if not already public by bucket definition)
create policy "Allow public read from documents"
on storage.objects for select
using ( bucket_id = 'documents' );
