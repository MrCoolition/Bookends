-- Stable configuration identifiers preserve the meaning of existing journey snapshots.
ALTER TABLE be_organizations ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE be_resources ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE be_missions ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE be_missions ADD COLUMN client_id uuid;
ALTER TABLE be_templates ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE TABLE be_clients (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  code text NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 80), name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  contact_name text CHECK (length(contact_name) <= 160), contact_email text CHECK (length(contact_email) <= 320),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000), active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,id), UNIQUE (organization_id,code)
);
CREATE TABLE be_homes (
  organization_id uuid NOT NULL REFERENCES be_organizations(id), id uuid NOT NULL,
  code text NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 80), name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000), active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,id), UNIQUE (organization_id,code)
);

-- The migration owner temporarily bypasses FORCE RLS only while backfilling all organizations.
-- ALTER's transaction locks prevent runtime requests from observing this intermediate state.
ALTER TABLE be_organizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE be_memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE be_resources NO FORCE ROW LEVEL SECURITY;
ALTER TABLE be_missions NO FORCE ROW LEVEL SECURITY;
INSERT INTO be_clients(organization_id,id,code,name)
  SELECT organization_id,gen_random_uuid(),'client-' || md5(client_name),client_name
  FROM be_missions GROUP BY organization_id,client_name;
UPDATE be_missions m SET client_id=c.id FROM be_clients c WHERE c.organization_id=m.organization_id AND c.name=m.client_name;
INSERT INTO be_homes(organization_id,id,code,name)
  SELECT organization_id,gen_random_uuid(),home,home FROM (
    SELECT organization_id,home FROM be_resources
    UNION SELECT organization_id,home_scope AS home FROM be_memberships WHERE home_scope IS NOT NULL
  ) source;
ALTER TABLE be_organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE be_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE be_resources FORCE ROW LEVEL SECURITY;
ALTER TABLE be_missions FORCE ROW LEVEL SECURITY;
ALTER TABLE be_missions ADD CONSTRAINT be_missions_client_fk FOREIGN KEY (organization_id,client_id) REFERENCES be_clients(organization_id,id);
ALTER TABLE be_resources ADD CONSTRAINT be_resources_home_fk FOREIGN KEY (organization_id,home) REFERENCES be_homes(organization_id,code);
ALTER TABLE be_memberships ADD CONSTRAINT be_memberships_home_fk FOREIGN KEY (organization_id,home_scope) REFERENCES be_homes(organization_id,code);
CREATE INDEX be_missions_client_idx ON be_missions(organization_id,client_id);

CREATE FUNCTION be_keep_configuration_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Configuration identifiers are immutable' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER be_clients_identity BEFORE UPDATE ON be_clients FOR EACH ROW EXECUTE FUNCTION be_keep_configuration_identity();
CREATE TRIGGER be_homes_identity BEFORE UPDATE ON be_homes FOR EACH ROW EXECUTE FUNCTION be_keep_configuration_identity();
CREATE FUNCTION be_keep_membership_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.issuer IS DISTINCT FROM OLD.issuer OR NEW.subject IS DISTINCT FROM OLD.subject THEN
    RAISE EXCEPTION 'Corporate identity identifiers are immutable' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER be_memberships_identity BEFORE UPDATE ON be_memberships FOR EACH ROW EXECUTE FUNCTION be_keep_membership_identity();
CREATE TRIGGER be_clients_updated BEFORE UPDATE ON be_clients FOR EACH ROW EXECUTE FUNCTION be_touch_updated_at();
CREATE TRIGGER be_homes_updated BEFORE UPDATE ON be_homes FOR EACH ROW EXECUTE FUNCTION be_touch_updated_at();
ALTER TABLE be_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE be_clients FORCE ROW LEVEL SECURITY;
ALTER TABLE be_homes ENABLE ROW LEVEL SECURITY;
ALTER TABLE be_homes FORCE ROW LEVEL SECURITY;
CREATE POLICY be_org_scope ON be_clients
  USING (organization_id=nullif(current_setting('bookends.organization_id',true),'')::uuid)
  WITH CHECK (organization_id=nullif(current_setting('bookends.organization_id',true),'')::uuid);
CREATE POLICY be_org_scope ON be_homes
  USING (organization_id=nullif(current_setting('bookends.organization_id',true),'')::uuid)
  WITH CHECK (organization_id=nullif(current_setting('bookends.organization_id',true),'')::uuid);
REVOKE ALL ON be_clients,be_homes FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON be_clients,be_homes TO be_runtime;
REVOKE DELETE,TRUNCATE ON be_clients,be_homes FROM be_runtime;
REVOKE ALL ON FUNCTION be_keep_configuration_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION be_keep_configuration_identity() TO be_runtime;
REVOKE ALL ON FUNCTION be_keep_membership_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION be_keep_membership_identity() TO be_runtime;

-- Helper functions are private to the migration owner. Only the three bounded commands below are callable.
CREATE FUNCTION be_is_global_administrator(p_role text,p_grants jsonb,p_home_scope text,p_organization_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  -- Additional grants authorize journey verification only, never workspace administration.
  SELECT p_role='administrator' AND p_home_scope IS NULL;
$$;
CREATE FUNCTION be_admin_authorize() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE organization uuid; actor uuid; actor_row public.be_memberships;
BEGIN
  organization := nullif(current_setting('bookends.organization_id',true),'')::uuid;
  actor := nullif(current_setting('bookends.actor_id',true),'')::uuid;
  IF organization IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'An active organization administrator is required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bookends:administration:' || organization::text,0));
  SELECT * INTO actor_row FROM public.be_memberships
    WHERE organization_id=organization AND id=actor AND active
      AND issuer=nullif(current_setting('bookends.issuer',true),'') AND subject=nullif(current_setting('bookends.subject',true),'') FOR UPDATE;
  IF NOT FOUND OR NOT public.be_is_global_administrator(actor_row.role,actor_row.grants,actor_row.home_scope,organization) THEN
    RAISE EXCEPTION 'An active organization administrator is required' USING ERRCODE='42501';
  END IF;
  RETURN organization;
END;
$$;
CREATE FUNCTION be_validate_membership_access(p_organization_id uuid,p_role text,p_grants jsonb,p_resource_id uuid,p_home_scope text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE grant_row jsonb; scope_row jsonb; key_name text; value_text text; allowed_roles text[] := ARRAY['resource','placement_owner','home_leader','mission_owner','client_liaison','asset_access_owner','administrator'];
BEGIN
  IF p_role IS NULL OR NOT(p_role=ANY(allowed_roles)) OR p_grants IS NULL OR jsonb_typeof(p_grants)<>'array' THEN
    RAISE EXCEPTION 'Invalid membership roles' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_grants)>50 OR (p_role='resource' AND p_resource_id IS NULL) OR (p_role='home_leader' AND p_home_scope IS NULL) THEN
    RAISE EXCEPTION 'Explicit role scopes are required' USING ERRCODE='22023';
  END IF;
  IF p_resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.be_resources WHERE organization_id=p_organization_id AND id=p_resource_id) THEN RAISE EXCEPTION 'Resource scope is outside this organization' USING ERRCODE='23503'; END IF;
  IF p_home_scope IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.be_homes WHERE organization_id=p_organization_id AND code=p_home_scope) THEN RAISE EXCEPTION 'HOME scope is outside this organization' USING ERRCODE='23503'; END IF;
  FOR grant_row IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
    IF jsonb_typeof(grant_row)<>'object' THEN RAISE EXCEPTION 'Invalid role grant' USING ERRCODE='22023'; END IF;
    IF NOT(grant_row ?& ARRAY['role','scope']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(grant_row) k WHERE k NOT IN('role','scope')) OR jsonb_typeof(grant_row->'role')<>'string' OR NOT((grant_row->>'role')=ANY(allowed_roles)) OR jsonb_typeof(grant_row->'scope')<>'object' THEN RAISE EXCEPTION 'Invalid role grant' USING ERRCODE='22023'; END IF;
    scope_row := grant_row->'scope';
    IF scope_row->>'organizationId' IS DISTINCT FROM p_organization_id::text OR EXISTS(SELECT 1 FROM jsonb_object_keys(scope_row) k WHERE k NOT IN('organizationId','homeId','clientId','missionId','assignmentId','resourceId')) THEN RAISE EXCEPTION 'Grant scope must belong to this organization' USING ERRCODE='22023'; END IF;
    FOR key_name,value_text IN SELECT key,value #>> '{}' FROM jsonb_each(scope_row) LOOP
      IF jsonb_typeof(scope_row->key_name)<>'string' OR value_text IS NULL OR length(value_text)=0 OR length(value_text)>80 THEN RAISE EXCEPTION 'Invalid grant scope' USING ERRCODE='22023'; END IF;
      IF key_name<>'homeId' AND value_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'Grant identifiers must be UUIDs' USING ERRCODE='22023'; END IF;
    END LOOP;
    IF grant_row->>'role'='resource' AND (p_resource_id IS NULL OR scope_row->>'resourceId' IS DISTINCT FROM p_resource_id::text) THEN RAISE EXCEPTION 'Resource grants require the linked teammate' USING ERRCODE='22023'; END IF;
    IF grant_row->>'role'='home_leader' AND NOT(scope_row ? 'homeId') THEN RAISE EXCEPTION 'HOME leaders require a HOME scope' USING ERRCODE='22023'; END IF;
    IF scope_row ? 'homeId' AND NOT EXISTS(SELECT 1 FROM public.be_homes WHERE organization_id=p_organization_id AND code=scope_row->>'homeId') THEN RAISE EXCEPTION 'HOME scope is outside this organization' USING ERRCODE='23503'; END IF;
    IF scope_row ? 'resourceId' AND NOT EXISTS(SELECT 1 FROM public.be_resources WHERE organization_id=p_organization_id AND id=(scope_row->>'resourceId')::uuid) THEN RAISE EXCEPTION 'Resource scope is outside this organization' USING ERRCODE='23503'; END IF;
    IF scope_row ? 'clientId' AND NOT EXISTS(SELECT 1 FROM public.be_clients WHERE organization_id=p_organization_id AND id=(scope_row->>'clientId')::uuid) THEN RAISE EXCEPTION 'Client scope is outside this organization' USING ERRCODE='23503'; END IF;
    IF scope_row ? 'missionId' AND NOT EXISTS(SELECT 1 FROM public.be_missions WHERE organization_id=p_organization_id AND id=(scope_row->>'missionId')::uuid) THEN RAISE EXCEPTION 'Mission scope is outside this organization' USING ERRCODE='23503'; END IF;
    IF scope_row ? 'assignmentId' AND NOT EXISTS(SELECT 1 FROM public.be_assignment_references WHERE organization_id=p_organization_id AND id=(scope_row->>'assignmentId')::uuid) THEN RAISE EXCEPTION 'Assignment scope is outside this organization' USING ERRCODE='23503'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION be_admin_update_organization(p_expected_revision integer,p_name text) RETURNS be_organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE organization uuid; result public.be_organizations;
BEGIN
  organization := public.be_admin_authorize();
  IF p_expected_revision IS NULL OR p_expected_revision<1 OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 200 OR p_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid organization settings' USING ERRCODE='22023'; END IF;
  UPDATE public.be_organizations SET name=trim(p_name),revision=revision+1 WHERE id=organization AND revision=p_expected_revision RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization settings changed; reload before saving' USING ERRCODE='40001'; END IF;
  RETURN result;
END;
$$;
CREATE FUNCTION be_admin_create_membership(p_issuer text,p_subject text,p_name text,p_role text,p_grants jsonb,p_resource_id uuid DEFAULT NULL,p_home_scope text DEFAULT NULL) RETURNS be_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE organization uuid; result public.be_memberships;
BEGIN
  organization := public.be_admin_authorize();
  IF p_issuer IS DISTINCT FROM nullif(current_setting('bookends.issuer',true),'') OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 255 OR p_subject ~ '[[:cntrl:]]' OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 160 OR p_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'A verified corporate issuer, subject, and name are required' USING ERRCODE='22023'; END IF;
  PERFORM public.be_validate_membership_access(organization,p_role,p_grants,p_resource_id,p_home_scope);
  INSERT INTO public.be_memberships(id,organization_id,issuer,subject,name,role,grants,resource_id,home_scope)
    VALUES(gen_random_uuid(),organization,p_issuer,p_subject,trim(p_name),p_role,p_grants,p_resource_id,p_home_scope) RETURNING * INTO result;
  RETURN result;
END;
$$;
CREATE FUNCTION be_admin_update_membership(p_member_id uuid,p_expected_revision integer,p_name text,p_role text,p_grants jsonb,p_resource_id uuid,p_home_scope text,p_active boolean) RETURNS be_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE organization uuid; current_row public.be_memberships; result public.be_memberships;
BEGIN
  organization := public.be_admin_authorize();
  IF p_member_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 OR p_active IS NULL OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 160 OR p_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid teammate settings' USING ERRCODE='22023'; END IF;
  SELECT * INTO current_row FROM public.be_memberships WHERE organization_id=organization AND id=p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Teammate is outside this organization' USING ERRCODE='23503'; END IF;
  IF current_row.revision<>p_expected_revision THEN RAISE EXCEPTION 'Teammate settings changed; reload before saving' USING ERRCODE='40001'; END IF;
  IF current_row.id=nullif(current_setting('bookends.actor_id',true),'')::uuid AND (p_role IS DISTINCT FROM current_row.role OR p_grants IS DISTINCT FROM current_row.grants OR p_resource_id IS DISTINCT FROM current_row.resource_id OR p_home_scope IS DISTINCT FROM current_row.home_scope OR p_active IS DISTINCT FROM current_row.active) THEN
    RAISE EXCEPTION 'Another administrator must change your own access' USING ERRCODE='42501';
  END IF;
  PERFORM public.be_validate_membership_access(organization,p_role,p_grants,p_resource_id,p_home_scope);
  IF current_row.active AND public.be_is_global_administrator(current_row.role,current_row.grants,current_row.home_scope,organization)
      AND NOT(p_active AND public.be_is_global_administrator(p_role,p_grants,p_home_scope,organization))
      AND NOT EXISTS(SELECT 1 FROM public.be_memberships m WHERE m.organization_id=organization AND m.id<>p_member_id AND m.active AND public.be_is_global_administrator(m.role,m.grants,m.home_scope,organization)) THEN
    RAISE EXCEPTION 'Keep an active organization administrator' USING ERRCODE='42501';
  END IF;
  UPDATE public.be_memberships SET name=trim(p_name),role=p_role,grants=p_grants,resource_id=p_resource_id,home_scope=p_home_scope,active=p_active,revision=revision+1
    WHERE organization_id=organization AND id=p_member_id AND revision=p_expected_revision RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Teammate settings changed; reload before saving' USING ERRCODE='40001'; END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION be_is_global_administrator(text,jsonb,text,uuid),be_admin_authorize(),be_validate_membership_access(uuid,text,jsonb,uuid,text) FROM PUBLIC,be_runtime;
REVOKE ALL ON FUNCTION be_admin_update_organization(integer,text),be_admin_create_membership(text,text,text,text,jsonb,uuid,text),be_admin_update_membership(uuid,integer,text,text,jsonb,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION be_admin_update_organization(integer,text),be_admin_create_membership(text,text,text,text,jsonb,uuid,text),be_admin_update_membership(uuid,integer,text,text,jsonb,uuid,text,boolean) TO be_runtime;
