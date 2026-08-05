CREATE TABLE `prompt_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`extra_info` text DEFAULT '' NOT NULL,
	`source_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `prompts` ADD `version` text DEFAULT '1.0.0' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_prompt_versions_prompt_id` ON `prompt_versions` (`prompt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_prompt_versions_prompt_id_version` ON `prompt_versions` (`prompt_id`,`version`);