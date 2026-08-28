-- Migration 004: customer plan fields
-- Run in Supabase SQL Editor → SQL Editor
-- Adds plan/subscription state to the customers table.

alter table customers
  add column if not exists plan             text        not null default 'free',
  add column if not exists plan_status      text        not null default 'inactive',
  add column if not exists billing_cycle    text,
  add column if not exists trial_started_at timestamptz,
  add column if not exists plan_updated_at  timestamptz;

-- plan:          'free' | 'pro_shared' | 'pro_own'
-- plan_status:   'inactive' | 'trial' | 'active'
-- billing_cycle: 'monthly' | 'yearly' — null for free
