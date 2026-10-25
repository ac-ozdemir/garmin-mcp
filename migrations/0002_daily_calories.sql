-- Calories burned per day from the v2 daily summary (consumed calories are deliberately not stored).
ALTER TABLE daily_wellness ADD COLUMN burned_total_kcal INTEGER;
ALTER TABLE daily_wellness ADD COLUMN burned_active_kcal INTEGER;
ALTER TABLE daily_wellness ADD COLUMN burned_resting_kcal INTEGER;
