// Row shapes for the D1 tables in migrations/. Column names are the keys; null means Garmin did not send it.

export interface SleepRow {
  calendar_date: string;
  sleep_score: number | null;
  sleep_score_qualifier: string | null;
  restlessness_qualifier: string | null;
  total_sleep_s: number | null;
  deep_s: number | null;
  light_s: number | null;
  rem_s: number | null;
  awake_s: number | null;
  unmeasurable_s: number | null;
  nap_s: number | null;
  awake_count: number | null;
  avg_sleep_stress: number | null;
  avg_respiration: number | null;
  sleep_start_local: string | null;
  sleep_end_local: string | null;
  sleep_window_confirmed: number | null;
  fetched_at: string;
}

export interface HrvRow {
  calendar_date: string;
  last_night_avg: number | null;
  last_night_5min_high: number | null;
  weekly_avg: number | null;
  status: string | null;
  baseline_low_upper: number | null;
  baseline_balanced_low: number | null;
  baseline_balanced_upper: number | null;
  fetched_at: string;
}

export interface DailyWellnessRow {
  calendar_date: string;
  resting_hr: number | null;
  resting_hr_7d_avg: number | null;
  min_hr: number | null;
  max_hr: number | null;
  body_battery_min: number | null;
  body_battery_max: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  body_battery_during_sleep: number | null;
  body_battery_at_wake: number | null;
  stress_avg: number | null;
  stress_max: number | null;
  stress_qualifier: string | null;
  steps: number | null;
  step_goal: number | null;
  burned_total_kcal: number | null;
  burned_active_kcal: number | null;
  burned_resting_kcal: number | null;
  fetched_at: string;
}

export interface ActivityRow {
  activity_id: number;
  start_time_local: string | null;
  start_time_gmt: string | null;
  activity_type: string | null;
  event_type: string | null;
  name: string | null;
  description: string | null;
  distance_m: number | null;
  duration_s: number | null;
  moving_duration_s: number | null;
  elapsed_duration_s: number | null;
  elevation_gain_m: number | null;
  avg_speed_mps: number | null;
  avg_grade_adjusted_speed_mps: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  avg_run_cadence_spm: number | null;
  avg_vertical_oscillation_cm: number | null;
  avg_ground_contact_ms: number | null;
  avg_stride_length_cm: number | null;
  avg_vertical_ratio_pct: number | null;
  avg_power_w: number | null;
  aerobic_training_effect: number | null;
  anaerobic_training_effect: number | null;
  training_effect_label: string | null;
  training_load: number | null;
  lap_count: number | null;
  total_sets: number | null;
  active_sets: number | null;
  total_reps: number | null;
  /** JSON: hr zones, split summaries, exercise sets. */
  extras_json: string;
  fetched_at: string;
}

export interface SyncRunRow {
  started_at: string;
  finished_at: string;
  trigger: string;
  window_start: string;
  window_end: string;
  status: 'ok' | 'error';
  counts_json: string;
  error: string | null;
}
