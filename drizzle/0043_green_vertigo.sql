ALTER TABLE `prompts` ADD `extra_info` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `injection_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `injection_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `source_json` text;