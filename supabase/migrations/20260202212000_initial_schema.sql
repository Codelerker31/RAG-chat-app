-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Create a table to store your chat sessions
create table if not exists chats (
  id uuid primary key,
  title text not null,
  type text not null, -- 'global' or 'dedicated'
  created_at bigint not null -- Storing JS timestamp (epoch ms)
);

-- Enable Row Level Security (RLS)
alter table chats enable row level security;

-- Create a policy that allows all operations for now (public)
-- In production, you'd restrict this to authenticated users
create policy "Allow all operations on chats"
on chats for all using (true) with check (true);


-- Create a table to store messages
create table if not exists messages (
  id uuid primary key,
  chat_id uuid references chats(id) on delete cascade not null,
  role text not null, -- 'user' or 'model'
  text text not null,
  timestamp bigint not null -- Storing JS timestamp
);

alter table messages enable row level security;

create policy "Allow all operations on messages"
on messages for all using (true) with check (true);


-- Create a table to store uploaded documents
create table if not exists documents (
  id uuid primary key,
  file_name text not null,
  upload_timestamp bigint not null,
  scope text not null, -- 'global' or a chat_id
  chunk_count int not null
);

alter table documents enable row level security;

create policy "Allow all operations on documents"
on documents for all using (true) with check (true);


-- Create a table to store RAG chunks (vectors)
create table if not exists rag_chunks (
  id uuid primary key,
  document_id uuid references documents(id) on delete cascade not null,
  text text not null,
  embedding vector(768), -- Gemini text-embedding-004
  page_number int
);

-- Index for faster vector search
create index on rag_chunks using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

alter table rag_chunks enable row level security;

create policy "Allow all operations on rag_chunks"
on rag_chunks for all using (true) with check (true);


-- Create a function to search for documents
create or replace function match_rag_chunks (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_scope text
) returns table (
  id uuid,
  text text,
  file_name text,
  page_number int,
  similarity float
) language plpgsql stable as $$
begin
  return query
  select
    rag_chunks.id,
    rag_chunks.text,
    documents.file_name,
    rag_chunks.page_number,
    1 - (rag_chunks.embedding <=> query_embedding) as similarity
  from rag_chunks
  join documents on rag_chunks.document_id = documents.id
  where 1 - (rag_chunks.embedding <=> query_embedding) > match_threshold
  and (documents.scope = 'global' or documents.scope = filter_scope)
  order by similarity desc
  limit match_count;
end;
$$;

-- Create a storage bucket for documents
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true);

-- Set up access policies for the storage bucket
create policy "Allow all operations on documents bucket"
on storage.objects for all using ( bucket_id = 'documents' ) with check ( bucket_id = 'documents' );
