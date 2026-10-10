CREATE TABLE `ownership_transfer` (
	`kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `resource_id`),
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_punishment` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`origin_server_uuid` text,
	`type` text NOT NULL,
	`timestamp` integer NOT NULL,
	`duration` integer NOT NULL,
	`player_uuid` text NOT NULL,
	`player_ip` text NOT NULL,
	`player_display_name` text NOT NULL,
	`punisher_uuid` text NOT NULL,
	`punisher_display_name` text NOT NULL,
	`reason` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`origin_server_uuid`) REFERENCES `server`(`uuid`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_punishment`("id", "community_id", "origin_server_uuid", "type", "timestamp", "duration", "player_uuid", "player_ip", "player_display_name", "punisher_uuid", "punisher_display_name", "reason", "revoked_at", "created_at") SELECT "id", "community_id", "origin_server_uuid", "type", "timestamp", "duration", "player_uuid", "player_ip", "player_display_name", "punisher_uuid", "punisher_display_name", "reason", "revoked_at", "created_at" FROM `punishment`;--> statement-breakpoint
DROP TABLE `punishment`;--> statement-breakpoint
ALTER TABLE `__new_punishment` RENAME TO `punishment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `punishment_natural_key` ON `punishment` (`player_uuid`,`type`,`timestamp`,`origin_server_uuid`);--> statement-breakpoint
CREATE INDEX `punishment_community_idx` ON `punishment` (`community_id`);