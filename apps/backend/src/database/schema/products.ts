import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  unique,
  date,
  boolean,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { shops } from "./shops";
import {
  productStatusEnum,
  healthScoreEnum,
  postingStatusEnum,
  restockMethodEnum,
} from "./enums";

// PRD Bagian 6 — Master Produk = single source of truth, linked to marketplace
// postings via SKU.
export const masterProducts = pgTable(
  "master_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sku: varchar("sku", { length: 128 }).notNull(), // primary SKU — links to postings
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    categoryId: integer("category_id"),
    basePrice: numeric("base_price", { precision: 15, scale: 2 }),
    weightGram: integer("weight_gram"),
    images: jsonb("images").$type<string[]>().default([]),
    status: productStatusEnum("status").notNull().default("draft"),
    healthScore: healthScoreEnum("health_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userSkuUnique: unique("master_products_user_sku_unique").on(t.userId, t.sku),
    userIdx: index("master_products_user_idx").on(t.userId),
  }),
);

export const masterProductVariants = pgTable("master_product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  masterProductId: uuid("master_product_id")
    .notNull()
    .references(() => masterProducts.id, { onDelete: "cascade" }),
  sku: varchar("sku", { length: 128 }).notNull(), // e.g. BBP-001-RED-XL
  variantName: varchar("variant_name", { length: 255 }),
  price: numeric("price", { precision: 15, scale: 2 }),
  stock: integer("stock").notNull().default(0),
  images: jsonb("images").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


/**
 * Shared material catalog — ONE row per physical material per tenant.
 *
 * bom_items is keyed per product, so the same material used by two products
 * produced two rows each with their own currentStock. Buying stock then had no
 * correct answer: adding to both double-counts, adding to one leaves the other
 * stale. This table is the single source of truth for stock and cost; bom_items
 * keeps only the per-product recipe quantity (takaran).
 */
export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    // Lowercased/collapsed name used for matching OCR text and preventing
    // near-duplicates like "Biji Kopi " vs "biji kopi".
    normalizedName: varchar("normalized_name", { length: 255 }).notNull(),
    unit: varchar("unit", { length: 32 }),
    currentStock: numeric("current_stock", { precision: 14, scale: 3 }).notNull().default("0"),
    // Weighted-average cost, recomputed on every purchase so HPP reflects what
    // the stock on hand actually cost rather than only the latest price.
    unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull().default("0"),
    minimumThreshold: numeric("minimum_threshold", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("materials_user_idx").on(t.userId),
    userNameUnique: unique("materials_user_normalized_unique").on(t.userId, t.normalizedName),
  }),
);

/** One recorded stock purchase (usually one uploaded receipt screenshot). */
export const materialPurchases = pgTable(
  "material_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purchasedAt: date("purchased_at").notNull(),
    supplierName: varchar("supplier_name", { length: 255 }),
    note: text("note"),
    /** The screenshot this was recapped from, kept as the audit trail. */
    receiptUrl: text("receipt_url"),
    /** Raw OCR text + parsed candidates, for correcting the parser later. */
    ocrRawResult: jsonb("ocr_raw_result"),
    totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("material_purchases_user_idx").on(t.userId),
  }),
);

/**
 * A line on a purchase. Stock movements are derived from these rows, so a
 * mis-typed purchase can be traced and reversed rather than silently baked
 * into a running total.
 */
export const materialPurchaseItems = pgTable(
  "material_purchase_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => materialPurchases.id, { onDelete: "cascade" }),
    // Denormalised so the user_id-keyed RLS policy covers this table too —
    // same approach payout_disbursements already uses.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    /** Total paid for this line; unitCost is derived as total / quantity. */
    totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull().default("0"),
    unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull().default("0"),
    /** True when this line created the material rather than topping one up. */
    createdMaterial: boolean("created_material").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    purchaseIdx: index("material_purchase_items_purchase_idx").on(t.purchaseId),
    materialIdx: index("material_purchase_items_material_idx").on(t.materialId),
  }),
);

// PRD Bagian 8.6 — Bill of Materials with full restock config.
/**
 * Packing materials — box, tape, bubble wrap — consumed once per SHIPMENT and
 * shared by every product.
 *
 * Separate from bom_items, which is a per-product recipe. A packing list that
 * had to be copied onto every product would drift the moment one product was
 * edited and the others were not, and adding a new product would silently ship
 * with no packing cost at all.
 *
 * Quantity is per shipment (per resi), the same basis as
 * costing_settings.packing_cost_per_order, and the two ADD UP: this covers
 * what comes out of the material catalogue, that one covers everything else
 * (handling, labour). Neither replaces the other, so an existing tenant with
 * no packing materials sees no change to their HPP.
 */
export const packingMaterials = pgTable(
  "packing_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    /**
     * Starting amount for a product that has not set its own.
     *
     * The LIST of packing materials is shared by every product, but the AMOUNT
     * is not — a large item takes a bigger box and more tape than a small one.
     * So this is only a default, and product_packing_quantities below holds
     * what each product actually uses.
     */
    defaultQuantity: numeric("default_quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One line per material: two rows for "Kardus" would be an editing
    // mistake, never an intent, and would quietly double the cost.
    userMaterialUnique: unique("packing_materials_user_material_unique").on(
      t.userId,
      t.materialId,
    ),
    userIdx: index("packing_materials_user_idx").on(t.userId),
  }),
);

/**
 * What ONE product uses of a shared packing material.
 *
 * Absent means "use the default". Storing only the differences keeps adding a
 * packing material from having to write a row for every product that exists,
 * and keeps changing the default meaningful for the products that never
 * needed their own figure.
 */
export const productPackingQuantities = pgTable(
  "product_packing_quantities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    masterProductId: uuid("master_product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" }),
    packingMaterialId: uuid("packing_material_id")
      .notNull()
      .references(() => packingMaterials.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  },
  (t) => ({
    productMaterialUnique: unique("product_packing_qty_unique").on(
      t.masterProductId,
      t.packingMaterialId,
    ),
    productIdx: index("product_packing_qty_product_idx").on(t.masterProductId),
  }),
);

export const bomItems = pgTable("bom_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  masterProductId: uuid("master_product_id")
    .notNull()
    .references(() => masterProducts.id, { onDelete: "cascade" }),
  // Links this recipe line to the shared material catalog, which owns the
  // STOCK and COST. Nullable so pre-catalog rows keep working; when set it
  // wins over the legacy per-row currentStock/unitCost below.
  materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
  materialName: varchar("material_name", { length: 255 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(), // per 1 product
  // Cost of ONE unit of this material, used to compute Harga Pokok Produksi.
  // Separate from restockPrice/restockQty below, which describe a supplier
  // purchase order rather than the costing basis.
  unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  unit: varchar("unit", { length: 32 }), // meter, gram, pcs
  currentStock: numeric("current_stock", { precision: 10, scale: 3 }).notNull().default("0"),
  minimumThreshold: numeric("minimum_threshold", { precision: 10, scale: 3 }).notNull().default("0"),
  restockMethod: restockMethodEnum("restock_method").notNull().default("wa_owner"),
  supplierName: varchar("supplier_name", { length: 255 }),
  supplierShopeeUrl: varchar("supplier_shopee_url", { length: 1000 }),
  supplierWaNumber: varchar("supplier_wa_number", { length: 32 }),
  supplierApiUrl: varchar("supplier_api_url", { length: 1000 }),
  supplierApiKey: text("supplier_api_key"), // encrypted
  restockQty: numeric("restock_qty", { precision: 10, scale: 3 }),
  restockPrice: numeric("restock_price", { precision: 15, scale: 2 }),
  paymentMethod: varchar("payment_method", { length: 32 }), // QRIS / COD / Transfer
  shippingAddress: text("shipping_address"),
  receiverName: varchar("receiver_name", { length: 255 }),
  receiverPhone: varchar("receiver_phone", { length: 32 }),
  notesForSupplier: text("notes_for_supplier"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// PRD Bagian 6 — postings (marketplace listings) linked to a master product.
export const productPostings = pgTable(
  "product_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    masterProductId: uuid("master_product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    marketplaceItemId: varchar("marketplace_item_id", { length: 128 }), // item_id / product_id
    marketplaceSku: varchar("marketplace_sku", { length: 128 }), // SKU used on the marketplace
    title: varchar("title", { length: 500 }),
    price: numeric("price", { precision: 15, scale: 2 }),
    stock: integer("stock"),
    status: postingStatusEnum("status").notNull().default("active"),
    views7d: integer("views_7d").notNull().default(0),
    sold7d: integer("sold_7d").notNull().default(0),
    gmv7d: numeric("gmv_7d", { precision: 15, scale: 2 }).notNull().default("0"),
    reviewScore: numeric("review_score", { precision: 3, scale: 2 }),
    reviewCount: integer("review_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    masterIdx: index("postings_master_idx").on(t.masterProductId),
    shopIdx: index("postings_shop_idx").on(t.shopId),
    // SKU matching is the heart of master<->posting linking (PRD Bagian 17.4)
    skuIdx: index("postings_mp_sku_idx").on(t.marketplaceSku),
  }),
);

// Harga Pokok Produksi + publish-price composition, one row per master
// product. Rates are stored per product (not read from payout settings) so a
// seller can model different marketplace/affiliator terms per item; the
// sedekah/reseller defaults mirror the tenant's payout settings for
// convenience but are independently editable.
export const productCosting = pgTable(
  "product_costing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    masterProductId: uuid("master_product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" })
      .unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Biaya jasa produksi per pcs, added on top of the material cost.
    serviceCostPerPcs: numeric("service_cost_per_pcs", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    // Packing/handling paid once per shipment (per resi). HPP is per product,
    // so this is divided by avgUnitsPerOrder to get the per-unit share.
    packingCostPerOrder: numeric("packing_cost_per_order", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    // Average units shipped per resi. 1 = every order ships a single unit.
    avgUnitsPerOrder: numeric("avg_units_per_order", { precision: 10, scale: 2 })
      .notNull()
      .default("1"),

    // The price listed on the marketplace. Null until the seller sets one.
    publishPrice: numeric("publish_price", { precision: 15, scale: 2 }),

    // Withheld by the marketplace, each as a share of the publish price.
    marketplaceFeeRate: numeric("marketplace_fee_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.1500"),
    eventRate: numeric("event_rate", { precision: 5, scale: 4 }).notNull().default("0.0500"),
    affiliatorRate: numeric("affiliator_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.0500"),

    // Borne by the seller, not withheld by the marketplace.
    adsRate: numeric("ads_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    adsFixedPerPcs: numeric("ads_fixed_per_pcs", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),

    // Applied when the seller withdraws the payout (mirrors the Pencairan module).
    sedekahRate: numeric("sedekah_rate", { precision: 5, scale: 4 }).notNull().default("0.0500"),
    resellerRate: numeric("reseller_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.2000"),

    // Used by the "hitung harga publish dari target" helper.
    targetProfitRate: numeric("target_profit_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.2000"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("product_costing_user_idx").on(t.userId),
  }),
);
