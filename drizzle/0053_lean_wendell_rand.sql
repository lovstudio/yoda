ALTER TABLE `room_members` ADD `model` text;--> statement-breakpoint
ALTER TABLE `room_members` ADD `reasoning_effort` text;--> statement-breakpoint
ALTER TABLE `room_members` ADD `permission_mode` text;--> statement-breakpoint
ALTER TABLE `room_messages` ADD `visibility` text DEFAULT 'room' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_messages` ADD `delivery_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_messages` ADD `delivery_error` text;