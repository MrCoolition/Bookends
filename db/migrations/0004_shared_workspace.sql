-- Interim passcode workspace. It never impersonates an OIDC member or writes to
-- protected normalized records. All access uses a separate transaction-local key.
CREATE TABLE be_shared_workspaces (
  workspace_id text PRIMARY KEY CHECK (workspace_id ~ '^[a-z0-9-]{1,80}$'),
  revision integer NOT NULL CHECK (revision > 0),
  body jsonb NOT NULL CHECK (jsonb_typeof(body)='object' AND body @> '{"version":1}'::jsonb AND octet_length(body::text) <= 5242880),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE be_shared_limits (
  workspace_id text NOT NULL CHECK (workspace_id ~ '^[a-z0-9-]{1,80}$'),
  bucket text NOT NULL CHECK (length(bucket) BETWEEN 1 AND 200),
  window_start bigint NOT NULL CHECK (window_start >= 0),
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (workspace_id,bucket)
);
CREATE TABLE be_shared_audit (
  workspace_id text NOT NULL REFERENCES be_shared_workspaces(workspace_id),
  revision integer NOT NULL CHECK (revision > 0),
  session_id text NOT NULL CHECK (session_id ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  request_id uuid,
  request_hash text CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,revision),
  UNIQUE (workspace_id,request_id),
  CHECK ((request_id IS NULL) = (request_hash IS NULL))
);
CREATE TRIGGER be_shared_audit_immutable BEFORE UPDATE OR DELETE ON be_shared_audit FOR EACH ROW EXECUTE FUNCTION be_reject_immutable_mutation();
ALTER TABLE be_shared_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE be_shared_workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE be_shared_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE be_shared_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE be_shared_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE be_shared_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY be_shared_scope ON be_shared_workspaces USING (workspace_id=nullif(current_setting('bookends.shared_workspace_id',true),'')) WITH CHECK (workspace_id=nullif(current_setting('bookends.shared_workspace_id',true),''));
CREATE POLICY be_shared_scope ON be_shared_limits USING (workspace_id=nullif(current_setting('bookends.shared_workspace_id',true),'')) WITH CHECK (workspace_id=nullif(current_setting('bookends.shared_workspace_id',true),''));
CREATE POLICY be_shared_scope ON be_shared_audit USING (workspace_id=nullif(current_setting('bookends.shared_workspace_id',true),'')) WITH CHECK (workspace_id=nullif(current_setting('bookends.shared_workspace_id',true),''));
REVOKE ALL ON be_shared_workspaces,be_shared_limits,be_shared_audit FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON be_shared_workspaces,be_shared_limits TO be_runtime;
GRANT SELECT,INSERT ON be_shared_audit TO be_runtime;
REVOKE DELETE,TRUNCATE ON be_shared_workspaces,be_shared_limits,be_shared_audit FROM be_runtime;
COMMENT ON TABLE be_shared_workspaces IS 'Validated versioned shared configuration; passcode sessions are distinct from company identity and accepted staffing.';
