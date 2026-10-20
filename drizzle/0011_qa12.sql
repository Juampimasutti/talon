ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES documents (id);
CREATE INDEX IF NOT EXISTS documents_source_idx ON documents (source_document_id);
