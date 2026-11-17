-- XTL Food: fluxo de decisão de pré-pedidos — banco EXCLUSIVO do Disk Panquecão.
-- Execute SOMENTE depois das migrations 001-004, nunca em XTL ID/Jarbas/LinkSul.
BEGIN;
CREATE TABLE IF NOT EXISTS public.restaurant_preorder_reviews (
  restaurant_id text NOT NULL REFERENCES public.restaurant_catalogs(restaurant_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  order_ref text NOT NULL CHECK (order_ref ~ '^[0-9a-f]{8}$'),
  tracking_sha256 text NOT NULL CHECK (tracking_sha256 ~ '^[0-9a-f]{64}$'),
  customer_name text NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 80),
  customer_phone text NOT NULL CHECK (customer_phone ~ '^[0-9]{10,11}$'),
  items_snapshot jsonb NOT NULL CHECK (jsonb_typeof(items_snapshot) = 'array'),
  fulfillment_snapshot jsonb NOT NULL CHECK (jsonb_typeof(fulfillment_snapshot) = 'object'),
  payment_snapshot jsonb NOT NULL CHECK (jsonb_typeof(payment_snapshot) = 'object'),
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents integer CHECK (delivery_fee_cents >= 0),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN
    ('pending_review', 'approved', 'rejected', 'delivery_uncertain')),
  rejection_reason text CHECK (rejection_reason IS NULL OR length(rejection_reason) BETWEEN 5 AND 220),
  telegram_message_id bigint,
  reviewed_by bigint,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, request_id),
  UNIQUE (restaurant_id, order_ref),
  CHECK ((status = 'rejected' AND rejection_reason IS NOT NULL) OR
         (status <> 'rejected' AND rejection_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS preorder_reviews_status_idx
  ON public.restaurant_preorder_reviews(restaurant_id,status,created_at);
ALTER TABLE public.restaurant_preorder_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_preorder_reviews FROM PUBLIC, anon, authenticated;
COMMIT;
