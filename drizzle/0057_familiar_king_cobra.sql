CREATE TABLE `paradigms` (
	`id` text PRIMARY KEY NOT NULL,
	`kind_id` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
