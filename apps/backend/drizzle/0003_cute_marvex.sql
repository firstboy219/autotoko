CREATE TABLE IF NOT EXISTS "autopilot_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" varchar(64) NOT NULL,
	"action" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"provider" varchar(32),
	"summary" text,
	"ref_type" varchar(32),
	"ref_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopilot_activity" ADD CONSTRAINT "autopilot_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopilot_activity_user_idx" ON "autopilot_activity" USING btree ("user_id");