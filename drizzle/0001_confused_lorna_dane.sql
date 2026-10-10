CREATE TABLE `appeal` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`punishment_id` text NOT NULL,
	`community_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`contact` text,
	`decision_note` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`punishment_id`) REFERENCES `punishment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appeal_punishment_community` ON `appeal` (`punishment_id`,`community_id`);--> statement-breakpoint
CREATE INDEX `appeal_token_idx` ON `appeal` (`token_hash`);--> statement-breakpoint
CREATE INDEX `appeal_community_idx` ON `appeal` (`community_id`);--> statement-breakpoint
CREATE TABLE `appeal_message` (
	`id` text PRIMARY KEY NOT NULL,
	`appeal_id` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`appeal_id`) REFERENCES `appeal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `appeal_message_appeal_idx` ON `appeal_message` (`appeal_id`);--> statement-breakpoint
CREATE TABLE `punishment_override` (
	`community_id` text NOT NULL,
	`punishment_id` text NOT NULL,
	`appeal_id` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`community_id`, `punishment_id`),
	FOREIGN KEY (`community_id`) REFERENCES `community`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`punishment_id`) REFERENCES `punishment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appeal_id`) REFERENCES `appeal`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `punishment` ADD `revoked_by_user_id` text REFERENCES user(id);