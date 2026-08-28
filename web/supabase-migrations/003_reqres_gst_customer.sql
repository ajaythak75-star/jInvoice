-- ── reqres ────────────────────────────────────────────────────────────────────
-- Logs API request/response events (Gemini, GST verify, OAuth, etc.)
-- Useful for debugging extraction failures and auditing external calls.

create table if not exists reqres (
  id          uuid        primary key default gen_random_uuid(),
  source      text        not null,            -- 'gemini' | 'gmail' | 'outlook' | 'gst_verify' | etc.
  endpoint    text        not null,
  method      text        not null default 'POST',
  request     jsonb,                           -- sanitised request payload (no credentials)
  response    jsonb,                           -- response body or error
  status_code integer,
  duration_ms integer,
  user_email  text,
  created_at  timestamptz not null default now()
);

create index if not exists reqres_user_email_idx on reqres (user_email);
create index if not exists reqres_source_idx      on reqres (source);
create index if not exists reqres_created_at_idx  on reqres (created_at desc);

-- Optional: row-level security
-- alter table reqres enable row level security;


-- ── customer_gst ──────────────────────────────────────────────────────────────
-- GST registrations per customer.
-- gst_name is NOT stored redundantly — it comes from the linked customer row.
-- Use the customer_gst_view below for queries that need the name.

create table if not exists customer_gst (
  id          uuid        primary key default gen_random_uuid(),
  customer_id uuid        not null references customers(id) on delete cascade,
  gstin       text        not null unique,
  state_code  text        generated always as (left(gstin, 2)) stored,
  is_active   boolean     not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists customer_gst_customer_idx on customer_gst (customer_id);
create index if not exists customer_gst_gstin_idx    on customer_gst (gstin);

-- Auto-update updated_at (reuse the trigger function from 002)
drop trigger if exists customer_gst_updated_at on customer_gst;
create trigger customer_gst_updated_at
  before update on customer_gst
  for each row execute procedure set_updated_at();

-- View: joins customer name onto every GST row so callers never need a manual join
create or replace view customer_gst_view as
select
  cg.id,
  cg.customer_id,
  c.name  as gst_name,     -- always from the customer record
  c.email as customer_email,
  cg.gstin,
  cg.state_code,
  cg.is_active,
  cg.notes,
  cg.created_at,
  cg.updated_at
from customer_gst cg
join customers c on c.id = cg.customer_id;

-- Optional: row-level security
-- alter table customer_gst enable row level security;
