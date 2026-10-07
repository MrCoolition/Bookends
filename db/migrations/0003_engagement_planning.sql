-- Add SOW-backed team demand to the existing mission identity. Its organization
-- scope, journey references, runtime grants, revision and FORCE RLS stay intact.
-- NULL preserves legacy records until an administrator adds a structured plan.
ALTER TABLE be_missions ADD COLUMN engagement jsonb;
ALTER TABLE be_missions ADD CONSTRAINT be_missions_engagement_shape CHECK (
  engagement IS NULL OR COALESCE((
    jsonb_typeof(engagement) = 'object'
    AND engagement @> '{"version":1}'::jsonb
    AND engagement->>'status' IN ('draft','signed','complete')
    AND jsonb_typeof(engagement->'roles') = 'array'
    AND jsonb_array_length(engagement->'roles') BETWEEN 1 AND 100
  ), false)
);
COMMENT ON COLUMN be_missions.engagement IS
  'Versioned SOW and role demand plan. Dates are inclusive. Headcount and allocation are separate; this does not create staffing assignments.';

ALTER TABLE be_resources ADD COLUMN profile jsonb;
ALTER TABLE be_resources ADD CONSTRAINT be_resources_profile_shape CHECK (
  profile IS NULL OR COALESCE((
    jsonb_typeof(profile) = 'object'
    AND jsonb_typeof(profile->'roles') = 'array'
    AND jsonb_typeof(profile->'skills') = 'array'
    AND jsonb_array_length(profile->'roles') <= 30
    AND jsonb_array_length(profile->'skills') <= 100
  ), false)
);
COMMENT ON COLUMN be_resources.profile IS
  'Recorded delivery roles and skills for candidate discovery; separate from account permissions and staffing availability.';

-- Delivery capabilities are business vocabulary, never identity/permission roles.
-- Former names retain the meaning of already-recorded profiles and SOW demand.
CREATE TABLE be_capabilities (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('role','skill')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases)='array' AND jsonb_array_length(aliases)<=50),
  active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,id)
);
CREATE UNIQUE INDEX be_capabilities_name_unique ON be_capabilities(organization_id,kind,lower(trim(name)));
CREATE FUNCTION be_keep_capability_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Delivery capability identity and kind are immutable' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER be_capabilities_identity BEFORE UPDATE ON be_capabilities FOR EACH ROW EXECUTE FUNCTION be_keep_capability_identity();
CREATE TRIGGER be_capabilities_updated BEFORE UPDATE ON be_capabilities FOR EACH ROW EXECUTE FUNCTION be_touch_updated_at();
ALTER TABLE be_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE be_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY be_org_scope ON be_capabilities
  USING (organization_id=nullif(current_setting('bookends.organization_id',true),'')::uuid)
  WITH CHECK (organization_id=nullif(current_setting('bookends.organization_id',true),'')::uuid);
REVOKE ALL ON be_capabilities FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON be_capabilities TO be_runtime;
REVOKE DELETE,TRUNCATE ON be_capabilities FROM be_runtime;
REVOKE ALL ON FUNCTION be_keep_capability_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION be_keep_capability_identity() TO be_runtime;
