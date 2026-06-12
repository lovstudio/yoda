CREATE TABLE `ai_lab_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'logo' NOT NULL,
	`brand_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`style_id` text NOT NULL,
	`engine` text NOT NULL,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`images` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_lab_generations_created_at` ON `ai_lab_generations` (`created_at`);