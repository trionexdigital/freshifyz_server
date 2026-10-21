# Freshifyz server

Express 4 / TypeScript / PostgreSQL starter for Node.js 24. Default HTTP address: `127.0.0.1:4000`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/health | Process liveness; independent of PostgreSQL |
| GET | /api/health/ready | PostgreSQL readiness; 200 or sanitized 503 |

These are the only application endpoints. Express also handles HEAD for GET routes and CORS OPTIONS preflight. JWT and role/permission utilities are available for future protected APIs. No login, registration, refresh, user-management, business APIs, or auth tables are included.

## Windows development

1. Install Node.js 24 and use `npm ci --ignore-scripts`.
2. Use the generated private `.env`. For a fresh checkout, copy `.env.example` and generate independent secrets:

```powershell
node -e "const c=require('node:crypto');console.log('PGPASSWORD='+c.randomBytes(48).toString('base64url'));console.log('JWT_SECRET='+c.randomBytes(64).toString('hex'))"
```

Save secrets only in your private `.env`. PGPASSWORD must match the initial provisioning password. Existing passwords are never reset automatically.

3. In a separate terminal, keep the PostgreSQL SSH tunnel open:

```powershell
.\scripts\ssh-tunnel.ps1
```

Equivalent command using your existing verified SSH key:

```powershell
ssh -i "$env:USERPROFILE\.ssh\cook_and_eat_pg_setup" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -N -L 127.0.0.1:65432:127.0.0.1:55432 root@72.61.240.123
```

The host key must already be verified in Windows OpenSSH known_hosts. Forwarding binds only to loopback. A verification tunnel may already be running after initial setup; reuse it or close it before opening another on the same port. Never open PostgreSQL's firewall port.

4. Verify and run:

```powershell
npm run db:check
npm run db:verify
npm run test:smoke
npm run dev
```

Check `http://127.0.0.1:4000/api/health` and `http://127.0.0.1:4000/api/health/ready`.

## Database and provisioning

VPS: `72.61.240.123`; hostname: `srv1521171`; PostgreSQL 16/main: `127.0.0.1:55432`.

- Database `freshifyz`, application schema `app`.
- Non-login owner `freshifyz_owner`. Your existing `trionex_digital` login has owner-role membership with inheritance and SET ROLE enabled for this membership only; its global NOINHERIT setting is preserved.
- Restricted SCRAM login `freshifyz_app`: CONNECT, schema USAGE, maximum 10 connections, and no owner membership or administrative privileges. It cannot create schemas, tables, or temporary tables.
- Future owner-created tables grant SELECT/INSERT/UPDATE/DELETE to the app; sequences grant USAGE/SELECT.
- Existing `cook_and_eat` ownership, ACLs, credentials, objects, and access rules remain intact. The runtime cannot connect to it.

Provision from Windows after configuring the generated PGPASSWORD:

```powershell
.\scripts\provision-postgres.ps1
```

The wrapper streams the private password over SSH stdin. The Python script uses local PostgreSQL peer authentication as administrator and sends only a SCRAM verifier during initial role creation. It verifies hostname, listener, role attributes, membership, ownership, and existing credentials. Conflicting state causes an error instead of replacement.

Provisioning saves root-only backups under `/root/freshifyz-postgres-backups`, creates missing Freshifyz objects, configures privileges, and adds one database/role-specific loopback SCRAM rule. It validates and reloads the access configuration without restarting PostgreSQL. Existing access rules remain byte-for-byte intact. Repeated runs do not recreate databases or reset passwords.

If setup stops midway, keep the same .env and inspect the conflict before rerunning. Recovery deliberately does not drop created objects. An administrator can restore the saved pg_hba.conf with postgres ownership and original permissions, validate pg_hba_file_rules, and call pg_reload_conf(). Never drop a database that has acquired data. Application startup does not provision or migrate databases.

## Configuration and security

See `.env.example` for all settings. Host environment variables take precedence over .env.

- Windows tunnel: PGHOST=127.0.0.1, PGPORT=65432. Same-VPS execution: PGPORT=55432.
- PGDATABASE=freshifyz and PGUSER=freshifyz_app are enforced.
- Standard PostgreSQL keys are canonical. PG_HOST, PG_PORT, PG_DATABASE, PG_USER, and PG_PASSWORD remain compatibility aliases; conflicting values fail startup. NODE_EXPRESS_PORT aliases PORT.
- PGSSLMODE=disable requires a literal loopback IP, protected by SSH forwarding or same-host transport. Other hosts require verify-full, PGSSLROOTCERT, and a matching certificate. PGSSL_SERVER_NAME can specify its DNS identity when forwarding.
- Pool defaults: maximum 5; connection and statement timeouts 5 seconds; idle timeout 30 seconds; maximum lock wait 2 seconds; idle transaction timeout 10 seconds.
- CORS_ORIGINS defaults empty. Set comma-separated exact trusted HTTP(S) origins without trailing slashes. Wildcards and cross-origin credential cookies are disabled.
- Body limit defaults to 16 KiB. Rate limit defaults to 120 requests per minute per IP, including health checks. Adjust for monitoring traffic. Limits use process-local memory; coordinate them before adding replicas.
- TRUST_PROXY_HOPS defaults to 0. Set only for a known fixed proxy chain and prevent direct bypass of that proxy.
- Middleware includes Helmet, CORS, bounded JSON parsing, rate limiting, generated request IDs, and final error handling. Logs omit bodies, headers, URLs/query strings, tokens, credentials, and raw errors.
- Configuration and PostgreSQL are checked before listening. Startup failures exit nonzero with sanitized diagnostics.

JWTs use HS256, an independent random secret, issuer freshifyz, audience freshifyz-api, and a default 900-second lifetime. Verification validates subject, roles, permissions, issued-at, expiry, signature algorithm, and maximum age. Tokens are never renewed automatically or logged.

Future route pattern (not currently registered):

```typescript
const tokens = new TokenService(config.jwt);
router.get('/profile',
  authenticate(tokens),
  requireRoles('admin', 'operator'),   // any listed role
  requirePermissions('profile:read'), // every listed permission
  handler,
);
```

Use typed req.auth after authentication. Invalid/missing tokens return 401; insufficient permissions return 403. Each protected route must explicitly attach guards. The internal signer must be called only after a future login service validates credentials. This starter has no user registry, refresh flow, or revocation store.

Use Database.query(sql, values) with PostgreSQL $1 parameters. Database.transaction commits/rolls back and always releases its connection. Never interpolate user input into SQL.

Future migrations must connect as an authorized administrator to freshifyz, then execute `SET ROLE freshifyz_owner; SET search_path = app;` before creating objects, so ownership and default grants are correct. Runtime credentials cannot migrate.

## Production and Docker

```sh
npm ci --ignore-scripts
npm run build
npm prune --omit=dev --ignore-scripts
NODE_ENV=production PGPORT=55432 npm start
```

Use an owner-only private environment file and a separately configured HTTPS reverse proxy in front of the loopback HTTP listener.

Compose is for the **same Linux VPS as PostgreSQL**:

```sh
docker compose up --build -d
docker compose logs -f app
```

It uses host networking to reach private PostgreSQL, overrides PGPORT to 55432, and runs a non-root application with a read-only filesystem, dropped capabilities, and readiness checks. It publishes no PostgreSQL service. The image excludes environment files; provision runtime secrets through the VPS .env. Windows development runs natively with SSH forwarding; this Compose file does not configure Windows Docker networking.

SIGINT/SIGTERM close HTTP connections and the pool with a bounded deadline. Application deployment and changes to other VPS services are outside this setup.

## Checks

```sh
npm run typecheck
npm run build
npm test
npm run test:coverage
npm audit
npm run db:verify
```

Tests use mocked PostgreSQL and test-only auth routes. db:verify checks the real connection, runtime restrictions, parameterized queries, transactions, denial of schema creation, and denial of access to the existing database. Its creation probe runs inside a rolled-back transaction and leaves no persistent table.

test:smoke starts the actual compiled server on a temporary loopback port, checks both health endpoints against live PostgreSQL and verifies removed generic API paths return 404, then stops its child process. It requires the SSH tunnel on Windows.

Static API documentation: `docs/openapi.json`. No documentation UI route is exposed.

The test-tool dependency override uses js-yaml 4 for @istanbuljs/load-nyc-config, removing its obsolete vulnerable formatter dependency. Its load() API is compatible; tests and coverage verify the override.
