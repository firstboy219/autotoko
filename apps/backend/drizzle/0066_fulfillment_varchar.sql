ALTER TABLE "orders" ALTER COLUMN "fulfillment_status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "fulfillment_status" TYPE varchar(32) USING "fulfillment_status"::text;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "fulfillment_status" SET DEFAULT 'masuk';
