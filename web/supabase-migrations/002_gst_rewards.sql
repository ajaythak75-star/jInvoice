-- ── GST Reports ──────────────────────────────────────────────────────────────
-- Stores snapshots of the GST Report screen exports (one row per save).
-- "rows" is a JSONB array of per-GSTIN aggregates from that export.

create table if not exists gst_reports (
  id            uuid        primary key default gen_random_uuid(),
  period        text        not null,            -- e.g. "this_fy"
  period_label  text        not null,            -- e.g. "This FY"
  from_date     date,
  to_date       date,
  total_invoices     integer  not null default 0,
  total_taxable_paise bigint  not null default 0,
  total_gst_paise     bigint  not null default 0,
  total_paise         bigint  not null default 0,
  rows          jsonb        not null default '[]',
  -- rows element shape:
  -- { gstin, supplierNames, invoiceCount, taxablePaise, gstPaise, totalPaise }
  exported_at   timestamptz  not null default now(),
  created_at    timestamptz  not null default now()
);

-- Optional: row-level security — enable if you use Supabase Auth
-- alter table gst_reports enable row level security;


-- ── Rewards ──────────────────────────────────────────────────────────────────
-- One row per user; synced from the local RewardsStore on every award.
-- disabled_at is set when the user has not used the app in 3 months (90 days).

create table if not exists rewards (
  id               uuid        primary key default gen_random_uuid(),
  user_email       text        not null unique,
  points           integer     not null default 0,
  upload_count     integer     not null default 0,
  cloud_sync_count integer     not null default 0,
  history          jsonb       not null default '[]',
  -- history element shape: { points, reason, at }
  last_used_at     timestamptz,
  disabled_at      timestamptz,   -- null = active; non-null = disabled due to inactivity
  created_at       timestamptz    not null default now(),
  updated_at       timestamptz    not null default now()
);

-- Auto-update updated_at on every upsert
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rewards_updated_at on rewards;
create trigger rewards_updated_at
  before update on rewards
  for each row execute procedure set_updated_at();

-- Optional: row-level security
-- alter table rewards enable row level security;
