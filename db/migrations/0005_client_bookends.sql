-- Client-specific calendar windows inform planning without changing assignments,
-- policy evidence, or journey readiness. NULL keeps legacy clients unchanged.
ALTER TABLE be_clients ADD COLUMN bookends jsonb;
ALTER TABLE be_clients ADD CONSTRAINT be_clients_bookends_shape CHECK (
  bookends IS NULL OR CASE WHEN jsonb_typeof(bookends) = 'array'
    THEN jsonb_array_length(bookends) <= 20 AND octet_length(bookends::text) <= 131072
    ELSE false END
);
COMMENT ON COLUMN be_clients.bookends IS
  'Optional client timing windows. Validated calendar schedules are planning constraints, not verified onboarding or staffing authorization.';
