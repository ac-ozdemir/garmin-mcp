// Pure DTO -> row mapping. Missing values become null, never 0.
import type { ActivityRow, DailyWellnessRow, HrvRow, SleepRow } from '../db/rows.ts';
import type {
  DailySleepDTO,
  HrvSummaryDTO,
  SummarizedActivityDTO,
  UserDailySummaryDto,
  UserDailySummaryV2DTO,
} from '../garmin/types.ts';

const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

/** Garmin's *TimestampLocal fields are epoch ms shifted to local time, so the UTC rendering is the wall clock. */
function localWallClock(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString().slice(0, 16);
}

/** Days without a recorded night come back as stubs with no durations; skip them. */
export function hasSleepData(dto: DailySleepDTO): boolean {
  return dto.sleepTimeSeconds != null;
}

export function toSleepRow(dto: DailySleepDTO, fetchedAt: string): SleepRow {
  const overall = dto.sleepScores?.overall;
  return {
    calendar_date: dto.calendarDate,
    sleep_score: orNull(overall?.value),
    // sleepQualityTypePK is documented but always null; the overall score's qualifier is what the app shows.
    sleep_score_qualifier: orNull(overall?.qualifierKey),
    restlessness_qualifier: orNull(dto.sleepScores?.restlessness?.qualifierKey),
    total_sleep_s: orNull(dto.sleepTimeSeconds),
    deep_s: orNull(dto.deepSleepSeconds),
    light_s: orNull(dto.lightSleepSeconds),
    rem_s: orNull(dto.remSleepSeconds),
    awake_s: orNull(dto.awakeSleepSeconds),
    unmeasurable_s: orNull(dto.unmeasurableSleepSeconds),
    nap_s: orNull(dto.napTimeSeconds),
    awake_count: orNull(dto.awakeCount),
    avg_sleep_stress: orNull(dto.avgSleepStress),
    avg_respiration: orNull(dto.averageRespirationValue),
    sleep_start_local: localWallClock(dto.sleepStartTimestampLocal),
    sleep_end_local: localWallClock(dto.sleepEndTimestampLocal),
    sleep_window_confirmed: dto.sleepWindowConfirmed == null ? null : Number(dto.sleepWindowConfirmed),
    fetched_at: fetchedAt,
  };
}

export function toHrvRow(dto: HrvSummaryDTO, fetchedAt: string): HrvRow {
  return {
    calendar_date: dto.calendarDate,
    last_night_avg: orNull(dto.lastNightAvg),
    last_night_5min_high: orNull(dto.lastNight5MinHigh),
    weekly_avg: orNull(dto.weeklyAvg),
    status: orNull(dto.status),
    baseline_low_upper: orNull(dto.baseline?.lowUpper),
    baseline_balanced_low: orNull(dto.baseline?.balancedLow),
    baseline_balanced_upper: orNull(dto.baseline?.balancedUpper),
    fetched_at: fetchedAt,
  };
}

/** v2 gives the range-friendly fields; v1 (optional, one call per day) adds the sleep Body Battery gain. */
export function toDailyWellnessRow(
  v2: UserDailySummaryV2DTO,
  v1: UserDailySummaryDto | undefined,
  fetchedAt: string,
): DailyWellnessRow {
  return {
    calendar_date: v2.calendarDate,
    resting_hr: orNull(v2.heartRate?.restingValue),
    resting_hr_7d_avg: orNull(v1?.lastSevenDaysAvgRestingHeartRate),
    min_hr: orNull(v2.heartRate?.minValue),
    max_hr: orNull(v2.heartRate?.maxValue),
    body_battery_min: orNull(v2.bodyBattery?.minValue),
    body_battery_max: orNull(v2.bodyBattery?.maxValue),
    body_battery_charged: orNull(v2.bodyBattery?.chargedValue),
    body_battery_drained: orNull(v2.bodyBattery?.drainedValue),
    body_battery_during_sleep: orNull(v1?.bodyBatteryDuringSleep),
    body_battery_at_wake: orNull(v1?.bodyBatteryAtWakeTime),
    stress_avg: orNull(v2.stress?.avgLevel),
    stress_max: orNull(v2.stress?.maxLevel),
    stress_qualifier: orNull(v2.stress?.qualifier),
    steps: orNull(v2.movement?.steps?.value),
    step_goal: orNull(v2.movement?.steps?.goal),
    burned_total_kcal: orNull(v2.calories?.burnedTotal),
    burned_active_kcal: orNull(v2.calories?.burnedActive),
    burned_resting_kcal: orNull(v2.calories?.burnedResting),
    fetched_at: fetchedAt,
  };
}

export function toActivityRow(dto: SummarizedActivityDTO, fetchedAt: string): ActivityRow {
  const zones = [
    dto.hrTimeInZone_1,
    dto.hrTimeInZone_2,
    dto.hrTimeInZone_3,
    dto.hrTimeInZone_4,
    dto.hrTimeInZone_5,
  ];
  const extras = {
    hr_time_in_zone_s: zones.every((z) => z == null) ? null : zones.map(orNull),
    split_summaries: orNull(dto.splitSummaries),
    exercise_sets: orNull(dto.summarizedExerciseSets),
  };
  return {
    activity_id: dto.activityId,
    start_time_local: orNull(dto.startTimeLocal),
    start_time_gmt: orNull(dto.startTimeGMT),
    activity_type: orNull(dto.activityType?.typeKey),
    event_type: orNull(dto.eventType?.typeKey),
    name: orNull(dto.activityName),
    // An empty description is the same as none.
    description: dto.description?.trim() ? dto.description : null,
    distance_m: orNull(dto.distance),
    duration_s: orNull(dto.duration),
    moving_duration_s: orNull(dto.movingDuration),
    elapsed_duration_s: orNull(dto.elapsedDuration),
    elevation_gain_m: orNull(dto.elevationGain),
    avg_speed_mps: orNull(dto.averageSpeed),
    avg_grade_adjusted_speed_mps: orNull(dto.avgGradeAdjustedSpeed),
    avg_hr: orNull(dto.averageHR),
    max_hr: orNull(dto.maxHR),
    calories: orNull(dto.calories),
    avg_run_cadence_spm: orNull(dto.averageRunningCadenceInStepsPerMinute),
    avg_vertical_oscillation_cm: orNull(dto.avgVerticalOscillation),
    avg_ground_contact_ms: orNull(dto.avgGroundContactTime),
    avg_stride_length_cm: orNull(dto.avgStrideLength),
    avg_vertical_ratio_pct: orNull(dto.avgVerticalRatio),
    avg_power_w: orNull(dto.avgPower),
    aerobic_training_effect: orNull(dto.aerobicTrainingEffect),
    anaerobic_training_effect: orNull(dto.anaerobicTrainingEffect),
    training_effect_label: orNull(dto.trainingEffectLabel),
    training_load: orNull(dto.activityTrainingLoad),
    lap_count: orNull(dto.lapCount),
    total_sets: orNull(dto.totalSets),
    active_sets: orNull(dto.activeSets),
    total_reps: orNull(dto.totalReps),
    extras_json: JSON.stringify(extras),
    fetched_at: fetchedAt,
  };
}
