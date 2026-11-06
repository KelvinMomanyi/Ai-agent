-- An immutable historical migration reads "Session" after it was renamed to
-- "session". Keep the credential table unchanged and expose only distinct shops.
-- Ordered before 20261105140000 so clean databases and reviewed retries work.
DO $$
DECLARE
  legacy_relation regclass := to_regclass('public."Session"');
  view_definition text;
BEGIN
  IF current_schema() IS DISTINCT FROM 'public'
     OR to_regclass('public."session"') IS NULL
     OR (SELECT relkind FROM pg_class WHERE oid=to_regclass('public."session"')) NOT IN ('r','p') THEN
    RAISE EXCEPTION 'Session migration compatibility requires the public.session table; inspect schema drift before retrying.';
  END IF;

  IF legacy_relation IS NULL THEN
    CREATE VIEW public."Session" AS SELECT DISTINCT "shop" FROM public."session";
    COMMENT ON VIEW public."Session" IS 'AOVBoost shop-only compatibility for 20261105140000_focused_cart_defaults';
  ELSE
    IF (SELECT relkind FROM pg_class WHERE oid=legacy_relation) <> 'v'
       OR obj_description(legacy_relation, 'pg_class') IS DISTINCT FROM
         'AOVBoost shop-only compatibility for 20261105140000_focused_cart_defaults' THEN
      RAISE EXCEPTION 'An unrelated public.Session relation already exists; it will not be replaced.';
    END IF;
    view_definition := replace(replace(replace(trim(regexp_replace(pg_get_viewdef(legacy_relation, true), '\s+', ' ', 'g')), '"session"', 'session'), '"shop"', 'shop'), '"public"', 'public');
    IF view_definition NOT IN (
      'SELECT DISTINCT shop FROM session;', 'SELECT DISTINCT shop FROM public.session;',
      'SELECT DISTINCT session.shop FROM session;', 'SELECT DISTINCT session.shop FROM public.session;'
    ) THEN
      RAISE EXCEPTION 'The Session compatibility view was changed; inspect it before retrying.';
    END IF;
  END IF;
END $$;
