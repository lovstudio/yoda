CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`task_id` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	`error` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `automations` ADD `trigger_kind` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` ADD `cron_expr` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `timezone` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `next_run_at` text;--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_id` ON `automation_runs` (`automation_id`);