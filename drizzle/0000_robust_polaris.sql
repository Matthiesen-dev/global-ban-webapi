CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `community` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `community_invite` (
	`community_id` text NOT NULL,
	`github_login` text NOT NULL,
	`role` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`community_id`, `github_login`),
	FOREIGN KEY (`community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `community_join_request` (
	`community_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`community_id`, `user_id`),
	FOREIGN KEY (`community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `community_member` (
	`community_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`community_id`, `user_id`),
	FOREIGN KEY (`community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `community_subscription` (
	`subscriber_community_id` text NOT NULL,
	`source_community_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`subscriber_community_id`, `source_community_id`),
	FOREIGN KEY (`subscriber_community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `punishment` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`origin_server_uuid` text NOT NULL,
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
	FOREIGN KEY (`origin_server_uuid`) REFERENCES `server`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `punishment_natural_key` ON `punishment` (`player_uuid`,`type`,`timestamp`,`origin_server_uuid`);--> statement-breakpoint
CREATE INDEX `punishment_community_idx` ON `punishment` (`community_id`);--> statement-breakpoint
CREATE TABLE `punishment_delivery` (
	`server_uuid` text NOT NULL,
	`punishment_id` text NOT NULL,
	`sync_type` text NOT NULL,
	`delivered_at` integer NOT NULL,
	PRIMARY KEY(`server_uuid`, `punishment_id`, `sync_type`),
	FOREIGN KEY (`server_uuid`) REFERENCES `server`(`uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`punishment_id`) REFERENCES `punishment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `server` (
	`uuid` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`community_id` text,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_public_id_unique` ON `server` (`public_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`github_login` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_github_login_unique` ON `user` (`github_login`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
