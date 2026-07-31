CREATE TABLE `workspace_terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_terminals_project_scope` ON `workspace_terminals` (`project_id`,`scope_id`);