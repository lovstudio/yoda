DROP TABLE `feature_artifacts`;--> statement-breakpoint
DROP TABLE `feature_events`;--> statement-breakpoint
DROP TABLE `feature_issues`;--> statement-breakpoint
DROP TABLE `feature_tasks`;--> statement-breakpoint
DROP TABLE `feature_workflow_owners`;--> statement-breakpoint
DROP TABLE `features`;--> statement-breakpoint
DROP TABLE `review_orchestrations`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_team_rooms_feature_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_team_rooms_active_feature_workflow_task`;--> statement-breakpoint
ALTER TABLE `team_rooms` DROP COLUMN `feature_id`;