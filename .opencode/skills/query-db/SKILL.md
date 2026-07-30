# Skill: query-db

Run ad-hoc database queries against the Meirim MariaDB inside the `meirim-dev` Docker container.

## Database module

The DB connection is at `server/api/service/database.js` and exports:

```js
const { Knex, Bookshelf, isHealthy } = require('./server/api/service/database');
```

- `Knex` — raw knex instance for queries
- `Bookshelf` — bookshelf ORM instance (uses `knex` internally)
- `isHealthy` — async function returning boolean

## How to run a query

Always set `NODE_CONFIG_DIR` and at minimum the `SERVER_DATABASE_*` env vars. Source `scripts/run-db-env.sh` for convenience.

### One-liner

```bash
source scripts/run-db-env.sh && docker exec -e NODE_CONFIG_DIR=/app/server/config $(env | awk '/^(SERVER_DATABASE)/{printf " -e %s", $0}') -w /app meirim-dev node -e "
const { Knex } = require('./server/api/service/database');
Knex.raw('YOUR_SQL').then(r => { console.log(r[0]); process.exit(); }).catch(e => { console.error(e.message); process.exit(1); });
"
```

Replace `YOUR_SQL` with the raw SQL query.

### Using knex query builder

```bash
source scripts/run-db-env.sh && docker exec -e NODE_CONFIG_DIR=/app/server/config $(env | awk '/^(SERVER_DATABASE)/{printf " -e %s", $0}') -w /app meirim-dev node -e "
const { Knex } = require('./server/api/service/database');
Knex('plan').max('updated_at as latest').then(r => { console.log(r); process.exit(); }).catch(e => { console.error(e.message); process.exit(1); });
"
```

## Notes

- The `data` column on the `plan` table is JSON. Access fields with `JSON_EXTRACT(data, '$.KEY')` or `JSON_UNQUOTE(JSON_EXTRACT(data, '$.KEY'))` in raw SQL. In knex use `Knex.raw("JSON_EXTRACT(data, '$.KEY')")`.
- `KEYS` is a reserved word in MariaDB — alias it (e.g., `AS k`) if used as a column alias.
- `JSON_KEYS(data) AS k` lists top-level keys in the JSON column.
- Column info: `Knex('table_name').columnInfo()`.
- No need for `SERVER_CYPHER_SECRET` or other non-database env vars unless the code path requires them at import time.
