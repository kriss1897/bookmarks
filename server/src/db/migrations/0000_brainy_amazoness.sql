CREATE TABLE `bookmarks` (
	`node_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`favicon` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`node_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`is_open` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`order_key` text
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`node_id` text NOT NULL,
	`data` text,
	`timestamp` integer NOT NULL,
	`device_id` text,
	`session_id` text
);
--> statement-breakpoint
CREATE TABLE `sync_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`last_sync_timestamp` integer,
	`last_operation_id` text,
	`device_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tree_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`data` text NOT NULL,
	`timestamp` integer NOT NULL,
	`version` integer NOT NULL
);
