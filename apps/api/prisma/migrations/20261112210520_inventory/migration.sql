-- CreateEnum
CREATE TYPE "PartCategory" AS ENUM ('SCREEN', 'BATTERY', 'STORAGE', 'MEMORY', 'KEYBOARD', 'POWER', 'CABLE', 'BOARD', 'PERIPHERAL', 'CONSUMABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REPAIR_CONSUMPTION', 'REPAIR_RETURN');

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" "PartCategory" NOT NULL DEFAULT 'OTHER',
    "description" VARCHAR(1000),
    "location" VARCHAR(40),
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER NOT NULL DEFAULT 0,
    "average_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "supplier" VARCHAR(160),
    "reference" VARCHAR(80),
    "note" VARCHAR(1000),
    "repair_job_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parts_sku_key" ON "parts"("sku");

-- CreateIndex
CREATE INDEX "parts_name_idx" ON "parts"("name");

-- CreateIndex
CREATE INDEX "parts_category_is_active_idx" ON "parts"("category", "is_active");

-- CreateIndex
CREATE INDEX "stock_movements_part_id_created_at_idx" ON "stock_movements"("part_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_repair_job_id_part_id_idx" ON "stock_movements"("repair_job_id", "part_id");

-- CreateIndex
CREATE INDEX "stock_movements_type_created_at_idx" ON "stock_movements"("type", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_repair_job_id_fkey" FOREIGN KEY ("repair_job_id") REFERENCES "repair_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma cannot express (listed in docs/DATABASE.md).
-- ---------------------------------------------------------------------------

-- Stock can never go negative, and an archived part holds no stock.
ALTER TABLE "parts"
  ADD CONSTRAINT "parts_quantity_chk" CHECK ("quantity_on_hand" >= 0),
  ADD CONSTRAINT "parts_reorder_level_chk" CHECK ("reorder_level" >= 0),
  ADD CONSTRAINT "parts_average_cost_chk" CHECK ("average_cost_cents" >= 0),
  ADD CONSTRAINT "parts_sku_normalised_chk" CHECK ("sku" = upper(btrim("sku")) AND "sku" <> ''),
  ADD CONSTRAINT "parts_archived_empty_chk" CHECK ("is_active" OR "quantity_on_hand" = 0);

ALTER TABLE "stock_movements"
  -- Receipts add stock, issues remove it; a movement of zero means nothing.
  ADD CONSTRAINT "stock_movements_sign_chk" CHECK (
    ("type" IN ('PURCHASE', 'ADJUSTMENT_IN', 'REPAIR_RETURN') AND "quantity_change" > 0)
    OR ("type" IN ('ADJUSTMENT_OUT', 'REPAIR_CONSUMPTION') AND "quantity_change" < 0)
  ),
  ADD CONSTRAINT "stock_movements_balance_chk" CHECK ("balance_after" >= 0),
  ADD CONSTRAINT "stock_movements_cost_chk" CHECK ("unit_cost_cents" >= 0),
  -- Repair movements always name their job; other movements never do.
  ADD CONSTRAINT "stock_movements_repair_chk" CHECK (
    ("repair_job_id" IS NOT NULL) = ("type" IN ('REPAIR_CONSUMPTION', 'REPAIR_RETURN'))
  ),
  -- An adjustment must say why.
  ADD CONSTRAINT "stock_movements_note_chk" CHECK (
    "type" NOT IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') OR "note" IS NOT NULL
  );

-- The ledger is append-only. A new movement must carry the part's current balance,
-- and a repair job can return at most what it has used of a part.
CREATE FUNCTION "stock_movements_guard"() RETURNS trigger AS $$
DECLARE
  on_hand integer;
  used bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'stock_movements is append-only: record a correcting movement instead';
  END IF;

  SELECT "quantity_on_hand" INTO on_hand FROM "parts" WHERE "id" = NEW."part_id";
  IF on_hand IS DISTINCT FROM NEW."balance_after" THEN
    RAISE EXCEPTION 'movement balance % does not match the % in stock for part %',
      NEW."balance_after", on_hand, NEW."part_id";
  END IF;

  IF NEW."type" = 'REPAIR_RETURN' THEN
    SELECT COALESCE(-SUM("quantity_change"), 0) INTO used
      FROM "stock_movements"
      WHERE "repair_job_id" = NEW."repair_job_id" AND "part_id" = NEW."part_id";
    IF used < NEW."quantity_change" THEN
      RAISE EXCEPTION 'repair job % has used % of part %, so % cannot be returned',
        NEW."repair_job_id", used, NEW."part_id", NEW."quantity_change";
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movements_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_guard"();

-- At commit, a part's stock must equal the sum of its movements. Checked whenever
-- the stock figure changes and whenever a movement is written, so neither can
-- change without the other.
CREATE FUNCTION "stock_balance_matches_ledger"() RETURNS trigger AS $$
DECLARE
  part uuid;
  on_hand integer;
  ledger bigint;
BEGIN
  IF TG_TABLE_NAME = 'parts' THEN
    part := NEW."id";
  ELSE
    part := NEW."part_id";
  END IF;
  SELECT "quantity_on_hand" INTO on_hand FROM "parts" WHERE "id" = part;
  SELECT COALESCE(SUM("quantity_change"), 0) INTO ledger
    FROM "stock_movements" WHERE "part_id" = part;
  IF on_hand <> ledger THEN
    RAISE EXCEPTION 'part % has % in stock but its movements add up to %', part, on_hand, ledger;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "parts_balance_matches_ledger"
  AFTER INSERT OR UPDATE OF "quantity_on_hand" ON "parts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "stock_balance_matches_ledger"();

CREATE CONSTRAINT TRIGGER "stock_movements_balance_matches_ledger"
  AFTER INSERT ON "stock_movements"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "stock_balance_matches_ledger"();
