// The subset of Garmin Personal API DTOs this project reads.
// Field names follow Garmin's Personal API OpenAPI spec (Swagger page); every field is optional
// because Garmin omits null fields from responses entirely.

export interface SleepScoreItem {
  value?: number;
  qualifierKey?: string;
}

export interface DailySleepDTO {
  calendarDate: string;
  sleepTimeSeconds?: number | null;
  napTimeSeconds?: number | null;
  deepSleepSeconds?: number | null;
  lightSleepSeconds?: number | null;
  remSleepSeconds?: number | null;
  awakeSleepSeconds?: number | null;
  unmeasurableSleepSeconds?: number | null;
  awakeCount?: number | null;
  avgSleepStress?: number | null;
  averageRespirationValue?: number | null;
  sleepStartTimestampLocal?: number | null;
  sleepEndTimestampLocal?: number | null;
  sleepWindowConfirmed?: boolean | null;
  sleepScores?: Record<string, SleepScoreItem | undefined>;
}

export interface HrvSummaryDTO {
  calendarDate: string;
  weeklyAvg?: number | null;
  lastNightAvg?: number | null;
  lastNight5MinHigh?: number | null;
  status?: string | null;
  baseline?: { lowUpper?: number; balancedLow?: number; balancedUpper?: number } | null;
}

export interface HrvDailySummaryDTO {
  hrvSummaries?: HrvSummaryDTO[];
}

export interface UserDailySummaryV2DTO {
  calendarDate: string;
  heartRate?: { minValue?: number; maxValue?: number; restingValue?: number };
  bodyBattery?: { minValue?: number; maxValue?: number; chargedValue?: number; drainedValue?: number };
  stress?: { avgLevel?: number; maxLevel?: number; qualifier?: string };
  movement?: { steps?: { value?: number; goal?: number } };
  calories?: { burnedTotal?: number; burnedActive?: number; burnedResting?: number };
}

export interface DailySummariesV2Response {
  data?: UserDailySummaryV2DTO[];
}

/** v1 per-day summary; the only source of Body Battery gained during sleep. */
export interface UserDailySummaryDto {
  calendarDate?: string;
  bodyBatteryDuringSleep?: number | null;
  bodyBatteryAtWakeTime?: number | null;
  lastSevenDaysAvgRestingHeartRate?: number | null;
}

export interface SummarizedExerciseSet {
  category?: string;
  subCategory?: string;
  reps?: number;
  sets?: number;
  volume?: number;
  duration?: number;
  maxWeight?: number;
}

export interface MinimalSplitSummaryDTO {
  splitType?: string;
  noOfSplits?: number;
  distance?: number;
  duration?: number;
  averageSpeed?: number;
  averageHR?: number;
  maxHR?: number;
  avgStepFrequency?: number;
  avgStepLength?: number;
  totalAscent?: number;
}

export interface SummarizedActivityDTO {
  activityId: number;
  activityName?: string;
  description?: string;
  startTimeLocal?: string;
  startTimeGMT?: string;
  activityType?: { typeKey?: string };
  eventType?: { typeKey?: string };
  distance?: number;
  duration?: number;
  movingDuration?: number;
  elapsedDuration?: number;
  elevationGain?: number;
  averageSpeed?: number;
  avgGradeAdjustedSpeed?: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
  averageRunningCadenceInStepsPerMinute?: number;
  avgVerticalOscillation?: number;
  avgGroundContactTime?: number;
  avgStrideLength?: number;
  avgVerticalRatio?: number;
  avgPower?: number;
  aerobicTrainingEffect?: number;
  anaerobicTrainingEffect?: number;
  trainingEffectLabel?: string;
  activityTrainingLoad?: number;
  lapCount?: number;
  totalSets?: number;
  activeSets?: number;
  totalReps?: number;
  summarizedExerciseSets?: SummarizedExerciseSet[];
  splitSummaries?: MinimalSplitSummaryDTO[];
  hrTimeInZone_1?: number;
  hrTimeInZone_2?: number;
  hrTimeInZone_3?: number;
  hrTimeInZone_4?: number;
  hrTimeInZone_5?: number;
}

/** Detail endpoint; only used to find an activity's local start date. */
export interface ActivitySummaryDTO {
  activityId: number;
  description?: string;
  summaryDTO?: { startTimeLocal?: string };
}
