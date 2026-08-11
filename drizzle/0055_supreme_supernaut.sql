CREATE TABLE `runtime_instruction_file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_key` text NOT NULL,
	`runtime_id` text NOT NULL,
	`project_id` text,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `prompts` ADD `bindings_json` text DEFAULT '{"global":true,"projectIds":[]}' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_runtime_instruction_file_versions_file_key` ON `runtime_instruction_file_versions` (`file_key`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_runtime_instruction_file_versions_file_key_version` ON `runtime_instruction_file_versions` (`file_key`,`version`);