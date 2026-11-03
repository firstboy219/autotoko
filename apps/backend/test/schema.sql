--
-- PostgreSQL database dump
--

\restrict X5MVZotPqsaXl3z0PGSkCs6hwVzwZ9oO3cm7rCqDlsxbiTK2P43wdjHqzSq0WxZ

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: affiliate_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.affiliate_status AS ENUM (
    'prospect',
    'invited',
    'active',
    'rejected',
    'blacklist'
);


--
-- Name: chat_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_type AS ENUM (
    'buyer',
    'affiliate'
);


--
-- Name: fulfillment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fulfillment_status AS ENUM (
    'masuk',
    'approved',
    'produksi',
    'packing',
    'siap_kirim',
    'dikirim',
    'selesai',
    'retur',
    'dibatalkan'
);


--
-- Name: health_score; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.health_score AS ENUM (
    'A',
    'B',
    'C',
    'D'
);


--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invoice_status AS ENUM (
    'pending',
    'paid',
    'failed',
    'cancelled'
);


--
-- Name: invoice_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invoice_type AS ENUM (
    'setup_fee',
    'subscription',
    'topup'
);


--
-- Name: marketplace; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.marketplace AS ENUM (
    'tiktok',
    'shopee',
    'tokopedia',
    'lazada'
);


--
-- Name: notif_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notif_channel AS ENUM (
    'wa',
    'email',
    'in_app'
);


--
-- Name: payout_batch_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_batch_status AS ENUM (
    'running',
    'awaiting_transfer',
    'transferred',
    'completed',
    'berjalan',
    'siap_distribusi',
    'selesai'
);


--
-- Name: payout_disbursement_recipient_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_disbursement_recipient_type AS ENUM (
    'sedekah',
    'sub_seller',
    'sub_sub_seller',
    'bahan_baku'
);


--
-- Name: payout_disbursement_validation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_disbursement_validation_status AS ENUM (
    'belum_upload',
    'cocok_otomatis',
    'tidak_cocok',
    'override_manual'
);


--
-- Name: payout_forward_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_forward_status AS ENUM (
    'pending',
    'forwarded'
);


--
-- Name: payout_mutation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_mutation_status AS ENUM (
    'draft',
    'completed'
);


--
-- Name: plan_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.plan_type AS ENUM (
    'freemium',
    'starter',
    'pro'
);


--
-- Name: posting_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.posting_source AS ENUM (
    'manual',
    'api'
);


--
-- Name: posting_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.posting_status AS ENUM (
    'active',
    'inactive',
    'deleted',
    'under_review',
    'banned'
);


--
-- Name: product_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.product_status AS ENUM (
    'active',
    'inactive',
    'draft'
);


--
-- Name: restock_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.restock_method AS ENUM (
    'wa_owner',
    'wa_supplier',
    'supplier_api'
);


--
-- Name: sedekah_basis; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sedekah_basis AS ENUM (
    'total_credit',
    'after_subseller_split',
    'both_from_total'
);


--
-- Name: shop_added_by_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shop_added_by_type AS ENUM (
    'seller',
    'sub_seller',
    'sub_sub_seller'
);


--
-- Name: shop_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shop_status AS ENUM (
    'active',
    'deactivated',
    'suspended',
    'disconnected'
);


--
-- Name: sub_seller_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sub_seller_status AS ENUM (
    'active',
    'inactive'
);


--
-- Name: wa_login_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.wa_login_status AS ENUM (
    'pending',
    'verified',
    'expired'
);


--
-- Name: wallet_tx_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.wallet_tx_type AS ENUM (
    'topup',
    'deduct_subscription',
    'deduct_transaction',
    'deduct_setup',
    'refund'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: admin_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(128) NOT NULL,
    value text,
    description character varying(500),
    updated_by character varying(128),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: affiliates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    marketplace public.marketplace NOT NULL,
    creator_id character varying(128),
    creator_name character varying(255),
    follower_count integer,
    niche character varying(128),
    status public.affiliate_status DEFAULT 'prospect'::public.affiliate_status NOT NULL,
    commission_rate numeric(5,2),
    total_gmv numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    invited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.affiliates FORCE ROW LEVEL SECURITY;


--
-- Name: autopilot_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autopilot_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    feature character varying(64) NOT NULL,
    action character varying(64) NOT NULL,
    status character varying(16) NOT NULL,
    provider character varying(32),
    summary text,
    ref_type character varying(32),
    ref_id uuid,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.autopilot_activity FORCE ROW LEVEL SECURITY;


--
-- Name: bom_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bom_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_product_id uuid NOT NULL,
    material_name character varying(255) NOT NULL,
    quantity numeric(10,3) NOT NULL,
    unit character varying(32),
    current_stock numeric(10,3) DEFAULT '0'::numeric NOT NULL,
    minimum_threshold numeric(10,3) DEFAULT '0'::numeric NOT NULL,
    restock_method public.restock_method DEFAULT 'wa_owner'::public.restock_method NOT NULL,
    supplier_name character varying(255),
    supplier_shopee_url character varying(1000),
    supplier_wa_number character varying(32),
    supplier_api_url character varying(1000),
    supplier_api_key text,
    restock_qty numeric(10,3),
    restock_price numeric(15,2),
    payment_method character varying(32),
    shipping_address text,
    receiver_name character varying(255),
    receiver_phone character varying(32),
    notes_for_supplier text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    unit_cost numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    material_id uuid
);

ALTER TABLE ONLY public.bom_items FORCE ROW LEVEL SECURITY;


--
-- Name: chat_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    order_id uuid,
    chat_type public.chat_type NOT NULL,
    counterpart_id character varying(128),
    counterpart_name character varying(255),
    message_in text,
    message_out text,
    ai_model character varying(128),
    tokens_used integer,
    marketplace_sent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.chat_logs FORCE ROW LEVEL SECURITY;


--
-- Name: chat_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_settings (
    user_id uuid NOT NULL,
    auto_reply boolean DEFAULT false NOT NULL,
    auto_reply_shop_ids jsonb,
    office_start smallint,
    office_end smallint,
    fallback_text text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coupon_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_settings (
    user_id uuid NOT NULL,
    auto_sync boolean DEFAULT true NOT NULL,
    alert_expiry boolean DEFAULT true NOT NULL,
    expiry_days smallint DEFAULT 3 NOT NULL,
    alert_limit boolean DEFAULT true NOT NULL,
    limit_pct smallint DEFAULT 80 NOT NULL,
    alert_zero_claim boolean DEFAULT true NOT NULL,
    zero_claim_days smallint DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_couriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_couriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.custom_couriers FORCE ROW LEVEL SECURITY;


--
-- Name: email_otp_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_otp_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    code_hash character varying(128) NOT NULL,
    status public.wa_login_status DEFAULT 'pending'::public.wa_login_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone
);


--
-- Name: fulfillment_api_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fulfillment_api_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    marketplace public.marketplace NOT NULL,
    package_id character varying(128) NOT NULL,
    marketplace_order_id character varying(128),
    status character varying(64),
    tracking_number character varying(128),
    shipping_provider character varying(128),
    raw jsonb,
    updated_at_marketplace timestamp with time zone,
    api_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fulfillment_api_snapshots FORCE ROW LEVEL SECURITY;


--
-- Name: kb_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(16) DEFAULT 'chat'::character varying NOT NULL,
    keywords text NOT NULL,
    answer text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_catalogs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_catalogs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    note text,
    match_key character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_catalogs FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid,
    marketplace character varying(32) DEFAULT 'tiktok'::character varying NOT NULL,
    conversation_id character varying(128) NOT NULL,
    buyer_name character varying(255),
    last_message text,
    last_message_at timestamp with time zone,
    unread integer DEFAULT 0 NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_conversations FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid,
    coupon_id character varying(64) NOT NULL,
    title text,
    status character varying(24),
    display_type character varying(24),
    product_scope character varying(32),
    target_buyer_segment character varying(32),
    creation_source character varying(32),
    discount_type character varying(24),
    discount_amount numeric(15,2),
    discount_pct numeric(6,2),
    max_discount numeric(15,2),
    currency character varying(8),
    min_spend numeric(15,2),
    claim_start timestamp with time zone,
    claim_end timestamp with time zone,
    redemption_limit integer,
    per_buyer_limit integer,
    claimed_count integer DEFAULT 0 NOT NULL,
    redeemed_count integer DEFAULT 0 NOT NULL,
    raw jsonb,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    marketplace_message_id character varying(128),
    direction character varying(16) NOT NULL,
    sender character varying(16),
    text text,
    status character varying(16) DEFAULT 'sent'::character varying NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_messages FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    marketplace character varying(32) NOT NULL,
    product_id character varying(64) NOT NULL,
    title text,
    status character varying(40),
    raw jsonb,
    updated_at_marketplace timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    catalog_id uuid
);

ALTER TABLE ONLY public.marketplace_products FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid,
    marketplace character varying(32) DEFAULT 'tiktok'::character varying NOT NULL,
    return_id character varying(128) NOT NULL,
    order_id character varying(64),
    return_type character varying(48),
    return_status character varying(64),
    arbitration_status character varying(48),
    role character varying(24),
    reason_text text,
    refund_total numeric(15,2),
    currency character varying(8),
    buyer_user_id character varying(64),
    line_items jsonb,
    seller_next_action character varying(64),
    next_action_deadline timestamp with time zone,
    return_create_time timestamp with time zone,
    return_update_time timestamp with time zone,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_returns FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_sku_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_sku_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    marketplace character varying(32) NOT NULL,
    sku character varying(128) NOT NULL,
    master_product_id uuid NOT NULL,
    mapped_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_sku_map FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_skus (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    marketplace character varying(32) NOT NULL,
    product_id character varying(64),
    sku_id character varying(64) NOT NULL,
    seller_sku character varying(128),
    sku_name character varying(255),
    product_name character varying(500),
    price numeric(15,2),
    currency character varying(8),
    stock integer,
    raw jsonb,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_skus FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_statement_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_statement_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    statement_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(24) NOT NULL,
    external_ref character varying(64),
    occurred_on date NOT NULL,
    amount numeric(15,2) NOT NULL,
    bank_account character varying(64),
    status character varying(32),
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_statement_lines FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_statements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_statements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid,
    marketplace character varying(24) NOT NULL,
    source character varying(24) DEFAULT 'report_import'::character varying NOT NULL,
    period_from date,
    period_to date,
    currency character varying(8),
    file_name character varying(255),
    file_hash text,
    settlement_amount numeric(15,2),
    total_income numeric(15,2),
    total_fees numeric(15,2),
    raw_summary jsonb,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketplace_statements FORCE ROW LEVEL SECURITY;


--
-- Name: marketplace_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    marketplace character varying(32) NOT NULL,
    kind character varying(16) NOT NULL,
    status character varying(16) DEFAULT 'running'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    since timestamp with time zone,
    watermark timestamp with time zone,
    pages integer DEFAULT 0 NOT NULL,
    fetched integer DEFAULT 0 NOT NULL,
    upserted integer DEFAULT 0 NOT NULL,
    error text,
    triggered_by character varying(16) DEFAULT 'manual'::character varying NOT NULL
);

ALTER TABLE ONLY public.marketplace_sync_runs FORCE ROW LEVEL SECURITY;


--
-- Name: master_posting_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_posting_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    master_posting_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    marketplace character varying(32) NOT NULL,
    product_id character varying(64) NOT NULL,
    status character varying(20) DEFAULT 'mapped'::character varying NOT NULL,
    last_applied_at timestamp with time zone,
    last_status character varying(20),
    last_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: master_posting_skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_posting_skus (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    master_posting_id uuid NOT NULL,
    combo jsonb DEFAULT '{}'::jsonb NOT NULL,
    combo_key character varying(255) NOT NULL,
    sku character varying(128),
    master_product_id uuid,
    price numeric(15,2),
    stock integer,
    image_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: master_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_postings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    category_id integer,
    brand character varying(255),
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    variant_groups jsonb DEFAULT '[]'::jsonb NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    auto_apply boolean DEFAULT false NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: master_product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_product_categories (
    product_id uuid NOT NULL,
    shop_category_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.master_product_categories FORCE ROW LEVEL SECURITY;


--
-- Name: master_product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_product_id uuid NOT NULL,
    sku character varying(128) NOT NULL,
    variant_name character varying(255),
    price numeric(15,2),
    stock integer DEFAULT 0 NOT NULL,
    images jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.master_product_variants FORCE ROW LEVEL SECURITY;


--
-- Name: master_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sku character varying(128) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    category_id integer,
    base_price numeric(15,2),
    weight_gram integer,
    images jsonb DEFAULT '[]'::jsonb,
    status public.product_status DEFAULT 'draft'::public.product_status NOT NULL,
    health_score public.health_score,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    marketplace_aliases text,
    shop_category_id uuid
);

ALTER TABLE ONLY public.master_products FORCE ROW LEVEL SECURITY;


--
-- Name: material_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    reason character varying(24) NOT NULL,
    ref_table character varying(32),
    ref_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.material_movements FORCE ROW LEVEL SECURITY;


--
-- Name: material_purchase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_purchase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid NOT NULL,
    user_id uuid NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    total_cost numeric(15,2) DEFAULT '0'::numeric,
    unit_cost numeric(15,2) DEFAULT '0'::numeric,
    created_material boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    qty_pcs numeric(14,3),
    content_per_pcs numeric(14,3),
    entered_content numeric(14,3),
    entered_unit character varying(32),
    raw_name character varying(255)
);

ALTER TABLE ONLY public.material_purchase_items FORCE ROW LEVEL SECURITY;


--
-- Name: material_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    purchased_at date NOT NULL,
    supplier_name character varying(255),
    note text,
    receipt_url text,
    ocr_raw_result jsonb,
    total_cost numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resi character varying(64),
    source character varying(16) DEFAULT 'manual'::character varying NOT NULL,
    is_cod boolean DEFAULT false NOT NULL,
    cod_amount numeric(15,2),
    order_photo_url text
);

ALTER TABLE ONLY public.material_purchases FORCE ROW LEVEL SECURITY;


--
-- Name: materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    normalized_name character varying(255) NOT NULL,
    unit character varying(32),
    current_stock numeric(14,3) DEFAULT '0'::numeric NOT NULL,
    unit_cost numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    minimum_threshold numeric(14,3) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    unit_cost_updated_at timestamp with time zone,
    stock_level character varying(16),
    stock_level_at timestamp with time zone,
    shop_category_id uuid
);

ALTER TABLE ONLY public.materials FORCE ROW LEVEL SECURITY;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type character varying(128),
    title character varying(255),
    message text,
    channel public.notif_channel DEFAULT 'email'::public.notif_channel NOT NULL,
    sent boolean DEFAULT false NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;


--
-- Name: ocr_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(16) NOT NULL,
    raw_norm character varying(255) NOT NULL,
    raw_text text,
    target_id uuid,
    hits integer DEFAULT 1 NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_text character varying(64),
    CONSTRAINT ocr_corrections_has_target CHECK (((target_id IS NOT NULL) OR (target_text IS NOT NULL)))
);

ALTER TABLE ONLY public.ocr_corrections FORCE ROW LEVEL SECURITY;


--
-- Name: order_api_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_api_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    marketplace public.marketplace NOT NULL,
    marketplace_order_id character varying(128) NOT NULL,
    status character varying(64),
    buyer_name character varying(255),
    total_amount numeric(15,2),
    shipping_courier character varying(128),
    tracking_number character varying(128),
    payment_method character varying(64),
    items jsonb,
    raw jsonb,
    created_at_marketplace timestamp with time zone,
    api_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.order_api_snapshots FORCE ROW LEVEL SECURITY;


--
-- Name: order_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    note character varying(255),
    handover_method character varying(32),
    status character varying(16) DEFAULT 'processed'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resi_pdf_url character varying(255),
    packing_list_pdf_url character varying(255),
    result jsonb,
    error_message text
);

ALTER TABLE ONLY public.order_batches FORCE ROW LEVEL SECURITY;


--
-- Name: order_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_settings (
    user_id uuid NOT NULL,
    auto_siap_kirim boolean DEFAULT false NOT NULL,
    instant_couriers jsonb DEFAULT '["instant", "sameday", "same day", "same-day"]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    doc_type character varying(48) DEFAULT 'SHIPPING_LABEL_AND_PACKING_SLIP'::character varying NOT NULL,
    doc_size character varying(8) DEFAULT 'A6'::character varying NOT NULL,
    est_commission_rate numeric(5,4) DEFAULT 0.0800 NOT NULL
);

ALTER TABLE ONLY public.order_settings FORCE ROW LEVEL SECURITY;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    marketplace_order_id character varying(128) NOT NULL,
    marketplace public.marketplace NOT NULL,
    status character varying(64),
    buyer_name character varying(255),
    buyer_phone character varying(32),
    shipping_address jsonb,
    shipping_courier character varying(128),
    tracking_number character varying(128),
    payment_method character varying(64),
    subtotal numeric(15,2),
    shipping_fee numeric(15,2),
    marketplace_fee numeric(15,2),
    total_amount numeric(15,2),
    platform_fee numeric(15,2),
    fee_deducted boolean DEFAULT false NOT NULL,
    awb_generated boolean DEFAULT false NOT NULL,
    label_printed boolean DEFAULT false NOT NULL,
    items jsonb,
    created_at_marketplace timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fulfillment_status character varying(32) DEFAULT 'masuk'::character varying NOT NULL,
    raw jsonb,
    updated_at_marketplace timestamp with time zone,
    commerce_platform character varying(32),
    hold_reason text,
    held_at timestamp with time zone,
    batch_id uuid,
    awb_url character varying(255),
    price_detail jsonb,
    tracking_last jsonb
);

ALTER TABLE ONLY public.orders FORCE ROW LEVEL SECURITY;


--
-- Name: packing_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packing_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    material_id uuid NOT NULL,
    default_quantity numeric(14,3) DEFAULT '1'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.packing_materials FORCE ROW LEVEL SECURITY;


--
-- Name: packing_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packing_settings (
    user_id uuid NOT NULL,
    fee_per_resi numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.packing_settings FORCE ROW LEVEL SECURITY;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(128) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.password_reset_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: payout_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mutation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    reason text NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.payout_adjustments FORCE ROW LEVEL SECURITY;


--
-- Name: payout_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_by_user_id uuid,
    status public.payout_batch_status NOT NULL,
    closed_at timestamp with time zone,
    total_transfer_to_admin numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    transfer_proof_url text,
    transferred_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    code character varying(3),
    admin_fee_amount numeric(15,2),
    admin_fee_proof_url text,
    admin_fee_proof_hash text,
    admin_fee_paid_at timestamp with time zone,
    seller_transfer_proof_url text,
    seller_transfer_proof_hash text,
    seller_transfer_paid_at timestamp with time zone
);

ALTER TABLE ONLY public.payout_batches FORCE ROW LEVEL SECURITY;


--
-- Name: payout_carryovers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_carryovers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    recipient_type public.payout_disbursement_recipient_type NOT NULL,
    recipient_sub_seller_id uuid,
    recipient_sub_sub_seller_id uuid,
    amount numeric(15,2) NOT NULL,
    source_batch_id uuid NOT NULL,
    applied_batch_id uuid,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.payout_carryovers FORCE ROW LEVEL SECURITY;


--
-- Name: payout_disbursements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_disbursements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payout_mutation_id uuid,
    user_id uuid NOT NULL,
    recipient_type public.payout_disbursement_recipient_type NOT NULL,
    recipient_sub_seller_id uuid,
    recipient_sub_sub_seller_id uuid,
    expected_amount numeric(15,2) NOT NULL,
    recorded_account character varying(255),
    proof_url text,
    ocr_amount numeric(15,2),
    ocr_account character varying(255),
    ocr_raw_result jsonb,
    validation_status public.payout_disbursement_validation_status DEFAULT 'belum_upload'::public.payout_disbursement_validation_status NOT NULL,
    override_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    batch_id uuid,
    carryover_amount numeric(15,2) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.payout_disbursements FORCE ROW LEVEL SECURITY;


--
-- Name: payout_mutations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_mutations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    payout_date date NOT NULL,
    marketplace_proof_amount numeric(15,2),
    credit_amount numeric(15,2) NOT NULL,
    receiving_account character varying(255),
    marketplace_proof_url text,
    sedekah_rate_used numeric(5,4) NOT NULL,
    sedekah_basis_used public.sedekah_basis NOT NULL,
    sub_seller_rate_used numeric(5,4),
    sub_sub_seller_rate_used numeric(5,4),
    sub_seller_id uuid,
    sub_sub_seller_id uuid,
    sedekah_amount numeric(15,2) NOT NULL,
    seller_amount numeric(15,2) NOT NULL,
    sub_seller_amount numeric(15,2),
    sub_sub_seller_amount numeric(15,2),
    sedekah_transfer_proof_url text,
    seller_transfer_proof_url text,
    sub_seller_transfer_proof_url text,
    sub_sub_seller_transfer_proof_url text,
    order_ref_ids jsonb,
    status public.payout_mutation_status DEFAULT 'draft'::public.payout_mutation_status NOT NULL,
    sub_seller_forward_status public.payout_forward_status,
    sub_sub_seller_forward_status public.payout_forward_status,
    note text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ocr_raw_result jsonb,
    ocr_suggested_amount numeric(15,2),
    seller_material_amount numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    material_reserve_rate_used numeric(5,4) DEFAULT 0.0000 NOT NULL,
    marketplace_proof_hash text,
    data_source character varying(16) DEFAULT 'manual'::character varying NOT NULL,
    external_ref character varying(64),
    reconciled_line_id uuid
);

ALTER TABLE ONLY public.payout_mutations FORCE ROW LEVEL SECURITY;


--
-- Name: payout_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sedekah_rate numeric(5,4) DEFAULT 0.0500 NOT NULL,
    sedekah_basis public.sedekah_basis DEFAULT 'total_credit'::public.sedekah_basis NOT NULL,
    sedekah_bank_account character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    default_sub_seller_rate numeric(5,4) DEFAULT 0.2000 NOT NULL,
    material_reserve_rate numeric(5,4) DEFAULT 0.0000 NOT NULL,
    material_bank_account character varying(255),
    min_transfer_amount numeric(15,2) DEFAULT 10000 NOT NULL,
    admin_fee_enabled boolean DEFAULT false NOT NULL,
    admin_fee_amount numeric(15,2) DEFAULT 20000 NOT NULL,
    wa_template_seller text,
    wa_template_sub_seller text,
    manual_input_marketplaces jsonb DEFAULT '["shopee"]'::jsonb
);

ALTER TABLE ONLY public.payout_settings FORCE ROW LEVEL SECURITY;


--
-- Name: platform_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type public.invoice_type NOT NULL,
    amount numeric(15,2) NOT NULL,
    status public.invoice_status DEFAULT 'pending'::public.invoice_status NOT NULL,
    midtrans_order_id character varying(255),
    midtrans_payment_url text,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.platform_invoices FORCE ROW LEVEL SECURITY;


--
-- Name: pricing_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_type public.plan_type NOT NULL,
    setup_fee numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    monthly_fee numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    per_transaction_fee numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    max_shops integer,
    max_orders_per_month integer,
    features jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    activity_fees jsonb DEFAULT '{}'::jsonb
);


--
-- Name: product_bundle_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_bundle_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bundle_product_id uuid NOT NULL,
    component_product_id uuid NOT NULL,
    quantity numeric(10,3) DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_costing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_costing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_product_id uuid NOT NULL,
    user_id uuid NOT NULL,
    service_cost_per_pcs numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    publish_price numeric(15,2),
    marketplace_fee_rate numeric(5,4) DEFAULT 0.1500 NOT NULL,
    event_rate numeric(5,4) DEFAULT 0.0500 NOT NULL,
    affiliator_rate numeric(5,4) DEFAULT 0.0500 NOT NULL,
    ads_rate numeric(5,4) DEFAULT '0'::numeric NOT NULL,
    ads_fixed_per_pcs numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    sedekah_rate numeric(5,4) DEFAULT 0.0500 NOT NULL,
    reseller_rate numeric(5,4) DEFAULT 0.2000 NOT NULL,
    target_profit_rate numeric(5,4) DEFAULT 0.2000 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    packing_cost_per_order numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    avg_units_per_order numeric(10,2) DEFAULT '1'::numeric NOT NULL,
    cod_enabled boolean
);

ALTER TABLE ONLY public.product_costing FORCE ROW LEVEL SECURITY;


--
-- Name: product_packing_quantities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_packing_quantities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_product_id uuid NOT NULL,
    packing_material_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL
);

ALTER TABLE ONLY public.product_packing_quantities FORCE ROW LEVEL SECURITY;


--
-- Name: product_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_postings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_product_id uuid,
    shop_id uuid NOT NULL,
    marketplace_item_id character varying(128),
    marketplace_sku character varying(128),
    title character varying(500),
    price numeric(15,2),
    stock integer,
    status public.posting_status DEFAULT 'active'::public.posting_status NOT NULL,
    views_7d integer DEFAULT 0 NOT NULL,
    sold_7d integer DEFAULT 0 NOT NULL,
    gmv_7d numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    review_score numeric(3,2),
    review_count integer DEFAULT 0 NOT NULL,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source public.posting_source DEFAULT 'manual'::public.posting_source NOT NULL,
    raw jsonb,
    api_synced_at timestamp with time zone
);

ALTER TABLE ONLY public.product_postings FORCE ROW LEVEL SECURITY;


--
-- Name: promotion_automation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_automation (
    user_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    dry_run boolean DEFAULT true NOT NULL,
    only_ongoing boolean DEFAULT true NOT NULL,
    min_uplift_pct numeric(6,2) DEFAULT 10 NOT NULL,
    require_profit boolean DEFAULT true NOT NULL,
    min_orders integer DEFAULT 5 NOT NULL,
    auto_extend boolean DEFAULT false NOT NULL,
    extend_days integer DEFAULT 7 NOT NULL,
    auto_replicate boolean DEFAULT false NOT NULL,
    replicate_discount_pct numeric(5,2) DEFAULT 10 NOT NULL,
    last_run_at timestamp with time zone,
    last_result jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: promotion_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    auto_join boolean DEFAULT false NOT NULL,
    activity_id character varying(128),
    discount_pct numeric(5,2) DEFAULT 10 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resi_scan_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resi_scan_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    scan_id uuid NOT NULL,
    code character varying(64) NOT NULL,
    format character varying(32),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.resi_scan_codes FORCE ROW LEVEL SECURITY;


--
-- Name: resi_scan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resi_scan_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resi_scan_id uuid NOT NULL,
    master_product_id uuid,
    raw_name character varying(255),
    raw_qty numeric(10,2),
    qty numeric(10,2) DEFAULT '1'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source character varying(16),
    match_score numeric(4,3)
);

ALTER TABLE ONLY public.resi_scan_items FORCE ROW LEVEL SECURITY;


--
-- Name: resi_scan_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resi_scan_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resi_scan_id uuid NOT NULL,
    user_id uuid NOT NULL,
    photo_url character varying(255) NOT NULL,
    page_no integer DEFAULT 2 NOT NULL,
    device_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.resi_scan_photos FORCE ROW LEVEL SECURITY;


--
-- Name: resi_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resi_scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    resi character varying(64) NOT NULL,
    resi_raw character varying(128),
    courier character varying(32),
    order_id uuid,
    source character varying(16) DEFAULT 'ocr'::character varying NOT NULL,
    device_label character varying(64),
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    previous_status character varying(32),
    photo_url character varying(255),
    barcode_format character varying(32),
    ocr_status character varying(16) DEFAULT 'none'::character varying NOT NULL,
    ocr_attempts integer DEFAULT 0 NOT NULL,
    ocr_at timestamp with time zone,
    ocr_text text,
    label_order_no character varying(128),
    label_recipient character varying(255),
    label_marketplace character varying(32),
    label_items jsonb,
    packer_paid_at timestamp with time zone,
    packer_paid_amount numeric(15,2),
    packer_note character varying(120),
    tracking_status character varying(120),
    tracking_category character varying(24),
    tracking_checked_at timestamp with time zone,
    label_sender_name character varying(160),
    label_sender_area character varying(160),
    label_recipient_area character varying(200),
    label_recipient_address character varying(400),
    label_service character varying(32),
    label_weight_kg numeric(10,3),
    label_cod boolean,
    label_sort_code character varying(48),
    label_package_id character varying(64),
    label_buyer_nickname character varying(120),
    label_qty_total numeric(10,2),
    label_ship_date character varying(32),
    label_edited_at timestamp with time zone,
    ocr_confidence numeric(5,2),
    device_text text,
    device_clarity numeric(5,2),
    items_confirmed_at timestamp with time zone,
    items_confirmed_by character varying(64),
    shop_id uuid,
    marketplace character varying(24),
    courier_confirmed character varying(32),
    mapping_confirmed_at timestamp with time zone,
    mapping_confirmed_by character varying(64),
    label_order_no_source character varying(16)
);

ALTER TABLE ONLY public.resi_scans FORCE ROW LEVEL SECURITY;


--
-- Name: review_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid NOT NULL,
    order_id uuid,
    marketplace_review_id character varying(128),
    rating integer,
    review_text text,
    reply_text text,
    ai_generated boolean DEFAULT true NOT NULL,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.review_logs FORCE ROW LEVEL SECURITY;


--
-- Name: shop_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(60) NOT NULL,
    color character varying(9),
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.shop_categories FORCE ROW LEVEL SECURITY;


--
-- Name: shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    marketplace public.marketplace NOT NULL,
    shop_id character varying(128) NOT NULL,
    shop_name character varying(255),
    shop_cipher character varying(255),
    open_id character varying(255),
    merchant_id character varying(255),
    seller_region character varying(8),
    access_token text,
    access_token_expire_at timestamp with time zone,
    refresh_token text,
    refresh_token_expire_at timestamp with time zone,
    shop_status public.shop_status DEFAULT 'active'::public.shop_status NOT NULL,
    last_sync_at timestamp with time zone,
    connected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sub_seller_id uuid,
    sub_sub_seller_id uuid,
    rate_override_sub_seller numeric(5,4),
    rate_override_sub_sub_seller numeric(5,4),
    added_by_type public.shop_added_by_type DEFAULT 'seller'::public.shop_added_by_type NOT NULL,
    added_by_id uuid,
    display_name character varying(255),
    category_id uuid,
    saldo_cutoff_date date,
    saldo_cutoff_amount numeric(15,2),
    saldo_last jsonb,
    saldo_last_at timestamp with time zone,
    saldo_frozen jsonb
);

ALTER TABLE ONLY public.shops FORCE ROW LEVEL SECURITY;


--
-- Name: staff_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sessions_valid_from timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.staff_accounts FORCE ROW LEVEL SECURITY;


--
-- Name: stock_request_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_request_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    material_id uuid,
    raw_name character varying(255),
    qty_pack numeric(15,3) DEFAULT 1 NOT NULL,
    pack_label character varying(32),
    content_per_pack numeric(15,3),
    content_unit character varying(16),
    qty_base numeric(15,3),
    base_unit character varying(16),
    unit_price numeric(15,2),
    total_price numeric(15,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.stock_request_items FORCE ROW LEVEL SECURITY;


--
-- Name: stock_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    screenshot_url character varying(1024) NOT NULL,
    note text,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    total_cost numeric(15,2) DEFAULT 0 NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.stock_requests FORCE ROW LEVEL SECURITY;


--
-- Name: sub_sellers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_sellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    contact character varying(64),
    login_email character varying(255),
    bank_account character varying(255),
    default_rate numeric(5,4) DEFAULT 0.2000 NOT NULL,
    status public.sub_seller_status DEFAULT 'active'::public.sub_seller_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kuota_toko_maksimal integer
);

ALTER TABLE ONLY public.sub_sellers FORCE ROW LEVEL SECURITY;


--
-- Name: sub_sub_sellers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_sub_sellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sub_seller_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    contact character varying(64),
    login_email character varying(255),
    bank_account character varying(255),
    default_rate numeric(5,4) DEFAULT 0.5000 NOT NULL,
    status public.sub_seller_status DEFAULT 'active'::public.sub_seller_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kuota_toko_maksimal integer
);

ALTER TABLE ONLY public.sub_sub_sellers FORCE ROW LEVEL SECURITY;


--
-- Name: subscription_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_packages (
    code character varying(64) NOT NULL,
    name character varying(120) NOT NULL,
    setup_fee numeric(15,2) DEFAULT 0 NOT NULL,
    monthly_fee numeric(15,2) DEFAULT 0 NOT NULL,
    per_transaction_fee numeric(15,2) DEFAULT 0 NOT NULL,
    max_shops integer,
    max_orders_per_month integer,
    features jsonb DEFAULT '{}'::jsonb,
    activity_fees jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_ui_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_ui_prefs (
    user_id uuid NOT NULL,
    nav jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_ui_prefs FORCE ROW LEVEL SECURITY;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255),
    whatsapp character varying(32),
    full_name character varying(255),
    plan_type public.plan_type DEFAULT 'freemium'::public.plan_type NOT NULL,
    plan_started_at timestamp with time zone,
    plan_expired_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    is_suspended boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    password_hash character varying(255),
    sessions_valid_from timestamp with time zone,
    package_code character varying(64)
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: wa_login_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_login_sessions (
    code character varying(20) NOT NULL,
    wa_number character varying(32),
    status public.wa_login_status DEFAULT 'pending'::public.wa_login_status NOT NULL,
    callback_token character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone
);


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_id uuid NOT NULL,
    type public.wallet_tx_type NOT NULL,
    amount numeric(15,2) NOT NULL,
    balance_before numeric(15,2) NOT NULL,
    balance_after numeric(15,2) NOT NULL,
    reference_id character varying(255),
    description character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    balance numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    currency character varying(8) DEFAULT 'IDR'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.wallets FORCE ROW LEVEL SECURITY;


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    marketplace public.marketplace NOT NULL,
    event_type character varying(128),
    event_id character varying(255) NOT NULL,
    shop_id uuid,
    payload jsonb,
    processed boolean DEFAULT false NOT NULL,
    processed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: admin_settings admin_settings_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_key_unique UNIQUE (key);


--
-- Name: admin_settings admin_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_pkey PRIMARY KEY (id);


--
-- Name: affiliates affiliates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_pkey PRIMARY KEY (id);


--
-- Name: autopilot_activity autopilot_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autopilot_activity
    ADD CONSTRAINT autopilot_activity_pkey PRIMARY KEY (id);


--
-- Name: bom_items bom_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_items
    ADD CONSTRAINT bom_items_pkey PRIMARY KEY (id);


--
-- Name: chat_logs chat_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_logs
    ADD CONSTRAINT chat_logs_pkey PRIMARY KEY (id);


--
-- Name: chat_settings chat_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_settings
    ADD CONSTRAINT chat_settings_pkey PRIMARY KEY (user_id);


--
-- Name: coupon_settings coupon_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_settings
    ADD CONSTRAINT coupon_settings_pkey PRIMARY KEY (user_id);


--
-- Name: custom_couriers custom_couriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_couriers
    ADD CONSTRAINT custom_couriers_pkey PRIMARY KEY (id);


--
-- Name: email_otp_sessions email_otp_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_otp_sessions
    ADD CONSTRAINT email_otp_sessions_pkey PRIMARY KEY (id);


--
-- Name: fulfillment_api_snapshots fulfillment_api_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfillment_api_snapshots
    ADD CONSTRAINT fulfillment_api_snapshots_pkey PRIMARY KEY (id);


--
-- Name: fulfillment_api_snapshots fulfillment_api_snapshots_shop_pkg_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfillment_api_snapshots
    ADD CONSTRAINT fulfillment_api_snapshots_shop_pkg_unique UNIQUE (shop_id, package_id);


--
-- Name: kb_entries kb_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entries
    ADD CONSTRAINT kb_entries_pkey PRIMARY KEY (id);


--
-- Name: marketplace_catalogs marketplace_catalogs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_catalogs
    ADD CONSTRAINT marketplace_catalogs_pkey PRIMARY KEY (id);


--
-- Name: marketplace_conversations marketplace_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_conversations
    ADD CONSTRAINT marketplace_conversations_pkey PRIMARY KEY (id);


--
-- Name: marketplace_conversations marketplace_conversations_unik; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_conversations
    ADD CONSTRAINT marketplace_conversations_unik UNIQUE (user_id, marketplace, conversation_id);


--
-- Name: marketplace_coupons marketplace_coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_coupons
    ADD CONSTRAINT marketplace_coupons_pkey PRIMARY KEY (id);


--
-- Name: marketplace_messages marketplace_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_messages
    ADD CONSTRAINT marketplace_messages_pkey PRIMARY KEY (id);


--
-- Name: marketplace_products marketplace_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_pkey PRIMARY KEY (id);


--
-- Name: marketplace_returns marketplace_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_returns
    ADD CONSTRAINT marketplace_returns_pkey PRIMARY KEY (id);


--
-- Name: marketplace_returns marketplace_returns_unik; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_returns
    ADD CONSTRAINT marketplace_returns_unik UNIQUE (user_id, marketplace, return_id);


--
-- Name: marketplace_sku_map marketplace_sku_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_sku_map
    ADD CONSTRAINT marketplace_sku_map_pkey PRIMARY KEY (id);


--
-- Name: marketplace_skus marketplace_skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_skus
    ADD CONSTRAINT marketplace_skus_pkey PRIMARY KEY (id);


--
-- Name: marketplace_statement_lines marketplace_statement_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_statement_lines
    ADD CONSTRAINT marketplace_statement_lines_pkey PRIMARY KEY (id);


--
-- Name: marketplace_statements marketplace_statements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_statements
    ADD CONSTRAINT marketplace_statements_pkey PRIMARY KEY (id);


--
-- Name: marketplace_sync_runs marketplace_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_sync_runs
    ADD CONSTRAINT marketplace_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: master_posting_mappings master_posting_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_posting_mappings
    ADD CONSTRAINT master_posting_mappings_pkey PRIMARY KEY (id);


--
-- Name: master_posting_skus master_posting_skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_posting_skus
    ADD CONSTRAINT master_posting_skus_pkey PRIMARY KEY (id);


--
-- Name: master_postings master_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_postings
    ADD CONSTRAINT master_postings_pkey PRIMARY KEY (id);


--
-- Name: master_product_categories master_product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_product_categories
    ADD CONSTRAINT master_product_categories_pkey PRIMARY KEY (product_id, shop_category_id);


--
-- Name: master_product_variants master_product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_product_variants
    ADD CONSTRAINT master_product_variants_pkey PRIMARY KEY (id);


--
-- Name: master_products master_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_products
    ADD CONSTRAINT master_products_pkey PRIMARY KEY (id);


--
-- Name: master_products master_products_user_sku_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_products
    ADD CONSTRAINT master_products_user_sku_unique UNIQUE (user_id, sku);


--
-- Name: material_movements material_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_movements
    ADD CONSTRAINT material_movements_pkey PRIMARY KEY (id);


--
-- Name: material_purchase_items material_purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_purchase_items
    ADD CONSTRAINT material_purchase_items_pkey PRIMARY KEY (id);


--
-- Name: material_purchases material_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_purchases
    ADD CONSTRAINT material_purchases_pkey PRIMARY KEY (id);


--
-- Name: materials materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);


--
-- Name: materials materials_user_normalized_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_user_normalized_unique UNIQUE (user_id, normalized_name);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: ocr_corrections ocr_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_corrections
    ADD CONSTRAINT ocr_corrections_pkey PRIMARY KEY (id);


--
-- Name: order_api_snapshots order_api_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_api_snapshots
    ADD CONSTRAINT order_api_snapshots_pkey PRIMARY KEY (id);


--
-- Name: order_api_snapshots order_api_snapshots_shop_order_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_api_snapshots
    ADD CONSTRAINT order_api_snapshots_shop_order_unique UNIQUE (shop_id, marketplace_order_id);


--
-- Name: order_batches order_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_batches
    ADD CONSTRAINT order_batches_pkey PRIMARY KEY (id);


--
-- Name: order_settings order_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_settings
    ADD CONSTRAINT order_settings_pkey PRIMARY KEY (user_id);


--
-- Name: orders orders_mp_order_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_mp_order_unique UNIQUE (marketplace, marketplace_order_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: packing_materials packing_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_materials
    ADD CONSTRAINT packing_materials_pkey PRIMARY KEY (id);


--
-- Name: packing_materials packing_materials_user_material_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_materials
    ADD CONSTRAINT packing_materials_user_material_unique UNIQUE (user_id, material_id);


--
-- Name: packing_settings packing_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_settings
    ADD CONSTRAINT packing_settings_pkey PRIMARY KEY (user_id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: payout_adjustments payout_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_pkey PRIMARY KEY (id);


--
-- Name: payout_batches payout_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_batches
    ADD CONSTRAINT payout_batches_pkey PRIMARY KEY (id);


--
-- Name: payout_carryovers payout_carryovers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_carryovers
    ADD CONSTRAINT payout_carryovers_pkey PRIMARY KEY (id);


--
-- Name: payout_disbursements payout_disbursements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_disbursements
    ADD CONSTRAINT payout_disbursements_pkey PRIMARY KEY (id);


--
-- Name: payout_mutations payout_mutations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_mutations
    ADD CONSTRAINT payout_mutations_pkey PRIMARY KEY (id);


--
-- Name: payout_settings payout_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_settings
    ADD CONSTRAINT payout_settings_pkey PRIMARY KEY (id);


--
-- Name: payout_settings payout_settings_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_settings
    ADD CONSTRAINT payout_settings_user_id_unique UNIQUE (user_id);


--
-- Name: platform_invoices platform_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_pkey PRIMARY KEY (id);


--
-- Name: pricing_config pricing_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_config
    ADD CONSTRAINT pricing_config_pkey PRIMARY KEY (id);


--
-- Name: product_bundle_items product_bundle_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundle_items
    ADD CONSTRAINT product_bundle_items_pkey PRIMARY KEY (id);


--
-- Name: product_costing product_costing_master_product_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costing
    ADD CONSTRAINT product_costing_master_product_id_unique UNIQUE (master_product_id);


--
-- Name: product_costing product_costing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costing
    ADD CONSTRAINT product_costing_pkey PRIMARY KEY (id);


--
-- Name: product_packing_quantities product_packing_qty_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_packing_quantities
    ADD CONSTRAINT product_packing_qty_unique UNIQUE (master_product_id, packing_material_id);


--
-- Name: product_packing_quantities product_packing_quantities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_packing_quantities
    ADD CONSTRAINT product_packing_quantities_pkey PRIMARY KEY (id);


--
-- Name: product_postings product_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_postings
    ADD CONSTRAINT product_postings_pkey PRIMARY KEY (id);


--
-- Name: promotion_automation promotion_automation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_automation
    ADD CONSTRAINT promotion_automation_pkey PRIMARY KEY (user_id);


--
-- Name: promotion_settings promotion_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_settings
    ADD CONSTRAINT promotion_settings_pkey PRIMARY KEY (id);


--
-- Name: promotion_settings promotion_settings_user_shop_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_settings
    ADD CONSTRAINT promotion_settings_user_shop_uq UNIQUE (user_id, shop_id);


--
-- Name: resi_scan_codes resi_scan_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_codes
    ADD CONSTRAINT resi_scan_codes_pkey PRIMARY KEY (id);


--
-- Name: resi_scan_items resi_scan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_items
    ADD CONSTRAINT resi_scan_items_pkey PRIMARY KEY (id);


--
-- Name: resi_scan_photos resi_scan_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_photos
    ADD CONSTRAINT resi_scan_photos_pkey PRIMARY KEY (id);


--
-- Name: resi_scans resi_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scans
    ADD CONSTRAINT resi_scans_pkey PRIMARY KEY (id);


--
-- Name: resi_scans resi_scans_user_resi_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scans
    ADD CONSTRAINT resi_scans_user_resi_unique UNIQUE (user_id, resi);


--
-- Name: review_logs review_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_logs
    ADD CONSTRAINT review_logs_pkey PRIMARY KEY (id);


--
-- Name: shop_categories shop_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_categories
    ADD CONSTRAINT shop_categories_pkey PRIMARY KEY (id);


--
-- Name: shop_categories shop_categories_user_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_categories
    ADD CONSTRAINT shop_categories_user_name_unique UNIQUE (user_id, name);


--
-- Name: shops shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_pkey PRIMARY KEY (id);


--
-- Name: staff_accounts staff_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_accounts
    ADD CONSTRAINT staff_accounts_pkey PRIMARY KEY (id);


--
-- Name: stock_request_items stock_request_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_request_items
    ADD CONSTRAINT stock_request_items_pkey PRIMARY KEY (id);


--
-- Name: stock_requests stock_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_requests
    ADD CONSTRAINT stock_requests_pkey PRIMARY KEY (id);


--
-- Name: sub_sellers sub_sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_sellers
    ADD CONSTRAINT sub_sellers_pkey PRIMARY KEY (id);


--
-- Name: sub_sub_sellers sub_sub_sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_sub_sellers
    ADD CONSTRAINT sub_sub_sellers_pkey PRIMARY KEY (id);


--
-- Name: subscription_packages subscription_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_packages
    ADD CONSTRAINT subscription_packages_pkey PRIMARY KEY (code);


--
-- Name: user_ui_prefs user_ui_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ui_prefs
    ADD CONSTRAINT user_ui_prefs_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_whatsapp_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_whatsapp_unique UNIQUE (whatsapp);


--
-- Name: wa_login_sessions wa_login_sessions_callback_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_login_sessions
    ADD CONSTRAINT wa_login_sessions_callback_token_unique UNIQUE (callback_token);


--
-- Name: wa_login_sessions wa_login_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_login_sessions
    ADD CONSTRAINT wa_login_sessions_pkey PRIMARY KEY (code);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_unique UNIQUE (user_id);


--
-- Name: webhook_events webhook_events_mp_event_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_mp_event_unique UNIQUE (marketplace, event_id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: affiliates_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX affiliates_user_idx ON public.affiliates USING btree (user_id);


--
-- Name: autopilot_activity_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX autopilot_activity_user_idx ON public.autopilot_activity USING btree (user_id);


--
-- Name: custom_couriers_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX custom_couriers_unique ON public.custom_couriers USING btree (user_id, lower((name)::text));


--
-- Name: custom_couriers_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custom_couriers_user_idx ON public.custom_couriers USING btree (user_id);


--
-- Name: fulfillment_api_snapshots_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfillment_api_snapshots_shop_idx ON public.fulfillment_api_snapshots USING btree (shop_id);


--
-- Name: invoices_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_user_idx ON public.platform_invoices USING btree (user_id);


--
-- Name: kb_entries_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_entries_user_idx ON public.kb_entries USING btree (user_id, kind);


--
-- Name: marketplace_catalogs_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_catalogs_key_idx ON public.marketplace_catalogs USING btree (user_id, match_key);


--
-- Name: marketplace_catalogs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_catalogs_user_idx ON public.marketplace_catalogs USING btree (user_id);


--
-- Name: marketplace_conversations_last_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_conversations_last_idx ON public.marketplace_conversations USING btree (user_id, last_message_at DESC);


--
-- Name: marketplace_conversations_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_conversations_user_idx ON public.marketplace_conversations USING btree (user_id);


--
-- Name: marketplace_coupons_unik; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX marketplace_coupons_unik ON public.marketplace_coupons USING btree (user_id, coupon_id);


--
-- Name: marketplace_coupons_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_coupons_user_idx ON public.marketplace_coupons USING btree (user_id, status);


--
-- Name: marketplace_messages_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_messages_conv_idx ON public.marketplace_messages USING btree (conversation_id, created_at);


--
-- Name: marketplace_messages_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_messages_user_idx ON public.marketplace_messages USING btree (user_id);


--
-- Name: marketplace_products_catalog_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_products_catalog_idx ON public.marketplace_products USING btree (catalog_id);


--
-- Name: marketplace_products_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_products_shop_idx ON public.marketplace_products USING btree (shop_id);


--
-- Name: marketplace_products_unik; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX marketplace_products_unik ON public.marketplace_products USING btree (user_id, marketplace, product_id);


--
-- Name: marketplace_returns_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_returns_status_idx ON public.marketplace_returns USING btree (user_id, return_status);


--
-- Name: marketplace_returns_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_returns_user_idx ON public.marketplace_returns USING btree (user_id);


--
-- Name: marketplace_sku_map_unik; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX marketplace_sku_map_unik ON public.marketplace_sku_map USING btree (user_id, marketplace, sku);


--
-- Name: marketplace_skus_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_skus_shop_idx ON public.marketplace_skus USING btree (shop_id);


--
-- Name: marketplace_skus_unik; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX marketplace_skus_unik ON public.marketplace_skus USING btree (user_id, marketplace, sku_id);


--
-- Name: marketplace_statement_lines_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_statement_lines_lookup_idx ON public.marketplace_statement_lines USING btree (user_id, kind, occurred_on);


--
-- Name: marketplace_statement_lines_ref_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX marketplace_statement_lines_ref_unique ON public.marketplace_statement_lines USING btree (user_id, external_ref) WHERE (external_ref IS NOT NULL);


--
-- Name: marketplace_statements_file_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX marketplace_statements_file_unique ON public.marketplace_statements USING btree (user_id, file_hash) WHERE (file_hash IS NOT NULL);


--
-- Name: marketplace_statements_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_statements_shop_idx ON public.marketplace_statements USING btree (user_id, shop_id, period_from);


--
-- Name: marketplace_sync_runs_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_sync_runs_shop_idx ON public.marketplace_sync_runs USING btree (shop_id, kind, started_at DESC);


--
-- Name: master_posting_mappings_posting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_posting_mappings_posting_idx ON public.master_posting_mappings USING btree (master_posting_id);


--
-- Name: master_posting_mappings_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_posting_mappings_shop_idx ON public.master_posting_mappings USING btree (shop_id);


--
-- Name: master_posting_mappings_unik; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX master_posting_mappings_unik ON public.master_posting_mappings USING btree (master_posting_id, shop_id, product_id);


--
-- Name: master_posting_skus_combo_unik; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX master_posting_skus_combo_unik ON public.master_posting_skus USING btree (master_posting_id, combo_key);


--
-- Name: master_posting_skus_master_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_posting_skus_master_idx ON public.master_posting_skus USING btree (master_product_id);


--
-- Name: master_posting_skus_posting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_posting_skus_posting_idx ON public.master_posting_skus USING btree (master_posting_id);


--
-- Name: master_postings_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_postings_user_idx ON public.master_postings USING btree (user_id);


--
-- Name: master_product_categories_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_product_categories_user_idx ON public.master_product_categories USING btree (user_id, shop_category_id);


--
-- Name: master_products_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_products_brand_idx ON public.master_products USING btree (user_id, shop_category_id);


--
-- Name: master_products_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_products_user_idx ON public.master_products USING btree (user_id);


--
-- Name: material_movements_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_movements_material_idx ON public.material_movements USING btree (material_id, created_at DESC);


--
-- Name: material_movements_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_movements_ref_idx ON public.material_movements USING btree (ref_table, ref_id);


--
-- Name: material_movements_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_movements_user_idx ON public.material_movements USING btree (user_id);


--
-- Name: material_purchase_items_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_purchase_items_material_idx ON public.material_purchase_items USING btree (material_id);


--
-- Name: material_purchase_items_purchase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_purchase_items_purchase_idx ON public.material_purchase_items USING btree (purchase_id);


--
-- Name: material_purchases_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_purchases_user_idx ON public.material_purchases USING btree (user_id);


--
-- Name: material_purchases_user_resi_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX material_purchases_user_resi_unique ON public.material_purchases USING btree (user_id, resi) WHERE (resi IS NOT NULL);


--
-- Name: materials_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_brand_idx ON public.materials USING btree (user_id, shop_category_id);


--
-- Name: materials_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_user_idx ON public.materials USING btree (user_id);


--
-- Name: ocr_corrections_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ocr_corrections_lookup_idx ON public.ocr_corrections USING btree (user_id, kind, hits DESC);


--
-- Name: ocr_corrections_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ocr_corrections_unique_idx ON public.ocr_corrections USING btree (user_id, kind, raw_norm, COALESCE((target_id)::text, ''::text), COALESCE(target_text, ''::character varying));


--
-- Name: order_api_snapshots_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_api_snapshots_shop_idx ON public.order_api_snapshots USING btree (shop_id);


--
-- Name: order_batches_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_batches_user_idx ON public.order_batches USING btree (user_id);


--
-- Name: orders_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_batch_idx ON public.orders USING btree (batch_id);


--
-- Name: orders_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_shop_idx ON public.orders USING btree (shop_id);


--
-- Name: orders_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_user_idx ON public.orders USING btree (user_id);


--
-- Name: packing_materials_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX packing_materials_user_idx ON public.packing_materials USING btree (user_id);


--
-- Name: password_reset_tokens_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_hash_idx ON public.password_reset_tokens USING btree (token_hash);


--
-- Name: password_reset_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_user_idx ON public.password_reset_tokens USING btree (user_id);


--
-- Name: payout_adjustments_mutation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_adjustments_mutation_idx ON public.payout_adjustments USING btree (mutation_id);


--
-- Name: payout_batches_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payout_batches_code_idx ON public.payout_batches USING btree (user_id, upper((code)::text)) WHERE (code IS NOT NULL);


--
-- Name: payout_batches_fee_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payout_batches_fee_hash_idx ON public.payout_batches USING btree (user_id, admin_fee_proof_hash) WHERE (admin_fee_proof_hash IS NOT NULL);


--
-- Name: payout_batches_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_batches_user_status_idx ON public.payout_batches USING btree (user_id, status);


--
-- Name: payout_carryovers_outstanding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_carryovers_outstanding_idx ON public.payout_carryovers USING btree (user_id, applied_at);


--
-- Name: payout_disbursements_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_disbursements_batch_idx ON public.payout_disbursements USING btree (batch_id);


--
-- Name: payout_disbursements_mutation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_disbursements_mutation_idx ON public.payout_disbursements USING btree (payout_mutation_id);


--
-- Name: payout_disbursements_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_disbursements_user_idx ON public.payout_disbursements USING btree (user_id);


--
-- Name: payout_mutations_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_mutations_batch_idx ON public.payout_mutations USING btree (batch_id);


--
-- Name: payout_mutations_dupe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_mutations_dupe_idx ON public.payout_mutations USING btree (user_id, shop_id, credit_amount);


--
-- Name: payout_mutations_proof_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_mutations_proof_hash_idx ON public.payout_mutations USING btree (user_id, marketplace_proof_hash) WHERE (marketplace_proof_hash IS NOT NULL);


--
-- Name: payout_mutations_reconciled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_mutations_reconciled_idx ON public.payout_mutations USING btree (user_id, reconciled_line_id) WHERE (reconciled_line_id IS NOT NULL);


--
-- Name: payout_mutations_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_mutations_shop_idx ON public.payout_mutations USING btree (shop_id);


--
-- Name: payout_mutations_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_mutations_user_date_idx ON public.payout_mutations USING btree (user_id, payout_date);


--
-- Name: postings_master_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX postings_master_idx ON public.product_postings USING btree (master_product_id);


--
-- Name: postings_mp_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX postings_mp_sku_idx ON public.product_postings USING btree (marketplace_sku);


--
-- Name: postings_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX postings_shop_idx ON public.product_postings USING btree (shop_id);


--
-- Name: postings_shop_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX postings_shop_item_idx ON public.product_postings USING btree (shop_id, marketplace_item_id);


--
-- Name: product_bundle_items_bundle_comp_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_bundle_items_bundle_comp_unique ON public.product_bundle_items USING btree (bundle_product_id, component_product_id);


--
-- Name: product_bundle_items_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_bundle_items_bundle_idx ON public.product_bundle_items USING btree (bundle_product_id);


--
-- Name: product_costing_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_costing_user_idx ON public.product_costing USING btree (user_id);


--
-- Name: product_packing_qty_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_packing_qty_product_idx ON public.product_packing_quantities USING btree (master_product_id);


--
-- Name: resi_scan_codes_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scan_codes_lookup_idx ON public.resi_scan_codes USING btree (user_id, code);


--
-- Name: resi_scan_codes_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scan_codes_scan_idx ON public.resi_scan_codes USING btree (scan_id);


--
-- Name: resi_scan_items_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scan_items_scan_idx ON public.resi_scan_items USING btree (resi_scan_id);


--
-- Name: resi_scan_photos_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scan_photos_scan_idx ON public.resi_scan_photos USING btree (resi_scan_id);


--
-- Name: resi_scans_ocr_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scans_ocr_status_idx ON public.resi_scans USING btree (ocr_status, scanned_at);


--
-- Name: resi_scans_packer_paid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scans_packer_paid_idx ON public.resi_scans USING btree (user_id, packer_paid_at);


--
-- Name: resi_scans_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scans_shop_idx ON public.resi_scans USING btree (user_id, shop_id, scanned_at DESC);


--
-- Name: resi_scans_unconfirmed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scans_unconfirmed_idx ON public.resi_scans USING btree (user_id, scanned_at DESC) WHERE (items_confirmed_at IS NULL);


--
-- Name: resi_scans_unmapped_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scans_unmapped_idx ON public.resi_scans USING btree (user_id, scanned_at DESC) WHERE (mapping_confirmed_at IS NULL);


--
-- Name: resi_scans_user_scanned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resi_scans_user_scanned_idx ON public.resi_scans USING btree (user_id, scanned_at);


--
-- Name: shop_categories_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shop_categories_user_idx ON public.shop_categories USING btree (user_id);


--
-- Name: shops_mp_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shops_mp_shop_idx ON public.shops USING btree (marketplace, shop_id);


--
-- Name: shops_sub_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shops_sub_seller_idx ON public.shops USING btree (sub_seller_id);


--
-- Name: shops_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shops_user_idx ON public.shops USING btree (user_id);


--
-- Name: staff_accounts_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX staff_accounts_email_unique ON public.staff_accounts USING btree (lower((email)::text));


--
-- Name: staff_accounts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_accounts_user_idx ON public.staff_accounts USING btree (user_id);


--
-- Name: stock_request_items_req_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_request_items_req_idx ON public.stock_request_items USING btree (request_id);


--
-- Name: stock_requests_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_requests_user_idx ON public.stock_requests USING btree (user_id);


--
-- Name: sub_sellers_login_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sub_sellers_login_email_uidx ON public.sub_sellers USING btree (login_email) WHERE (login_email IS NOT NULL);


--
-- Name: sub_sellers_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_sellers_user_idx ON public.sub_sellers USING btree (user_id);


--
-- Name: sub_sub_sellers_login_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sub_sub_sellers_login_email_uidx ON public.sub_sub_sellers USING btree (login_email) WHERE (login_email IS NOT NULL);


--
-- Name: sub_sub_sellers_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_sub_sellers_parent_idx ON public.sub_sub_sellers USING btree (sub_seller_id);


--
-- Name: sub_sub_sellers_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_sub_sellers_user_idx ON public.sub_sub_sellers USING btree (user_id);


--
-- Name: affiliates affiliates_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: autopilot_activity autopilot_activity_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autopilot_activity
    ADD CONSTRAINT autopilot_activity_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bom_items bom_items_master_product_id_master_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_items
    ADD CONSTRAINT bom_items_master_product_id_master_products_id_fk FOREIGN KEY (master_product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: bom_items bom_items_material_id_materials_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_items
    ADD CONSTRAINT bom_items_material_id_materials_id_fk FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE SET NULL;


--
-- Name: chat_logs chat_logs_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_logs
    ADD CONSTRAINT chat_logs_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: chat_logs chat_logs_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_logs
    ADD CONSTRAINT chat_logs_shop_id_shops_id_fk FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: chat_settings chat_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_settings
    ADD CONSTRAINT chat_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: coupon_settings coupon_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_settings
    ADD CONSTRAINT coupon_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: custom_couriers custom_couriers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_couriers
    ADD CONSTRAINT custom_couriers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: fulfillment_api_snapshots fulfillment_api_snapshots_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfillment_api_snapshots
    ADD CONSTRAINT fulfillment_api_snapshots_shop_id_shops_id_fk FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: kb_entries kb_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entries
    ADD CONSTRAINT kb_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_catalogs marketplace_catalogs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_catalogs
    ADD CONSTRAINT marketplace_catalogs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_conversations marketplace_conversations_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_conversations
    ADD CONSTRAINT marketplace_conversations_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE SET NULL;


--
-- Name: marketplace_conversations marketplace_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_conversations
    ADD CONSTRAINT marketplace_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_coupons marketplace_coupons_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_coupons
    ADD CONSTRAINT marketplace_coupons_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE SET NULL;


--
-- Name: marketplace_coupons marketplace_coupons_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_coupons
    ADD CONSTRAINT marketplace_coupons_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_messages marketplace_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_messages
    ADD CONSTRAINT marketplace_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.marketplace_conversations(id) ON DELETE CASCADE;


--
-- Name: marketplace_messages marketplace_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_messages
    ADD CONSTRAINT marketplace_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_products marketplace_products_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES public.marketplace_catalogs(id) ON DELETE SET NULL;


--
-- Name: marketplace_products marketplace_products_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: marketplace_products marketplace_products_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_returns marketplace_returns_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_returns
    ADD CONSTRAINT marketplace_returns_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE SET NULL;


--
-- Name: marketplace_returns marketplace_returns_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_returns
    ADD CONSTRAINT marketplace_returns_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_sku_map marketplace_sku_map_mapped_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_sku_map
    ADD CONSTRAINT marketplace_sku_map_mapped_by_fkey FOREIGN KEY (mapped_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketplace_sku_map marketplace_sku_map_master_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_sku_map
    ADD CONSTRAINT marketplace_sku_map_master_product_id_fkey FOREIGN KEY (master_product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: marketplace_sku_map marketplace_sku_map_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_sku_map
    ADD CONSTRAINT marketplace_sku_map_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_skus marketplace_skus_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_skus
    ADD CONSTRAINT marketplace_skus_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: marketplace_skus marketplace_skus_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_skus
    ADD CONSTRAINT marketplace_skus_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_statement_lines marketplace_statement_lines_statement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_statement_lines
    ADD CONSTRAINT marketplace_statement_lines_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES public.marketplace_statements(id) ON DELETE CASCADE;


--
-- Name: marketplace_statement_lines marketplace_statement_lines_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_statement_lines
    ADD CONSTRAINT marketplace_statement_lines_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_statements marketplace_statements_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_statements
    ADD CONSTRAINT marketplace_statements_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE SET NULL;


--
-- Name: marketplace_statements marketplace_statements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_statements
    ADD CONSTRAINT marketplace_statements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: marketplace_sync_runs marketplace_sync_runs_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_sync_runs
    ADD CONSTRAINT marketplace_sync_runs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: marketplace_sync_runs marketplace_sync_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_sync_runs
    ADD CONSTRAINT marketplace_sync_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: master_posting_mappings master_posting_mappings_master_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_posting_mappings
    ADD CONSTRAINT master_posting_mappings_master_posting_id_fkey FOREIGN KEY (master_posting_id) REFERENCES public.master_postings(id) ON DELETE CASCADE;


--
-- Name: master_posting_mappings master_posting_mappings_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_posting_mappings
    ADD CONSTRAINT master_posting_mappings_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: master_posting_mappings master_posting_mappings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_posting_mappings
    ADD CONSTRAINT master_posting_mappings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: master_posting_skus master_posting_skus_master_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_posting_skus
    ADD CONSTRAINT master_posting_skus_master_posting_id_fkey FOREIGN KEY (master_posting_id) REFERENCES public.master_postings(id) ON DELETE CASCADE;


--
-- Name: master_posting_skus master_posting_skus_master_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_posting_skus
    ADD CONSTRAINT master_posting_skus_master_product_id_fkey FOREIGN KEY (master_product_id) REFERENCES public.master_products(id) ON DELETE SET NULL;


--
-- Name: master_posting_skus master_posting_skus_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_posting_skus
    ADD CONSTRAINT master_posting_skus_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: master_postings master_postings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_postings
    ADD CONSTRAINT master_postings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: master_product_categories master_product_categories_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_product_categories
    ADD CONSTRAINT master_product_categories_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: master_product_categories master_product_categories_shop_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_product_categories
    ADD CONSTRAINT master_product_categories_shop_category_id_fkey FOREIGN KEY (shop_category_id) REFERENCES public.shop_categories(id) ON DELETE CASCADE;


--
-- Name: master_product_categories master_product_categories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_product_categories
    ADD CONSTRAINT master_product_categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: master_product_variants master_product_variants_master_product_id_master_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_product_variants
    ADD CONSTRAINT master_product_variants_master_product_id_master_products_id_fk FOREIGN KEY (master_product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: master_products master_products_shop_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_products
    ADD CONSTRAINT master_products_shop_category_id_fkey FOREIGN KEY (shop_category_id) REFERENCES public.shop_categories(id) ON DELETE SET NULL;


--
-- Name: master_products master_products_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_products
    ADD CONSTRAINT master_products_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: material_movements material_movements_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_movements
    ADD CONSTRAINT material_movements_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: material_movements material_movements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_movements
    ADD CONSTRAINT material_movements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: material_purchase_items material_purchase_items_material_id_materials_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_purchase_items
    ADD CONSTRAINT material_purchase_items_material_id_materials_id_fk FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: material_purchase_items material_purchase_items_purchase_id_material_purchases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_purchase_items
    ADD CONSTRAINT material_purchase_items_purchase_id_material_purchases_id_fk FOREIGN KEY (purchase_id) REFERENCES public.material_purchases(id) ON DELETE CASCADE;


--
-- Name: material_purchase_items material_purchase_items_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_purchase_items
    ADD CONSTRAINT material_purchase_items_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: material_purchases material_purchases_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_purchases
    ADD CONSTRAINT material_purchases_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: materials materials_shop_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_shop_category_id_fkey FOREIGN KEY (shop_category_id) REFERENCES public.shop_categories(id) ON DELETE SET NULL;


--
-- Name: materials materials_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ocr_corrections ocr_corrections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_corrections
    ADD CONSTRAINT ocr_corrections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_api_snapshots order_api_snapshots_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_api_snapshots
    ADD CONSTRAINT order_api_snapshots_shop_id_shops_id_fk FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: order_batches order_batches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_batches
    ADD CONSTRAINT order_batches_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_settings order_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_settings
    ADD CONSTRAINT order_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders orders_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.order_batches(id) ON DELETE SET NULL;


--
-- Name: orders orders_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shop_id_shops_id_fk FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: orders orders_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: packing_materials packing_materials_material_id_materials_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_materials
    ADD CONSTRAINT packing_materials_material_id_materials_id_fk FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: packing_materials packing_materials_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_materials
    ADD CONSTRAINT packing_materials_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: packing_settings packing_settings_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_settings
    ADD CONSTRAINT packing_settings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payout_adjustments payout_adjustments_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payout_adjustments payout_adjustments_mutation_id_payout_mutations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_mutation_id_payout_mutations_id_fk FOREIGN KEY (mutation_id) REFERENCES public.payout_mutations(id) ON DELETE CASCADE;


--
-- Name: payout_adjustments payout_adjustments_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payout_batches payout_batches_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_batches
    ADD CONSTRAINT payout_batches_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payout_batches payout_batches_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_batches
    ADD CONSTRAINT payout_batches_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payout_carryovers payout_carryovers_applied_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_carryovers
    ADD CONSTRAINT payout_carryovers_applied_batch_id_fkey FOREIGN KEY (applied_batch_id) REFERENCES public.payout_batches(id) ON DELETE SET NULL;


--
-- Name: payout_carryovers payout_carryovers_recipient_sub_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_carryovers
    ADD CONSTRAINT payout_carryovers_recipient_sub_seller_id_fkey FOREIGN KEY (recipient_sub_seller_id) REFERENCES public.sub_sellers(id) ON DELETE CASCADE;


--
-- Name: payout_carryovers payout_carryovers_recipient_sub_sub_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_carryovers
    ADD CONSTRAINT payout_carryovers_recipient_sub_sub_seller_id_fkey FOREIGN KEY (recipient_sub_sub_seller_id) REFERENCES public.sub_sub_sellers(id) ON DELETE CASCADE;


--
-- Name: payout_carryovers payout_carryovers_source_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_carryovers
    ADD CONSTRAINT payout_carryovers_source_batch_id_fkey FOREIGN KEY (source_batch_id) REFERENCES public.payout_batches(id) ON DELETE CASCADE;


--
-- Name: payout_carryovers payout_carryovers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_carryovers
    ADD CONSTRAINT payout_carryovers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payout_disbursements payout_disbursements_batch_id_payout_batches_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_disbursements
    ADD CONSTRAINT payout_disbursements_batch_id_payout_batches_id_fk FOREIGN KEY (batch_id) REFERENCES public.payout_batches(id) ON DELETE CASCADE;


--
-- Name: payout_disbursements payout_disbursements_payout_mutation_id_payout_mutations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_disbursements
    ADD CONSTRAINT payout_disbursements_payout_mutation_id_payout_mutations_id_fk FOREIGN KEY (payout_mutation_id) REFERENCES public.payout_mutations(id) ON DELETE CASCADE;


--
-- Name: payout_disbursements payout_disbursements_recipient_sub_seller_id_sub_sellers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_disbursements
    ADD CONSTRAINT payout_disbursements_recipient_sub_seller_id_sub_sellers_id_fk FOREIGN KEY (recipient_sub_seller_id) REFERENCES public.sub_sellers(id) ON DELETE SET NULL;


--
-- Name: payout_disbursements payout_disbursements_recipient_sub_sub_seller_id_sub_sub_seller; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_disbursements
    ADD CONSTRAINT payout_disbursements_recipient_sub_sub_seller_id_sub_sub_seller FOREIGN KEY (recipient_sub_sub_seller_id) REFERENCES public.sub_sub_sellers(id) ON DELETE SET NULL;


--
-- Name: payout_disbursements payout_disbursements_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_disbursements
    ADD CONSTRAINT payout_disbursements_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payout_mutations payout_mutations_batch_id_payout_batches_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_mutations
    ADD CONSTRAINT payout_mutations_batch_id_payout_batches_id_fk FOREIGN KEY (batch_id) REFERENCES public.payout_batches(id) ON DELETE CASCADE;


--
-- Name: payout_mutations payout_mutations_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_mutations
    ADD CONSTRAINT payout_mutations_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payout_mutations payout_mutations_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_mutations
    ADD CONSTRAINT payout_mutations_shop_id_shops_id_fk FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE RESTRICT;


--
-- Name: payout_mutations payout_mutations_sub_seller_id_sub_sellers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_mutations
    ADD CONSTRAINT payout_mutations_sub_seller_id_sub_sellers_id_fk FOREIGN KEY (sub_seller_id) REFERENCES public.sub_sellers(id) ON DELETE SET NULL;


--
-- Name: payout_mutations payout_mutations_sub_sub_seller_id_sub_sub_sellers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_mutations
    ADD CONSTRAINT payout_mutations_sub_sub_seller_id_sub_sub_sellers_id_fk FOREIGN KEY (sub_sub_seller_id) REFERENCES public.sub_sub_sellers(id) ON DELETE SET NULL;


--
-- Name: payout_mutations payout_mutations_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_mutations
    ADD CONSTRAINT payout_mutations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payout_settings payout_settings_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_settings
    ADD CONSTRAINT payout_settings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: platform_invoices platform_invoices_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: product_bundle_items product_bundle_items_bundle_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundle_items
    ADD CONSTRAINT product_bundle_items_bundle_product_id_fkey FOREIGN KEY (bundle_product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: product_bundle_items product_bundle_items_component_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_bundle_items
    ADD CONSTRAINT product_bundle_items_component_product_id_fkey FOREIGN KEY (component_product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: product_costing product_costing_master_product_id_master_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costing
    ADD CONSTRAINT product_costing_master_product_id_master_products_id_fk FOREIGN KEY (master_product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: product_costing product_costing_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costing
    ADD CONSTRAINT product_costing_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: product_packing_quantities product_packing_quantities_master_product_id_master_products_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_packing_quantities
    ADD CONSTRAINT product_packing_quantities_master_product_id_master_products_id FOREIGN KEY (master_product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: product_packing_quantities product_packing_quantities_packing_material_id_packing_material; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_packing_quantities
    ADD CONSTRAINT product_packing_quantities_packing_material_id_packing_material FOREIGN KEY (packing_material_id) REFERENCES public.packing_materials(id) ON DELETE CASCADE;


--
-- Name: product_postings product_postings_master_product_id_master_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_postings
    ADD CONSTRAINT product_postings_master_product_id_master_products_id_fk FOREIGN KEY (master_product_id) REFERENCES public.master_products(id) ON DELETE CASCADE;


--
-- Name: product_postings product_postings_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_postings
    ADD CONSTRAINT product_postings_shop_id_shops_id_fk FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: promotion_automation promotion_automation_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_automation
    ADD CONSTRAINT promotion_automation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: promotion_settings promotion_settings_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_settings
    ADD CONSTRAINT promotion_settings_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: promotion_settings promotion_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_settings
    ADD CONSTRAINT promotion_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: resi_scan_codes resi_scan_codes_scan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_codes
    ADD CONSTRAINT resi_scan_codes_scan_id_fkey FOREIGN KEY (scan_id) REFERENCES public.resi_scans(id) ON DELETE CASCADE;


--
-- Name: resi_scan_codes resi_scan_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_codes
    ADD CONSTRAINT resi_scan_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: resi_scan_items resi_scan_items_master_product_id_master_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_items
    ADD CONSTRAINT resi_scan_items_master_product_id_master_products_id_fk FOREIGN KEY (master_product_id) REFERENCES public.master_products(id) ON DELETE SET NULL;


--
-- Name: resi_scan_items resi_scan_items_resi_scan_id_resi_scans_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_items
    ADD CONSTRAINT resi_scan_items_resi_scan_id_resi_scans_id_fk FOREIGN KEY (resi_scan_id) REFERENCES public.resi_scans(id) ON DELETE CASCADE;


--
-- Name: resi_scan_photos resi_scan_photos_resi_scan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_photos
    ADD CONSTRAINT resi_scan_photos_resi_scan_id_fkey FOREIGN KEY (resi_scan_id) REFERENCES public.resi_scans(id) ON DELETE CASCADE;


--
-- Name: resi_scan_photos resi_scan_photos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scan_photos
    ADD CONSTRAINT resi_scan_photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: resi_scans resi_scans_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scans
    ADD CONSTRAINT resi_scans_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: resi_scans resi_scans_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scans
    ADD CONSTRAINT resi_scans_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE SET NULL;


--
-- Name: resi_scans resi_scans_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resi_scans
    ADD CONSTRAINT resi_scans_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: review_logs review_logs_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_logs
    ADD CONSTRAINT review_logs_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: review_logs review_logs_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_logs
    ADD CONSTRAINT review_logs_shop_id_shops_id_fk FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: shop_categories shop_categories_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_categories
    ADD CONSTRAINT shop_categories_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: shops shops_category_id_shop_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_category_id_shop_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.shop_categories(id) ON DELETE SET NULL;


--
-- Name: shops shops_sub_seller_id_sub_sellers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_sub_seller_id_sub_sellers_id_fk FOREIGN KEY (sub_seller_id) REFERENCES public.sub_sellers(id) ON DELETE SET NULL;


--
-- Name: shops shops_sub_sub_seller_id_sub_sub_sellers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_sub_sub_seller_id_sub_sub_sellers_id_fk FOREIGN KEY (sub_sub_seller_id) REFERENCES public.sub_sub_sellers(id) ON DELETE SET NULL;


--
-- Name: shops shops_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: staff_accounts staff_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_accounts
    ADD CONSTRAINT staff_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stock_request_items stock_request_items_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_request_items
    ADD CONSTRAINT stock_request_items_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE SET NULL;


--
-- Name: stock_request_items stock_request_items_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_request_items
    ADD CONSTRAINT stock_request_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.stock_requests(id) ON DELETE CASCADE;


--
-- Name: stock_request_items stock_request_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_request_items
    ADD CONSTRAINT stock_request_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stock_requests stock_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_requests
    ADD CONSTRAINT stock_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sub_sellers sub_sellers_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_sellers
    ADD CONSTRAINT sub_sellers_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sub_sub_sellers sub_sub_sellers_sub_seller_id_sub_sellers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_sub_sellers
    ADD CONSTRAINT sub_sub_sellers_sub_seller_id_sub_sellers_id_fk FOREIGN KEY (sub_seller_id) REFERENCES public.sub_sellers(id) ON DELETE CASCADE;


--
-- Name: sub_sub_sellers sub_sub_sellers_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_sub_sellers
    ADD CONSTRAINT sub_sub_sellers_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_ui_prefs user_ui_prefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ui_prefs
    ADD CONSTRAINT user_ui_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wallet_transactions wallet_transactions_wallet_id_wallets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_wallet_id_wallets_id_fk FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE CASCADE;


--
-- Name: wallets wallets_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: webhook_events webhook_events_shop_id_shops_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_shop_id_shops_id_fk FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE SET NULL;


--
-- Name: affiliates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;

--
-- Name: autopilot_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.autopilot_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: bom_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bom_items ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_couriers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_couriers ENABLE ROW LEVEL SECURITY;

--
-- Name: fulfillment_api_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fulfillment_api_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_catalogs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_catalogs ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_sku_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_sku_map ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_skus; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_skus ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_statement_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_statement_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_statements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_statements ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_sync_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_sync_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: master_product_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.master_product_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: master_product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.master_product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: master_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.master_products ENABLE ROW LEVEL SECURITY;

--
-- Name: material_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.material_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: material_purchase_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.material_purchase_items ENABLE ROW LEVEL SECURITY;

--
-- Name: material_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.material_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: materials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: ocr_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ocr_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: order_api_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_api_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: order_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: order_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: packing_materials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.packing_materials ENABLE ROW LEVEL SECURITY;

--
-- Name: packing_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.packing_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: password_reset_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_adjustments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_carryovers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_carryovers ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_disbursements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_disbursements ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_mutations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_mutations ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: product_costing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_costing ENABLE ROW LEVEL SECURITY;

--
-- Name: product_packing_quantities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_packing_quantities ENABLE ROW LEVEL SECURITY;

--
-- Name: product_postings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_postings ENABLE ROW LEVEL SECURITY;

--
-- Name: resi_scan_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resi_scan_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: resi_scan_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resi_scan_items ENABLE ROW LEVEL SECURITY;

--
-- Name: resi_scan_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resi_scan_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: resi_scans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resi_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: review_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shop_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: shops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_request_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_request_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: sub_sellers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sub_sellers ENABLE ROW LEVEL SECURITY;

--
-- Name: sub_sub_sellers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sub_sub_sellers ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.affiliates USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: autopilot_activity tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.autopilot_activity USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: bom_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.bom_items USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (master_product_id IN ( SELECT master_products.id
   FROM public.master_products
  WHERE (master_products.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (master_product_id IN ( SELECT master_products.id
   FROM public.master_products
  WHERE (master_products.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: chat_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.chat_logs USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: custom_couriers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.custom_couriers USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: fulfillment_api_snapshots tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.fulfillment_api_snapshots USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: marketplace_catalogs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_catalogs USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: marketplace_conversations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_conversations USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: marketplace_messages tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_messages USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: marketplace_products tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_products USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: marketplace_returns tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_returns USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: marketplace_sku_map tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_sku_map USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: marketplace_skus tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_skus USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: marketplace_statement_lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_statement_lines USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: marketplace_statements tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_statements USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: marketplace_sync_runs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.marketplace_sync_runs USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: master_product_categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.master_product_categories USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: master_product_variants tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.master_product_variants USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (master_product_id IN ( SELECT master_products.id
   FROM public.master_products
  WHERE (master_products.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (master_product_id IN ( SELECT master_products.id
   FROM public.master_products
  WHERE (master_products.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: master_products tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.master_products USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: material_movements tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.material_movements USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: material_purchase_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.material_purchase_items USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: material_purchases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.material_purchases USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: materials tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.materials USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: notifications tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notifications USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: ocr_corrections tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ocr_corrections USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: order_api_snapshots tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.order_api_snapshots USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: order_batches tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.order_batches USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: order_settings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.order_settings USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: orders tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.orders USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: packing_materials tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.packing_materials USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: packing_settings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.packing_settings USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: password_reset_tokens tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.password_reset_tokens USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: payout_adjustments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payout_adjustments USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: payout_batches tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payout_batches USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: payout_carryovers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payout_carryovers USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: payout_disbursements tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payout_disbursements USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: payout_mutations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payout_mutations USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: payout_settings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payout_settings USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: platform_invoices tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.platform_invoices USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: product_costing tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.product_costing USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: product_packing_quantities tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.product_packing_quantities USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (master_product_id IN ( SELECT master_products.id
   FROM public.master_products
  WHERE (master_products.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (master_product_id IN ( SELECT master_products.id
   FROM public.master_products
  WHERE (master_products.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: product_postings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.product_postings USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: resi_scan_codes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.resi_scan_codes USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: resi_scan_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.resi_scan_items USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (resi_scan_id IN ( SELECT resi_scans.id
   FROM public.resi_scans
  WHERE (resi_scans.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (resi_scan_id IN ( SELECT resi_scans.id
   FROM public.resi_scans
  WHERE (resi_scans.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: resi_scan_photos tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.resi_scan_photos USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: resi_scans tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.resi_scans USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: review_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.review_logs USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (shop_id IN ( SELECT shops.id
   FROM public.shops
  WHERE (shops.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));


--
-- Name: shop_categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.shop_categories USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: shops tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.shops USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: staff_accounts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.staff_accounts USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: stock_request_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.stock_request_items USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: stock_requests tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.stock_requests USING (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))) WITH CHECK (((current_setting('app.bypass'::text, true) = 'on'::text) OR (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: sub_sellers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.sub_sellers USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: sub_sub_sellers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.sub_sub_sellers USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: user_ui_prefs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.user_ui_prefs USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: users tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.users USING (((id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: wallets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.wallets USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text))) WITH CHECK (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.bypass'::text, true) = 'on'::text)));


--
-- Name: user_ui_prefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_ui_prefs ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict X5MVZotPqsaXl3z0PGSkCs6hwVzwZ9oO3cm7rCqDlsxbiTK2P43wdjHqzSq0WxZ

