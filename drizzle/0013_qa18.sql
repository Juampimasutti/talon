alter table documents add column if not exists supplier_pos integer;
alter table documents add column if not exists supplier_number integer;

create unique index if not exists documents_supplier_invoice_uidx
  on documents (company_id, party_id, supplier_pos, supplier_number)
  where kind = 'compra' and status = 'confirmado' and supplier_number is not null;
