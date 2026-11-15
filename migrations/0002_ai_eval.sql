-- Measured results of the AI interpreter benchmark. Rows are written only by an actual run against the
-- configured Workers AI model; nothing here is seeded or hand-entered. Append-only.
CREATE TABLE ai_eval_runs (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  model TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  dataset_size INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_eval_runs_program ON ai_eval_runs(program_id, created_at);
CREATE TRIGGER ai_eval_runs_no_update BEFORE UPDATE ON ai_eval_runs
BEGIN SELECT RAISE(ABORT, 'ai_eval_runs are append-only'); END;
CREATE TRIGGER ai_eval_runs_no_delete BEFORE DELETE ON ai_eval_runs
BEGIN SELECT RAISE(ABORT, 'ai_eval_runs are append-only'); END;
