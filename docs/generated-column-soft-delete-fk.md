# Generated Columns for Foreign Key Integrity on Soft-Delete Tables

## The Problem

With soft deletes (`deleted_at` timestamp), standard foreign keys don't prevent:

1. **Orphaned active children** — A parent is soft-deleted while active children still reference it.
2. **References to deleted parents** — A new child row is inserted referencing a soft-deleted parent.

Application-level checks are error-prone and race-condition-susceptible. We want the **database itself** to enforce: *"An active row can only reference another active row."*

## The Solution: Generated (Computed) Columns

The trick is to create a **generated column** that is:
- Equal to the row's `id` when the row is **active** (`deleted_at IS NULL`)
- `NULL` when the row is **soft-deleted** (`deleted_at IS NOT NULL`)

Then, foreign keys reference this generated column instead of the raw `id`. Since SQL foreign keys **ignore NULL values** (a NULL FK value is always considered valid), soft-deleted children don't trigger FK violations, while active children pointing to a soft-deleted parent **do**.

## How It Works (Conceptual)

```
┌─────────────────────────────────────────────────┐
│ Parent Table                                     │
│ ┌────┬────────────┬───────────┐                  │
│ │ id │ deleted_at │ active_id │  (generated)     │
│ ├────┼────────────┼───────────┤                  │
│ │  1 │ NULL       │ 1         │  ← active        │
│ │  2 │ 2024-01-15 │ NULL      │  ← soft-deleted  │
│ └────┴────────────┴───────────┘                  │
│         UNIQUE(active_id)                        │
└─────────────────────────────────────────────────┘
          ▲
          │ FK: child.active_parent_id → parent.active_id
          │
┌─────────────────────────────────────────────────────────┐
│ Child Table                                              │
│ ┌────┬───────────┬────────────┬──────────────────┐       │
│ │ id │ parent_id │ deleted_at │ active_parent_id │ (gen) │
│ ├────┼───────────┼────────────┼──────────────────┤       │
│ │ 10 │ 1         │ NULL       │ 1                │ ✅ OK  │
│ │ 11 │ 2         │ 2024-01-16 │ NULL             │ ✅ OK  │
│ │ 12 │ 2         │ NULL       │ 2                │ ❌ FK! │
│ └────┴───────────┴────────────┴──────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

- **Row 10**: Active child → active parent (id=1). `active_parent_id=1` matches `active_id=1`. ✅
- **Row 11**: Soft-deleted child → soft-deleted parent. `active_parent_id=NULL`, FK is not checked. ✅
- **Row 12**: Active child → soft-deleted parent (id=2). `active_parent_id=2` but parent's `active_id=NULL`. ❌ **FK violation!**

---

## PostgreSQL Implementation

PostgreSQL 12+ supports `GENERATED ALWAYS AS ... STORED` columns.

```sql
-- ============================================================
-- STEP 1: Parent table with generated column
-- ============================================================
CREATE TABLE organizations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    deleted_at  TIMESTAMPTZ DEFAULT NULL,

    -- Generated column: non-NULL only when row is active
    active_id   BIGINT GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN id END
    ) STORED
);

-- UNIQUE constraint on the generated column (NULLs are ignored by UNIQUE)
-- This means multiple soft-deleted rows can coexist without conflict.
CREATE UNIQUE INDEX idx_organizations_active_id ON organizations (active_id);

-- ============================================================
-- STEP 2: Child table with generated FK column
-- ============================================================
CREATE TABLE users (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email           TEXT NOT NULL,
    organization_id BIGINT NOT NULL,
    deleted_at      TIMESTAMPTZ DEFAULT NULL,

    -- Generated column: mirrors organization_id only when THIS row is active
    active_organization_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN organization_id END
    ) STORED,

    -- FK references the parent's generated column, NOT the raw id
    CONSTRAINT fk_users_active_org
        FOREIGN KEY (active_organization_id)
        REFERENCES organizations (active_id)
);

-- ============================================================
-- STEP 3: Test it
-- ============================================================

-- Insert an active org and user
INSERT INTO organizations (name) VALUES ('Acme Corp');           -- id=1
INSERT INTO users (email, organization_id) VALUES ('alice@acme.com', 1); -- OK ✅

-- Try to soft-delete the org while user is still active
UPDATE organizations SET deleted_at = NOW() WHERE id = 1;
-- ERROR: update or delete on table "organizations" violates foreign key
--        constraint "fk_users_active_org" on table "users" ❌

-- Soft-delete the user first, THEN the org
UPDATE users SET deleted_at = NOW() WHERE organization_id = 1;  -- OK ✅
UPDATE organizations SET deleted_at = NOW() WHERE id = 1;        -- OK ✅

-- Try to insert a new active user referencing the deleted org
INSERT INTO users (email, organization_id) VALUES ('bob@acme.com', 1);
-- ERROR: insert or update on table "users" violates foreign key
--        constraint "fk_users_active_org" ❌

-- Restore (un-delete) the org, then add the user
UPDATE organizations SET deleted_at = NULL WHERE id = 1;         -- OK ✅
INSERT INTO users (email, organization_id) VALUES ('bob@acme.com', 1); -- OK ✅
```

---

## MySQL 5.7+ / 8.0+ Implementation

MySQL 5.7 supports generated columns but with restrictions on foreign keys. MySQL 8.0.13+ fully supports FK on stored generated columns.

```sql
-- ============================================================
-- Parent table
-- ============================================================
CREATE TABLE organizations (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    deleted_at  DATETIME DEFAULT NULL,

    -- Stored generated column
    active_id   BIGINT AS (
        CASE WHEN deleted_at IS NULL THEN id ELSE NULL END
    ) STORED,

    UNIQUE KEY idx_active_id (active_id)
) ENGINE=InnoDB;

-- ============================================================
-- Child table
-- ============================================================
CREATE TABLE users (
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
    email                   VARCHAR(255) NOT NULL,
    organization_id         BIGINT NOT NULL,
    deleted_at              DATETIME DEFAULT NULL,

    active_organization_id  BIGINT AS (
        CASE WHEN deleted_at IS NULL THEN organization_id ELSE NULL END
    ) STORED,

    CONSTRAINT fk_users_active_org
        FOREIGN KEY (active_organization_id)
        REFERENCES organizations (active_id)
) ENGINE=InnoDB;
```

---

## SQLite Implementation (3.31+)

SQLite supports stored generated columns since 3.31.0, but **does not support FK on generated columns**. You'll need to use triggers instead:

```sql
-- Enable foreign keys (off by default in SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    deleted_at  TEXT DEFAULT NULL,
    active_id   INTEGER GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN id END
    ) STORED
);

CREATE UNIQUE INDEX idx_organizations_active_id ON organizations (active_id);

CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL,
    organization_id INTEGER NOT NULL,
    deleted_at      TEXT DEFAULT NULL,
    active_organization_id INTEGER GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN organization_id END
    ) STORED
);

-- Since SQLite can't do FK on generated columns, use triggers:

-- Trigger: prevent INSERT of active user referencing deleted/missing org
CREATE TRIGGER trg_users_insert_check
BEFORE INSERT ON users
WHEN NEW.deleted_at IS NULL
BEGIN
    SELECT RAISE(ABORT, 'FK violation: referenced organization is deleted or missing')
    WHERE NOT EXISTS (
        SELECT 1 FROM organizations WHERE active_id = NEW.organization_id
    );
END;

-- Trigger: prevent soft-deleting an org that has active users
CREATE TRIGGER trg_organizations_softdelete_check
BEFORE UPDATE OF deleted_at ON organizations
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN
    SELECT RAISE(ABORT, 'FK violation: organization has active users')
    WHERE EXISTS (
        SELECT 1 FROM users
        WHERE organization_id = OLD.id AND deleted_at IS NULL
    );
END;
```

---

## Migration Example (Knex.js / TypeScript)

For Node.js projects using Knex:

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add generated column to existing parent table
  await knex.schema.alterTable('organizations', (table) => {
    // Raw SQL needed for generated columns (Knex doesn't support them natively)
  });

  await knex.raw(`
    ALTER TABLE organizations
    ADD COLUMN active_id BIGINT GENERATED ALWAYS AS (
      CASE WHEN deleted_at IS NULL THEN id END
    ) STORED;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_organizations_active_id
    ON organizations (active_id);
  `);

  // Add generated FK column to child table
  await knex.raw(`
    ALTER TABLE users
    ADD COLUMN active_organization_id BIGINT GENERATED ALWAYS AS (
      CASE WHEN deleted_at IS NULL THEN organization_id END
    ) STORED;
  `);

  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT fk_users_active_org
    FOREIGN KEY (active_organization_id)
    REFERENCES organizations (active_id);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT fk_users_active_org`);
  await knex.raw(`ALTER TABLE users DROP COLUMN active_organization_id`);
  await knex.raw(`DROP INDEX idx_organizations_active_id`);
  await knex.raw(`ALTER TABLE organizations DROP COLUMN active_id`);
}
```

---

## Migration Example (Prisma)

Prisma doesn't natively support generated columns, so use a raw migration:

```sql
-- prisma/migrations/XXXXXX_add_soft_delete_fk/migration.sql

-- Parent: organizations
ALTER TABLE "organizations"
ADD COLUMN "active_id" BIGINT GENERATED ALWAYS AS (
    CASE WHEN "deleted_at" IS NULL THEN "id" END
) STORED;

CREATE UNIQUE INDEX "idx_organizations_active_id" ON "organizations" ("active_id");

-- Child: users
ALTER TABLE "users"
ADD COLUMN "active_organization_id" BIGINT GENERATED ALWAYS AS (
    CASE WHEN "deleted_at" IS NULL THEN "organization_id" END
) STORED;

ALTER TABLE "users"
ADD CONSTRAINT "fk_users_active_org"
FOREIGN KEY ("active_organization_id")
REFERENCES "organizations" ("active_id");
```

---

## Advanced: Multi-Column Foreign Keys

If your FK is composite (e.g., `tenant_id` + `parent_id`), generate both columns:

```sql
CREATE TABLE parent_table (
    tenant_id   BIGINT NOT NULL,
    id          BIGINT NOT NULL,
    deleted_at  TIMESTAMPTZ,

    active_tenant_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN tenant_id END
    ) STORED,
    active_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN id END
    ) STORED,

    PRIMARY KEY (tenant_id, id),
    UNIQUE (active_tenant_id, active_id)
);

CREATE TABLE child_table (
    tenant_id   BIGINT NOT NULL,
    id          BIGINT NOT NULL,
    parent_id   BIGINT NOT NULL,
    deleted_at  TIMESTAMPTZ,

    active_tenant_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN tenant_id END
    ) STORED,
    active_parent_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN parent_id END
    ) STORED,

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (active_tenant_id, active_parent_id)
        REFERENCES parent_table (active_tenant_id, active_id)
);
```

---

## Advanced: Cascade Soft Deletes

You can combine this with `ON DELETE SET NULL` or `ON UPDATE` actions, but since we're
using generated columns (which can't be directly SET), the cascade behavior works
differently. When the parent's `active_id` flips to `NULL`:

- **PostgreSQL**: The FK check happens on the child's `active_parent_id`. Since it
  still holds the old value, the UPDATE is rejected — which is what we want (you must
  explicitly soft-delete children first).
- If you want **automatic cascade soft-deletes**, use a trigger:

```sql
-- Automatically soft-delete children when parent is soft-deleted
CREATE OR REPLACE FUNCTION cascade_soft_delete_users()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE users
        SET deleted_at = NEW.deleted_at
        WHERE organization_id = OLD.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_soft_delete_users
BEFORE UPDATE OF deleted_at ON organizations
FOR EACH ROW
EXECUTE FUNCTION cascade_soft_delete_users();
```

Note: The trigger fires **BEFORE** the update, so the children are soft-deleted first,
their `active_organization_id` becomes `NULL`, and then the parent's `active_id` can
safely become `NULL`.

---

## Performance Considerations

| Aspect | Impact | Notes |
|--------|--------|-------|
| Storage | +8 bytes per BIGINT generated column | Minimal overhead |
| Write performance | Slight overhead on INSERT/UPDATE | Generated column recalculated |
| Read performance | No impact | Can be indexed normally |
| Index size | UNIQUE index excludes NULLs | Efficient — only active rows indexed |
| Existing queries | No changes needed | Generated columns are transparent |

---

## Key Benefits

1. **Database-enforced integrity** — No race conditions, no application bugs can create orphans.
2. **Transparent** — Existing queries using `id` and `organization_id` work unchanged.
3. **NULL-safe** — Soft-deleted rows' FKs become NULL, so they're ignored by FK checks.
4. **UNIQUE-safe** — Multiple soft-deleted rows with `active_id = NULL` don't violate uniqueness.
5. **Zero application changes** — Only the schema changes; your app still reads/writes `id` and `organization_id`.

## Key Gotchas

1. **Order of operations matters** — Soft-delete children before parents (or use cascade triggers).
2. **Un-delete (restore)** — Restoring a child will fail if the parent is still deleted. Restore parent first.
3. **Generated columns can't be written to** — They're computed automatically; `INSERT`/`UPDATE` must not include them.
4. **ORM support varies** — Most ORMs (Prisma, TypeORM, Sequelize) need raw SQL migrations for generated columns. Mark the columns as `@ignore` or equivalent in your schema.
5. **PostgreSQL stored generated columns can't reference other tables** — The expression can only reference the current row's columns.
