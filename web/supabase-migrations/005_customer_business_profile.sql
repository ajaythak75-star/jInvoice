-- Migration 005: customer business profile fields
-- Run in Supabase SQL Editor → SQL Editor
-- Adds business profile fields to the customers table.

alter table customers
  add column if not exists business_type         text,
  add column if not exists business_address      text,
  add column if not exists business_pin          text,
  add column if not exists business_state        text,
  add column if not exists business_country      text,
  add column if not exists license_count         text,
  add column if not exists profile_completed_at  timestamptz;

-- business_type:        'Sole Proprietor' | 'Partnership' | 'LLP' | 'Private Limited (Pvt. Ltd.)' | 'Public Limited' | 'Trust / NGO' | 'Others'
-- business_pin:         6-digit PIN code string
-- license_count:        '1'–'5', nullable
-- profile_completed_at: timestamp when the Business Details form was submitted
