-- Run through scripts/migrate.ts with a separate migration owner, never the runtime login.
CREATE TABLE IF NOT EXISTS be_schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON be_schema_migrations FROM PUBLIC;

CREATE TABLE be_organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE be_memberships (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES be_organizations(id),
  issuer text NOT NULL, subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('resource','placement_owner','home_leader','mission_owner','client_liaison','asset_access_owner','administrator')),
  grants jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(grants) = 'array'),
  resource_id uuid, home_scope text,
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject), UNIQUE (organization_id, id)
);
CREATE TABLE be_resources (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  name text NOT NULL, home text NOT NULL, owner_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, owner_id) REFERENCES be_memberships(organization_id, id)
);
ALTER TABLE be_memberships ADD CONSTRAINT be_memberships_resource_fk
  FOREIGN KEY (organization_id, resource_id) REFERENCES be_resources(organization_id, id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE be_missions (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  name text NOT NULL, client_name text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);
-- A source-system reference is not accepted staffing and does not reserve capacity.
CREATE TABLE be_assignment_references (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  resource_id uuid NOT NULL, mission_id uuid NOT NULL, source_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, resource_id, mission_id, source_reference),
  FOREIGN KEY (organization_id, resource_id) REFERENCES be_resources(organization_id, id),
  FOREIGN KEY (organization_id, mission_id) REFERENCES be_missions(organization_id, id)
);
CREATE TABLE be_templates (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mission_onboarding','mission_offboarding','company_onboarding','company_offboarding')),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft','approved','retired')),
  policy_owner_id uuid,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, kind, version),
  FOREIGN KEY (organization_id, policy_owner_id) REFERENCES be_memberships(organization_id, id),
  CHECK (status <> 'approved' OR policy_owner_id IS NOT NULL)
);
CREATE TABLE be_journeys (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  resource_id uuid NOT NULL, mission_id uuid, assignment_id uuid, owner_id uuid NOT NULL, template_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mission_onboarding','mission_offboarding','company_onboarding','company_offboarding')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, resource_id) REFERENCES be_resources(organization_id, id),
  FOREIGN KEY (organization_id, mission_id) REFERENCES be_missions(organization_id, id),
  FOREIGN KEY (organization_id, assignment_id) REFERENCES be_assignment_references(organization_id, id),
  FOREIGN KEY (organization_id, owner_id) REFERENCES be_memberships(organization_id, id),
  FOREIGN KEY (organization_id, template_id) REFERENCES be_templates(organization_id, id)
);
CREATE TABLE be_obligations (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  journey_id uuid NOT NULL, owner_id uuid NOT NULL, fulfiller_id uuid NOT NULL, verifier_id uuid NOT NULL,
  instance_key text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('open','in_progress','waiting_external','submitted','rejected','satisfied','waived','expired','cancelled','superseded')),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, instance_key),
  FOREIGN KEY (organization_id, journey_id) REFERENCES be_journeys(organization_id, id),
  FOREIGN KEY (organization_id, owner_id) REFERENCES be_memberships(organization_id, id),
  FOREIGN KEY (organization_id, fulfiller_id) REFERENCES be_memberships(organization_id, id),
  FOREIGN KEY (organization_id, verifier_id) REFERENCES be_memberships(organization_id, id)
);
CREATE TABLE be_events (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  actor_id uuid NOT NULL, journey_id uuid, operation text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES be_memberships(organization_id, id),
  FOREIGN KEY (organization_id, journey_id) REFERENCES be_journeys(organization_id, id)
);
CREATE TABLE be_receipts (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), actor_id uuid NOT NULL, idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'), response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_id, idempotency_key),
  FOREIGN KEY (organization_id, actor_id) REFERENCES be_memberships(organization_id, id)
);
CREATE TABLE be_notices (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  resource_id uuid NOT NULL, journey_id uuid NOT NULL, title text NOT NULL, body text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, resource_id) REFERENCES be_resources(organization_id, id),
  FOREIGN KEY (organization_id, journey_id) REFERENCES be_journeys(organization_id, id)
);
CREATE TABLE be_acknowledgments (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), notice_id uuid NOT NULL, actor_id uuid NOT NULL,
  notice_revision integer NOT NULL CHECK (notice_revision > 0), acknowledged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, notice_id, actor_id, notice_revision),
  FOREIGN KEY (organization_id, notice_id) REFERENCES be_notices(organization_id, id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES be_memberships(organization_id, id)
);

CREATE INDEX be_memberships_resource_idx ON be_memberships(organization_id, resource_id);
CREATE UNIQUE INDEX be_memberships_active_resource_unique ON be_memberships(organization_id, resource_id) WHERE active AND resource_id IS NOT NULL;
CREATE INDEX be_resources_owner_idx ON be_resources(organization_id, owner_id);
CREATE INDEX be_journeys_resource_idx ON be_journeys(organization_id, resource_id, created_at DESC);
CREATE INDEX be_journeys_mission_idx ON be_journeys(organization_id, mission_id, created_at DESC);
CREATE INDEX be_journeys_owner_idx ON be_journeys(organization_id, owner_id);
CREATE INDEX be_obligations_journey_idx ON be_obligations(organization_id, journey_id);
CREATE INDEX be_obligations_owner_idx ON be_obligations(organization_id, owner_id, status);
CREATE INDEX be_events_journey_idx ON be_events(organization_id, journey_id, occurred_at DESC);
CREATE INDEX be_notices_resource_idx ON be_notices(organization_id, resource_id, published_at DESC);

CREATE FUNCTION be_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
CREATE FUNCTION be_reject_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BOOKENDS immutable records cannot be changed' USING ERRCODE = '55000'; END;
$$;
CREATE TRIGGER be_events_immutable BEFORE UPDATE OR DELETE ON be_events FOR EACH ROW EXECUTE FUNCTION be_reject_immutable_mutation();
CREATE TRIGGER be_receipts_immutable BEFORE UPDATE OR DELETE ON be_receipts FOR EACH ROW EXECUTE FUNCTION be_reject_immutable_mutation();

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['be_organizations','be_memberships','be_resources','be_missions','be_assignment_references','be_templates','be_journeys','be_obligations','be_notices','be_acknowledgments'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION be_touch_updated_at()', relation_name || '_updated', relation_name);
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['be_memberships','be_resources','be_missions','be_assignment_references','be_templates','be_journeys','be_obligations','be_events','be_receipts','be_notices','be_acknowledgments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('CREATE POLICY be_org_scope ON %I USING (organization_id = nullif(current_setting(''bookends.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''bookends.organization_id'', true), '''')::uuid)', relation_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', relation_name);
  END LOOP;
END;
$$;
ALTER TABLE be_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE be_organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY be_org_scope ON be_organizations
  USING (id = nullif(current_setting('bookends.organization_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('bookends.organization_id', true), '')::uuid);
-- The server sets these two values from verified OIDC claims before selecting membership.
-- This policy grants SELECT only; possessing a session cannot create or alter role grants.
CREATE POLICY be_identity_lookup ON be_memberships FOR SELECT
  USING (issuer = nullif(current_setting('bookends.issuer', true), '') AND subject = nullif(current_setting('bookends.subject', true), ''));
REVOKE ALL ON be_organizations FROM PUBLIC;
REVOKE ALL ON FUNCTION be_touch_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION be_reject_immutable_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF current_user = 'be_runtime' THEN RAISE EXCEPTION 'Use a separate migration owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'be_runtime') THEN
    BEGIN
      CREATE ROLE be_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Create the NOLOGIN, NOBYPASSRLS be_runtime role with a database administrator, then apply the documented grants.';
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'be_runtime') THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'be_runtime' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN
      RAISE EXCEPTION 'Existing be_runtime role does not satisfy least-privilege requirements';
    END IF;
    GRANT USAGE ON SCHEMA public TO be_runtime;
    -- Identity and membership are provisioned only by separate administrative credentials.
    GRANT SELECT ON be_organizations, be_memberships TO be_runtime;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON be_organizations, be_memberships FROM be_runtime;
    GRANT SELECT, INSERT, UPDATE ON be_resources, be_missions, be_assignment_references, be_templates, be_journeys, be_obligations, be_notices TO be_runtime;
    REVOKE DELETE, TRUNCATE ON be_resources, be_missions, be_assignment_references, be_templates, be_journeys, be_obligations, be_notices FROM be_runtime;
    GRANT SELECT, INSERT ON be_events, be_receipts, be_acknowledgments TO be_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE ON be_events, be_receipts, be_acknowledgments FROM be_runtime;
    REVOKE ALL ON be_schema_migrations FROM be_runtime;
    GRANT EXECUTE ON FUNCTION be_touch_updated_at(), be_reject_immutable_mutation() TO be_runtime;
  END IF;
END;
$$;
