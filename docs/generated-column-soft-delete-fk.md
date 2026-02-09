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

---

## Pros and Cons Analysis

### Pros (Why This Pattern Is Powerful)

1. **True database-level integrity** — The biggest win. No amount of application bugs,
   race conditions, direct SQL scripts, or future developer mistakes can create orphaned
   active records. The database itself is the last line of defense, and this pattern makes
   it work with soft deletes the same way it works with hard deletes.

2. **Zero changes to application read/write logic** — Your app still inserts and queries
   using the original `id` and `organization_id` columns. The generated columns are
   invisible to normal operations. You don't need to rewrite queries, change ORM models
   (beyond ignoring the generated columns), or alter API contracts.

3. **NULL semantics work perfectly here** — SQL was designed so that NULL foreign key
   values are "not checked." This is the exact behavior we want: soft-deleted rows
   (where the generated column is NULL) should be invisible to FK enforcement. We're
   not fighting the database — we're working *with* its existing semantics.

4. **UNIQUE index only covers active rows** — In PostgreSQL, `CREATE UNIQUE INDEX` on a
   nullable column ignores NULLs. This means the index is smaller (only active rows) and
   there's no conflict when multiple rows are soft-deleted. This is a free partial index.

5. **Minimal storage overhead** — A stored generated BIGINT column adds 8 bytes per row.
   For a million-row table, that's ~8 MB. Negligible.

6. **Restore/un-delete is naturally safe** — Setting `deleted_at = NULL` on a child row
   automatically re-populates `active_parent_id`, and the FK check fires immediately.
   If the parent is still deleted, the restore fails. You can't accidentally un-delete
   a child into an inconsistent state.

7. **Works with existing soft-delete libraries** — Libraries like Paranoid (Sequelize),
   acts_as_paranoid (Rails), or SoftDeletes (Laravel) don't need modification. They
   only touch `deleted_at`, and the generated columns react automatically.

8. **Composable** — Works with composite keys, multi-level hierarchies, and can be
   added incrementally to existing tables via ALTER TABLE.

### Cons (The Real Costs)

1. **Schema complexity / "WTF factor"** — Every soft-deletable table with FK
   relationships needs 1-2 extra columns. A new developer looking at the schema sees
   `active_id`, `active_organization_id`, etc. and has to understand *why* they exist.
   This is non-obvious and requires documentation. In a schema with 50 tables and
   dozens of FK relationships, the generated columns add real visual noise.

2. **ORM support is poor** — No major ORM (Prisma, TypeORM, Sequelize, Django ORM,
   ActiveRecord, SQLAlchemy) has first-class support for generated columns. You'll need:
   - Raw SQL migrations (can't use the ORM's migration builder)
   - `@ignore` / `readonly` annotations so the ORM doesn't try to INSERT/UPDATE them
   - Schema introspection tools may get confused
   - This is the single biggest practical obstacle for most teams.

3. **Ordering constraint on soft-delete operations** — You **must** soft-delete children
   before parents. This is the same constraint as hard deletes (without ON DELETE CASCADE),
   but developers used to soft deletes often expect to delete in any order because "it's
   just setting a timestamp." This pattern enforces discipline that may feel surprising.
   You can mitigate this with cascade triggers, but that adds more complexity.

4. **Ordering constraint on restore operations** — You must restore parents before
   children. Same logic, reversed. If a user clicks "undo" on a deleted child, and
   the parent is still deleted, it fails. Your UI/API needs to handle this gracefully.

5. **No native `ON DELETE CASCADE` equivalent** — With hard-delete FKs, you get
   `ON DELETE CASCADE` for free. With generated-column FKs, cascading soft-deletes
   requires custom triggers (shown in the "Cascade Soft Deletes" section above).
   These triggers need to be maintained and tested.

6. **Cannot use `ON DELETE SET NULL` or `ON UPDATE CASCADE`** — Generated columns
   can't be written to by FK cascade actions. The database will reject attempts to
   define cascade actions on FKs that target generated columns. You're limited to
   `NO ACTION` / `RESTRICT` behavior (which is arguably what you want, but it
   removes flexibility).

7. **PostgreSQL doesn't support virtual (non-stored) generated columns** — The
   generated column must be `STORED`, meaning it physically occupies disk space
   and is recomputed on every INSERT/UPDATE to the row. In practice the overhead
   is tiny, but it's not free.

8. **MySQL version dependency** — FK on stored generated columns requires MySQL 8.0.13+.
   Older versions silently ignore or reject it. SQLite doesn't support FK on generated
   columns at all (requires triggers as a workaround).

9. **Migration on large existing tables can be expensive** — Adding a stored generated
   column to a table with hundreds of millions of rows requires a full table rewrite
   in PostgreSQL (no online DDL for generated columns). In MySQL, `ALTER TABLE` with
   `ALGORITHM=INPLACE` may work but still takes a lock. Plan for downtime or use
   tools like `pg_repack` / `pt-online-schema-change`.

10. **Partial index alternative may be simpler in some cases** — If you only need to
    prevent *inserting* children that reference deleted parents (not prevent deleting
    parents with active children), a partial unique index + CHECK constraint may
    suffice without generated columns. See alternatives below.

---

## Is It Good Practice?

**Short answer: Yes, it's a legitimate and well-regarded pattern — but it's not always
the *right* choice.** Here's a decision framework:

### Use generated-column FKs when:

- **Data integrity is critical** and you can't tolerate application-level bugs causing
  orphans (financial systems, healthcare, multi-tenant platforms).
- **Multiple services or scripts** write to the database, and you can't trust all of
  them to enforce soft-delete consistency.
- **Your team is comfortable with raw SQL migrations** and doesn't rely entirely on
  ORM-generated schemas.
- **The table has moderate FK relationships** (not dozens of FKs per table).

### Consider alternatives when:

- **You're prototyping** or in early development — the schema complexity isn't worth it yet.
- **Your ORM is the only writer** and you have strong application-level validation with
  good test coverage.
- **You have very few FK relationships** — a simple application-level check may suffice.
- **You're using a database that doesn't support it well** (SQLite, older MySQL).
- **You might move away from soft deletes** — if you're considering event sourcing,
  audit tables, or temporal tables, the generated-column approach locks you deeper
  into the soft-delete pattern.

### Industry perspective

This pattern is used in production by teams at companies like GitLab (which has
discussed it for their PostgreSQL-backed Rails app) and is recommended in database
design literature when soft deletes are a firm requirement. It's not "clever hackery"
— it's a principled use of SQL semantics. However, it's not universally adopted because:
- Most applications never enforce FK integrity on soft deletes at all (they just accept the risk)
- The ORM ecosystem hasn't caught up
- Many teams prefer application-level enforcement for flexibility

---

## Alternatives Comparison

| Approach | DB-enforced? | Complexity | ORM support | Handles restore? | Cascade? |
|----------|-------------|------------|-------------|-----------------|----------|
| **Generated column FK** (this guide) | Yes | Medium | Poor (raw SQL) | Yes (naturally) | Via triggers |
| **Application-level checks** | No | Low | Native | Manual | Manual |
| **CHECK constraint + partial index** | Partial | Low | Poor | No | No |
| **Row-level security (RLS)** | Sort of | High | Poor | No | No |
| **Triggers only (no generated cols)** | Yes | High | Poor | Yes | Yes |
| **Separate archive/history table** | N/A (data moves) | Medium | Varies | Manual move-back | N/A |
| **Temporal tables (SQL:2011)** | Yes | High | Poor | Built-in | Built-in |

### Brief notes on each alternative:

**Application-level checks**: Easiest to implement. Use middleware, model hooks, or
service-layer validation. Vulnerable to race conditions and bypasses (direct SQL,
migrations, other services). Fine for low-risk data.

**CHECK + partial index**: You can create a partial unique index like
`CREATE UNIQUE INDEX ON users (organization_id) WHERE deleted_at IS NULL` but this only
enforces uniqueness, not referential integrity to the parent. You'd still need triggers
or application code to verify the parent is active.

**Triggers only**: You can achieve the same result with BEFORE INSERT/UPDATE/DELETE
triggers without generated columns. This is more flexible but harder to maintain,
harder to reason about, and triggers can have performance implications on bulk operations.

**Separate archive table**: Instead of soft-deleting in place, move deleted rows to a
`organizations_archive` table. The original table retains normal FK constraints. This is
clean but doubles your table count and complicates queries that need to include deleted data.

**Temporal tables**: SQL:2011 temporal tables (supported in MariaDB, SQL Server; partially
in PostgreSQL via extensions) provide system-versioned rows with automatic history. This
is the "proper" solution but has limited database support and high complexity.

---

## Performance Considerations

| Aspect | Impact | Notes |
|--------|--------|-------|
| Storage | +8 bytes per BIGINT generated column | Minimal overhead |
| Write performance | Slight overhead on INSERT/UPDATE | Generated column recalculated |
| Read performance | No impact | Can be indexed normally |
| Index size | UNIQUE index excludes NULLs | Efficient — only active rows indexed |
| Existing queries | No changes needed | Generated columns are transparent |
| FK check on soft-delete | Adds a lookup | Same as any FK check on UPDATE |

---

## Summary

The generated-column pattern for soft-delete FK enforcement is a **sound, principled
technique** that leverages standard SQL semantics (NULL FK values, UNIQUE index NULL
handling, stored generated columns) to solve a real problem. Its main costs are schema
complexity and poor ORM tooling.

**If data integrity matters and you're comfortable with raw SQL migrations, use it.**
If you're in a fast-moving early-stage codebase with a single ORM writer and good test
coverage, application-level checks may be more pragmatic for now — but consider
adopting this pattern as the system matures.
