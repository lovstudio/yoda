CREATE TABLE `room_members` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`conversation_id` text,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`runtime` text,
	`system_prompt` text DEFAULT '' NOT NULL,
	`auto_approve` integer DEFAULT false NOT NULL,
	`accent` text DEFAULT 'slate' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `team_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `room_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`author_member_id` text,
	`kind` text DEFAULT 'text' NOT NULL,
	`body` text NOT NULL,
	`mentions` text,
	`session_ref` text,
	`verdict` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `team_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_member_id`) REFERENCES `room_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `team_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`preset` text DEFAULT 'freeform' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_room_members_room_id` ON `room_members` (`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_members_room_handle` ON `room_members` (`room_id`,`handle`);--> statement-breakpoint
CREATE INDEX `idx_room_messages_room_id` ON `room_messages` (`room_id`);--> statement-breakpoint
CREATE INDEX `idx_room_messages_created_at` ON `room_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_team_rooms_project_id` ON `team_rooms` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_team_rooms_task_id` ON `team_rooms` (`task_id`);