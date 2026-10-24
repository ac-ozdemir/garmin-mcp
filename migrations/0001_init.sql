-- One table per Garmin source; the MCP layer joins them by calendar_date.
-- Every metric column is nullable: NULL means Garmin did not report it (never 0 as a placeholder).

CREATE TABLE sleep_nights (
  calendar_date TEXT PRIMARY KEY,          -- wake-up day (night of D-1 -> D)
  sleep_score INTEGER,
  sleep_score_qualifier TEXT,
  restlessness_qualifier TEXT,
  total_sleep_s INTEGER,
  deep_s INTEGER,
  light_s INTEGER,
  rem_s INTEGER,
  awake_s INTEGER,
  unmeasurable_s INTEGER,
  nap_s INTEGER,
  awake_count INTEGER,
  avg_sleep_stress REAL,
  avg_respiration REAL,
  sleep_start_local TEXT,
  sleep_end_local TEXT,
  sleep_window_confirmed INTEGER,
  fetched_at TEXT NOT NULL
);

CREATE TABLE hrv_nights (
  calendar_date TEXT PRIMARY KEY,
  last_night_avg INTEGER,
  last_night_5min_high INTEGER,
  weekly_avg INTEGER,
  status TEXT,
  baseline_low_upper INTEGER,
  baseline_balanced_low INTEGER,
  baseline_balanced_upper INTEGER,
  fetched_at TEXT NOT NULL
);

CREATE TABLE daily_wellness (
  calendar_date TEXT PRIMARY KEY,
  resting_hr INTEGER,
  resting_hr_7d_avg INTEGER,
  min_hr INTEGER,
  max_hr INTEGER,
  body_battery_min INTEGER,
  body_battery_max INTEGER,
  body_battery_charged INTEGER,
  body_battery_drained INTEGER,
  body_battery_during_sleep INTEGER,
  body_battery_at_wake INTEGER,
  stress_avg INTEGER,
  stress_max INTEGER,
  stress_qualifier TEXT,
  steps INTEGER,
  step_goal INTEGER,
  fetched_at TEXT NOT NULL
);

CREATE TABLE activities (
  activity_id INTEGER PRIMARY KEY,
  start_time_local TEXT,
  start_time_gmt TEXT,
  activity_type TEXT,
  event_type TEXT,
  name TEXT,
  description TEXT,
  distance_m REAL,
  duration_s REAL,
  moving_duration_s REAL,
  elapsed_duration_s REAL,
  elevation_gain_m REAL,
  avg_speed_mps REAL,
  avg_grade_adjusted_speed_mps REAL,
  avg_hr REAL,
  max_hr REAL,
  calories REAL,
  avg_run_cadence_spm REAL,
  avg_vertical_oscillation_cm REAL,
  avg_ground_contact_ms REAL,
  avg_stride_length_cm REAL,
  avg_vertical_ratio_pct REAL,
  avg_power_w REAL,
  aerobic_training_effect REAL,
  anaerobic_training_effect REAL,
  training_effect_label TEXT,
  training_load REAL,
  lap_count INTEGER,
  total_sets INTEGER,
  active_sets INTEGER,
  total_reps INTEGER,
  extras_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX activities_start_local ON activities (start_time_local);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  status TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  error TEXT
);
