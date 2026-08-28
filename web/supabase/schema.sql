-- jInvoice Supabase Schema
-- Run this in the Supabase SQL Editor (https://app.supabase.com → SQL Editor)

-- ── Enable UUID extension ─────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── 1. vendors ────────────────────────────────────────────────────────────────
-- One row per unique merchant/seller. Invoices reference this table.
create table if not exists vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  gstin       text,                        -- GSTIN is unique per vendor when present
  phone       text,
  pincode     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists vendors_gstin_idx on vendors (gstin) where gstin is not null;
create index if not exists vendors_name_idx on vendors (lower(name));

-- ── 2. invoices ───────────────────────────────────────────────────────────────
-- One row per invoice. All money stored in paise (1 INR = 100 paise).
create table if not exists invoices (
  id                uuid primary key default gen_random_uuid(),
  local_id          integer,               -- Dexie id from the desktop app (for dedup)
  vendor_id         uuid references vendors(id) on delete set null,
  invoice_number    text,
  invoice_date      date,
  subtotal_paise    bigint,
  tax_paise         bigint,
  discount_paise    bigint not null default 0,
  grand_total_paise bigint,
  payment_mode      text,
  import_source     text not null,         -- 'gmail', 'outlook', 'mobile_sync', 'manual'
  pdf_source_type   text,                  -- 'DIGITAL_PDF', 'SCANNED_PDF'
  status            text not null default 'imported',
  category          text,                  -- 'food', 'electronics', 'medical', etc.
  doc_type          text,                  -- 'invoice', 'warranty', 'insurance', etc.
  doc_types         text[],
  source_filename   text,
  subject           text,                  -- email subject if from Gmail/Outlook
  sender_email      text,
  received_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists invoices_vendor_idx    on invoices (vendor_id);
create index if not exists invoices_date_idx      on invoices (invoice_date desc);
create index if not exists invoices_category_idx  on invoices (category);
create index if not exists invoices_source_idx    on invoices (import_source);
create index if not exists invoices_local_id_idx  on invoices (local_id);

-- ── 3. invoice_items ──────────────────────────────────────────────────────────
-- Line items for each invoice. All money in paise.
create table if not exists invoice_items (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references invoices(id) on delete cascade,
  name              text not null,
  quantity          numeric not null default 1,
  unit_price_paise  bigint not null default 0,
  total_price_paise bigint not null default 0,
  discount_paise    bigint not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists items_invoice_idx on invoice_items (invoice_id);

-- ── 4. customers ──────────────────────────────────────────────────────────────
-- One row per jInvoice user. Tracks spending stats and gamification state.
-- Points: 1 point per ₹10 spent (grand_total_paise / 1000).
-- Levels: Bronze → Silver → Gold → Platinum based on lifetime points.
create table if not exists customers (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique,
  name                text,
  -- Spend stats (kept in sync by trigger)
  total_spend_paise   bigint not null default 0,
  invoice_count       integer not null default 0,
  -- Gamification
  points              integer not null default 0,
  level               text not null default 'bronze',  -- bronze | silver | gold | platinum
  badges              jsonb not null default '[]',      -- array of badge slugs
  streak_days         integer not null default 0,       -- consecutive days with an invoice
  last_activity_at    timestamptz,
  -- Meta
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Helper: compute level from points ────────────────────────────────────────
create or replace function compute_level(pts integer) returns text
language sql immutable as $$
  select case
    when pts >= 15000 then 'platinum'
    when pts >= 5000  then 'gold'
    when pts >= 1000  then 'silver'
    else 'bronze'
  end
$$;

-- ── Helper: award badge if not already held ───────────────────────────────────
create or replace function award_badge(customer_id uuid, badge text) returns void
language plpgsql as $$
begin
  update customers
  set badges = badges || jsonb_build_array(badge),
      updated_at = now()
  where id = customer_id
    and not (badges @> jsonb_build_array(badge));
end;
$$;

-- ── Trigger: update customer stats when an invoice is inserted ────────────────
create or replace function sync_customer_stats() returns trigger
language plpgsql as $$
declare
  cust_id uuid;
  new_points integer;
  inv_total bigint;
begin
  -- Only run for invoices linked to a customer via sender_email
  if new.sender_email is null then return new; end if;

  select id into cust_id from customers where email = new.sender_email limit 1;
  if cust_id is null then return new; end if;

  inv_total := coalesce(new.grand_total_paise, 0);
  -- 1 point per ₹10 (1000 paise)
  new_points := greatest(0, inv_total / 1000);

  update customers set
    total_spend_paise = total_spend_paise + inv_total,
    invoice_count     = invoice_count + 1,
    points            = points + new_points,
    level             = compute_level(points + new_points),
    last_activity_at  = coalesce(new.received_at, now()),
    updated_at        = now()
  where id = cust_id;

  -- Badge: first invoice
  if (select invoice_count from customers where id = cust_id) = 1 then
    perform award_badge(cust_id, 'first_invoice');
  end if;

  -- Badge: 10 invoices
  if (select invoice_count from customers where id = cust_id) >= 10 then
    perform award_badge(cust_id, 'invoice_10');
  end if;

  -- Badge: 100 invoices
  if (select invoice_count from customers where id = cust_id) >= 100 then
    perform award_badge(cust_id, 'invoice_100');
  end if;

  -- Badge: spent ₹10,000 (1,000,000 paise)
  if (select total_spend_paise from customers where id = cust_id) >= 1000000 then
    perform award_badge(cust_id, 'spend_10k');
  end if;

  -- Badge: spent ₹1,00,000 (10,000,000 paise)
  if (select total_spend_paise from customers where id = cust_id) >= 10000000 then
    perform award_badge(cust_id, 'spend_1l');
  end if;

  return new;
end;
$$;

create trigger trg_sync_customer_stats
after insert on invoices
for each row execute function sync_customer_stats();

-- ── Row Level Security (basic) ────────────────────────────────────────────────
-- Enable RLS — all tables start locked. Add policies as needed.
alter table vendors        enable row level security;
alter table invoices       enable row level security;
alter table invoice_items  enable row level security;
alter table customers      enable row level security;

-- Allow service role (server-side) full access — needed for sync from Electron
-- (anon key used on mobile should be read-only or scoped to the user's own data)
create policy "service full access vendors"       on vendors       using (true) with check (true);
create policy "service full access invoices"      on invoices      using (true) with check (true);
create policy "service full access invoice_items" on invoice_items using (true) with check (true);
create policy "service full access customers"     on customers     using (true) with check (true);
