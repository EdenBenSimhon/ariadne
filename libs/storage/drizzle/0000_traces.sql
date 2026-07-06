CREATE TABLE "traces" (
	"tenant_id" varchar(64) NOT NULL,
	"trace_id" char(32) NOT NULL,
	"root_service" varchar(128),
	"span_count" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"duration_ms" integer GENERATED ALWAYS AS ((EXTRACT(EPOCH FROM (end_time - start_time)) * 1000)::int) STORED,
	"has_error" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traces_pk" PRIMARY KEY("tenant_id","trace_id")
);
--> statement-breakpoint
CREATE INDEX "traces_time_idx" ON "traces" USING btree ("tenant_id","start_time");