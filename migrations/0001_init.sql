-- RELAY schema. All money is stored as integer cents. All timestamps are ISO-8601 UTC strings.
-- Demonstration data only: no real financial accounts, no real residents.

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE communities (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  region_id TEXT NOT NULL,
  population INTEGER NOT NULL CHECK (population >= 0),
  population_needing INTEGER NOT NULL CHECK (population_needing >= 0),
  need_severity INTEGER NOT NULL CHECK (need_severity BETWEEN 0 AND 100),
  market_access_score INTEGER NOT NULL CHECK (market_access_score BETWEEN 0 AND 100),
  merchants_needed INTEGER NOT NULL DEFAULT 3 CHECK (merchants_needed >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  diagram_x REAL NOT NULL DEFAULT 50,
  diagram_y REAL NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE programs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emergency_type TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','paused','closed')),
  budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  restrict_home_community INTEGER NOT NULL DEFAULT 1 CHECK (restrict_home_community IN (0,1)),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE program_communities (
  program_id TEXT NOT NULL REFERENCES programs(id),
  community_id TEXT NOT NULL REFERENCES communities(id),
  PRIMARY KEY (program_id, community_id)
);

CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  community_id TEXT NOT NULL REFERENCES communities(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','limited','closed')),
  participating INTEGER NOT NULL DEFAULT 1 CHECK (participating IN (0,1)),
  capacity_score INTEGER NOT NULL CHECK (capacity_score BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE residents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  community_id TEXT NOT NULL REFERENCES communities(id),
  program_id TEXT NOT NULL REFERENCES programs(id),
  name TEXT NOT NULL,
  household_size INTEGER NOT NULL DEFAULT 1 CHECK (household_size BETWEEN 1 AND 20),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL CHECK (role IN ('coordinator','merchant','resident')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  merchant_id TEXT REFERENCES merchants(id),
  resident_id TEXT REFERENCES residents(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  CHECK ((role = 'merchant' AND merchant_id IS NOT NULL AND resident_id IS NULL)
      OR (role = 'resident' AND resident_id IS NOT NULL AND merchant_id IS NULL)
      OR (role = 'coordinator' AND merchant_id IS NULL AND resident_id IS NULL))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE vouchers (
  id TEXT PRIMARY KEY,
  public_code TEXT NOT NULL UNIQUE,
  program_id TEXT NOT NULL REFERENCES programs(id),
  resident_id TEXT NOT NULL REFERENCES residents(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  remaining_cents INTEGER NOT NULL CHECK (remaining_cents >= 0),
  eligible_categories_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted','cancelled')),
  nonce TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (remaining_cents <= amount_cents)
);

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  community_id TEXT NOT NULL REFERENCES communities(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('drinking_water','food_packages','medical_essentials','first_aid','blankets','hygiene','other_essentials')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  min_threshold INTEGER NOT NULL CHECK (min_threshold >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  community_id TEXT NOT NULL REFERENCES communities(id),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  reason TEXT NOT NULL CHECK (reason IN ('opening_stock','restock','adjustment','redemption','reversal','correction')),
  note TEXT,
  ref_id TEXT,
  actor_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE reimbursement_claims (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  program_id TEXT NOT NULL REFERENCES programs(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

CREATE TABLE redemptions (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  program_id TEXT NOT NULL REFERENCES programs(id),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  resident_id TEXT NOT NULL REFERENCES residents(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  community_id TEXT NOT NULL REFERENCES communities(id),
  claim_id TEXT NOT NULL REFERENCES reimbursement_claims(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
  idempotency_key TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  reversed_at TEXT,
  reversal_reason TEXT,
  UNIQUE (merchant_id, idempotency_key)
);

CREATE TABLE redemption_items (
  id TEXT PRIMARY KEY,
  redemption_id TEXT NOT NULL REFERENCES redemptions(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);

CREATE TABLE reimbursement_items (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES reimbursement_claims(id),
  redemption_id TEXT NOT NULL UNIQUE REFERENCES redemptions(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  voided INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0,1))
);

-- Append-only financial ledger. Corrections are made with reversal entries, never edits.
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  account_type TEXT NOT NULL CHECK (account_type IN ('resident','merchant')),
  resident_id TEXT REFERENCES residents(id),
  merchant_id TEXT REFERENCES merchants(id),
  voucher_id TEXT REFERENCES vouchers(id),
  redemption_id TEXT REFERENCES redemptions(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('assistance_issued','voucher_redeemed','voucher_reversal','reimbursement_claim_created','reimbursement_claim_reversed','allocation_adjustment')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  memo TEXT,
  reverses_entry_id TEXT REFERENCES ledger_entries(id),
  created_by TEXT,
  created_at TEXT NOT NULL,
  CHECK ((account_type = 'resident' AND resident_id IS NOT NULL) OR (account_type = 'merchant' AND merchant_id IS NOT NULL))
);
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries are immutable; post a reversal entry instead'); END;
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries are immutable; post a reversal entry instead'); END;

CREATE TABLE planned_shipments (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id),
  merchant_id TEXT REFERENCES merchants(id),
  category TEXT NOT NULL CHECK (category IN ('drinking_water','food_packages','medical_essentials','first_aid','blankets','hygiene','other_essentials')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  eta TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','delivered','cancelled')),
  label TEXT NOT NULL
);

CREATE TABLE daily_demand_observations (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id),
  category TEXT NOT NULL CHECK (category IN ('drinking_water','food_packages','medical_essentials','first_aid','blankets','hygiene','other_essentials')),
  day TEXT NOT NULL,
  units_consumed INTEGER NOT NULL CHECK (units_consumed >= 0),
  UNIQUE (community_id, category, day)
);

CREATE TABLE scenario_runs (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  name TEXT NOT NULL,
  scenario_type TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','ai')),
  source_text TEXT,
  ai_proposal_json TEXT,
  baseline_json TEXT NOT NULL,
  adjusted_json TEXT NOT NULL,
  comparison_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE scenario_adjustments (
  id TEXT PRIMARY KEY,
  scenario_run_id TEXT NOT NULL REFERENCES scenario_runs(id),
  kind TEXT NOT NULL,
  community_id TEXT,
  merchant_id TEXT,
  category TEXT,
  params_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE allocation_runs (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  status TEXT NOT NULL CHECK (status IN ('pending_approval','approved','rejected','superseded')),
  analysis_days INTEGER NOT NULL,
  budget_basis_cents INTEGER NOT NULL CHECK (budget_basis_cents >= 0),
  total_recommended_cents INTEGER NOT NULL CHECK (total_recommended_cents >= 0),
  voucher_cents INTEGER NOT NULL CHECK (voucher_cents >= 0),
  direct_supply_cents INTEGER NOT NULL CHECK (direct_supply_cents >= 0),
  unallocated_cents INTEGER NOT NULL CHECK (unallocated_cents >= 0),
  communities_evaluated INTEGER NOT NULL,
  inputs_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  scenario_run_id TEXT REFERENCES scenario_runs(id),
  created_by TEXT,
  created_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_reason TEXT,
  CHECK (voucher_cents + direct_supply_cents = total_recommended_cents)
);

CREATE TABLE allocation_recommendations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES allocation_runs(id),
  community_id TEXT NOT NULL REFERENCES communities(id),
  market_viability REAL NOT NULL,
  priority_share REAL NOT NULL,
  recommended_cents INTEGER NOT NULL CHECK (recommended_cents >= 0),
  voucher_pct REAL NOT NULL,
  direct_pct REAL NOT NULL,
  voucher_cents INTEGER NOT NULL CHECK (voucher_cents >= 0),
  direct_cents INTEGER NOT NULL CHECK (direct_cents >= 0),
  detail_json TEXT NOT NULL,
  UNIQUE (run_id, community_id),
  CHECK (voucher_cents + direct_cents = recommended_cents)
);

CREATE TABLE demand_forecasts (
  id TEXT PRIMARY KEY,
  allocation_run_id TEXT NOT NULL REFERENCES allocation_runs(id),
  community_id TEXT NOT NULL REFERENCES communities(id),
  category TEXT NOT NULL,
  horizon_hours INTEGER NOT NULL CHECK (horizon_hours IN (24,48,72)),
  forecast_units REAL NOT NULL CHECK (forecast_units >= 0),
  method TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

-- Append-only audit trail.
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  program_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs are append-only'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs are append-only'); END;

-- Assertion helper: a row with ok = 0 violates the CHECK and aborts (rolls back) the whole D1 batch.
CREATE TABLE tx_guards (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE INDEX idx_residents_community ON residents(community_id);
CREATE INDEX idx_residents_program ON residents(program_id);
CREATE INDEX idx_merchants_community ON merchants(community_id);
CREATE INDEX idx_vouchers_resident ON vouchers(resident_id);
CREATE INDEX idx_vouchers_program ON vouchers(program_id);
CREATE INDEX idx_inventory_merchant ON inventory_items(merchant_id);
CREATE INDEX idx_inventory_community ON inventory_items(community_id, category);
CREATE INDEX idx_movements_item ON inventory_movements(inventory_item_id, created_at);
CREATE INDEX idx_redemptions_merchant ON redemptions(merchant_id, created_at);
CREATE INDEX idx_redemptions_resident ON redemptions(resident_id, created_at);
CREATE INDEX idx_redemptions_program ON redemptions(program_id, created_at);
CREATE INDEX idx_ledger_resident ON ledger_entries(resident_id, created_at);
CREATE INDEX idx_ledger_merchant ON ledger_entries(merchant_id, created_at);
CREATE INDEX idx_ledger_program ON ledger_entries(program_id, created_at);
CREATE INDEX idx_claims_merchant ON reimbursement_claims(merchant_id, status);
CREATE INDEX idx_demand_lookup ON daily_demand_observations(community_id, category, day);
CREATE INDEX idx_alloc_program ON allocation_runs(program_id, created_at);
CREATE INDEX idx_audit_created ON audit_logs(org_id, created_at);
CREATE INDEX idx_audit_program ON audit_logs(program_id, created_at);
CREATE INDEX idx_sessions_user ON sessions(user_id);
