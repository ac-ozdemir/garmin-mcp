// Shapes DB rows into tool output. Garmin values pass through unchanged; anything derived here sits under `computed`.
import type { SleepNight } from '../db/queries.ts';
import type { ActivityRow, DailyWellnessRow } from '../db/rows.ts';

/** 25200 -> "7h00", 2700 -> "45m". */
export function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes}m`;
}

/** m/s -> "m:ss" per km. */
export function formatPace(metersPerSecond: number | null): string | null {
  if (!metersPerSecond || metersPerSecond <= 0) return null;
  const secondsPerKm = Math.round(1000 / metersPerSecond);
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')}`;
}

const round = (value: number | null, digits = 1) => (value == null ? null : Number(value.toFixed(digits)));

export function presentSleep(night: SleepNight) {
  return {
    date: night.calendar_date,
    sleep_score: night.sleep_score,
    sleep_score_qualifier: night.sleep_score_qualifier,
    total_sleep_s: night.total_sleep_s,
    deep_s: night.deep_s,
    light_s: night.light_s,
    rem_s: night.rem_s,
    awake_s: night.awake_s,
    awake_count: night.awake_count,
    restlessness_qualifier: night.restlessness_qualifier,
    restlessness_value: null,
    avg_sleep_stress: night.avg_sleep_stress,
    avg_respiration: night.avg_respiration,
    hrv_last_night_ms: night.last_night_avg ?? null,
    hrv_weekly_avg_ms: night.weekly_avg ?? null,
    hrv_status: night.status ?? null,
    hrv_balanced_range_ms:
      night.baseline_balanced_low == null
        ? null
        : [night.baseline_balanced_low, night.baseline_balanced_upper],
    resting_hr: night.resting_hr ?? null,
    body_battery_gained_in_sleep: night.body_battery_during_sleep ?? null,
    body_battery_at_wake: night.body_battery_at_wake ?? null,
    sleep_start_local: night.sleep_start_local,
    sleep_end_local: night.sleep_end_local,
    computed: {
      total: formatDuration(night.total_sleep_s),
      deep: formatDuration(night.deep_s),
      light: formatDuration(night.light_s),
      rem: formatDuration(night.rem_s),
      awake: formatDuration(night.awake_s),
    },
  };
}

export function presentWellness(row: DailyWellnessRow) {
  const { fetched_at: _fetchedAt, calendar_date, ...metrics } = row;
  return { date: calendar_date, ...metrics };
}

function parseExtras(row: ActivityRow) {
  try {
    return JSON.parse(row.extras_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function presentActivitySummary(row: ActivityRow) {
  return {
    activity_id: row.activity_id,
    start_time_local: row.start_time_local,
    activity_type: row.activity_type,
    name: row.name,
    description: row.description,
    distance_m: row.distance_m,
    duration_s: row.duration_s,
    avg_hr: row.avg_hr,
    training_load: round(row.training_load),
    computed: {
      duration: formatDuration(row.duration_s),
      distance_km: row.distance_m == null ? null : round(row.distance_m / 1000, 2),
      avg_pace_per_km: formatPace(row.avg_speed_mps),
    },
  };
}

export function presentActivityDetail(row: ActivityRow) {
  const { extras_json: _extras, fetched_at: _fetchedAt, ...columns } = row;
  return {
    ...columns,
    ...parseExtras(row),
    computed: {
      duration: formatDuration(row.duration_s),
      moving_duration: formatDuration(row.moving_duration_s),
      distance_km: row.distance_m == null ? null : round(row.distance_m / 1000, 2),
      avg_pace_per_km: formatPace(row.avg_speed_mps),
      avg_grade_adjusted_pace_per_km: formatPace(row.avg_grade_adjusted_speed_mps),
    },
  };
}
