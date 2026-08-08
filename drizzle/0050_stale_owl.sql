ALTER TABLE `agents` ADD `reasoning_effort` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `access_mode` text DEFAULT 'inherit' NOT NULL;