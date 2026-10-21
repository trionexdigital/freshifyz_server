#!/usr/bin/env python3
"""Run as root on the VPS. Read {"app_password": "..."} from stdin only.

Uses PostgreSQL peer authentication; never accepts admin credentials or executes
SQL against existing application tables. No passwords are printed or rotated.
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys

PORT = "55432"
ADMIN = "trionex_digital"
OWNER = "freshifyz_owner"
APP = "freshifyz_app"
DB = "freshifyz"
BACKUP_ROOT = Path("/root/freshifyz-postgres-backups")


def sql(statement, database="postgres"):
    result = subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-X", "-qAt", "-p", PORT,
         "-d", database, "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, timeout=30,
    )
    if result.returncode:
        # PostgreSQL errors can contain SQL text. Keep them out of output.
        raise RuntimeError("PostgreSQL operation failed; inspect the protected VPS logs")
    return result.stdout.strip()


def scram_keys(password, salt, iterations):
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("ascii"), salt, iterations)
    stored = hashlib.sha256(hmac.new(salted, b"Client Key", "sha256").digest()).digest()
    server = hmac.new(salted, b"Server Key", "sha256").digest()
    return stored, server


def scram_verifier(password):
    salt = secrets.token_bytes(16)
    stored, server = scram_keys(password, salt, 16384)
    enc = lambda value: base64.b64encode(value).decode("ascii")
    return "SCRAM-SHA-256$16384:" + enc(salt) + "$" + enc(stored) + ":" + enc(server)


def password_matches(password, verifier):
    try:
        method, parameters, keys = verifier.split("$")
        iterations, salt = parameters.split(":")
        stored, server = scram_keys(password, base64.b64decode(salt), int(iterations))
        expected_stored, expected_server = [base64.b64decode(value) for value in keys.split(":")]
        return method == "SCRAM-SHA-256" and hmac.compare_digest(stored, expected_stored) and hmac.compare_digest(server, expected_server)
    except (ValueError, TypeError):
        return False


def snapshot():
    return {
        "roles": json.loads(sql("""SELECT COALESCE(json_object_agg(rolname,
          json_build_object('superuser',rolsuper,'create_db',rolcreatedb,
          'create_role',rolcreaterole,'login',rolcanlogin,'replication',rolreplication,
          'bypass_rls',rolbypassrls,'inherit',rolinherit)), '{}'::json) FROM pg_roles
          WHERE rolname IN ('freshifyz_owner','freshifyz_app','trionex_digital');""")),
        "databases": json.loads(sql("""SELECT COALESCE(json_object_agg(datname,
          json_build_object('owner',pg_get_userbyid(datdba),'acl',datacl::text)), '{}'::json)
          FROM pg_database WHERE datname IN ('freshifyz','cook_and_eat');""")),
    }


def main():
    if os.geteuid() != 0 or socket.gethostname().split(".")[0] != "srv1521171":
        raise RuntimeError("Expected root on srv1521171")
    password = json.load(sys.stdin).get("app_password", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{48,256}", password):
        raise RuntimeError("Supply a generated base64url application password of at least 48 characters")
    if sql("SHOW listen_addresses;") != "127.0.0.1" or sql("SHOW password_encryption;") != "scram-sha-256":
        raise RuntimeError("Unexpected listener or authentication configuration; refusing to change cluster settings")
    before = snapshot()
    if ADMIN not in before["roles"] or "cook_and_eat" not in before["databases"]:
        raise RuntimeError("Expected existing administrator and database are missing")
    for role, login in ((OWNER, False), (APP, True)):
        existing = before["roles"].get(role)
        expected = dict(superuser=False, create_db=False, create_role=False,
                        login=login, replication=False, bypass_rls=False, inherit=True)
        if existing is not None and existing != expected:
            raise RuntimeError("Conflicting Freshifyz role attributes; refusing to modify")
        if existing is not None and sql("SELECT count(*) FROM pg_auth_members WHERE member = '" + role + "'::regrole;") != "0":
            raise RuntimeError("Unexpected Freshifyz role membership")
    existing_db = before["databases"].get(DB)
    if existing_db and existing_db["owner"] != OWNER:
        raise RuntimeError("Conflicting freshifyz database ownership")
    if APP in before["roles"]:
        verifier = sql("SELECT rolpassword FROM pg_authid WHERE rolname = 'freshifyz_app';")
        if not password_matches(password, verifier):
            raise RuntimeError("Existing runtime password differs; passwords are never reset automatically")
        if sql("SELECT count(*) FROM pg_database WHERE datdba = 'freshifyz_app'::regrole;") != "0":
            raise RuntimeError("Runtime role must not own any database")
    hba = Path(sql("SHOW hba_file;"))
    if hba != Path("/etc/postgresql/16/main/pg_hba.conf") or hba.is_symlink():
        raise RuntimeError("Unexpected access configuration path")
    original_hba = hba.read_text()
    begin = "# BEGIN freshifyz managed access"
    end = "# END freshifyz managed access"
    block = begin + "\nhost    freshifyz    freshifyz_app,trionex_digital    127.0.0.1/32    scram-sha-256\n" + end + "\n"
    if begin in original_hba:
        if original_hba.count(begin) != 1 or original_hba.count(end) != 1 or block not in original_hba:
            raise RuntimeError("Unexpected Freshifyz access block; refusing to overwrite")
        proposed_hba = original_hba
    else:
        # Prepend only the database- and role-specific rule. Existing bytes remain intact.
        proposed_hba = block + original_hba
    BACKUP_ROOT.mkdir(mode=0o700, exist_ok=True)
    os.chmod(BACKUP_ROOT, 0o700)
    backup = BACKUP_ROOT / (datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(3))
    backup.mkdir(mode=0o700)
    shutil.copy2(hba, backup / "pg_hba.conf")
    os.chmod(backup / "pg_hba.conf", 0o600)
    state_file = backup / "before.json"
    state_file.write_text(json.dumps(before, indent=2))
    os.chmod(state_file, 0o600)

    # The supplied plaintext password stays in process memory/stdin. Only a
    # SCRAM verifier is sent to PostgreSQL for initial role creation.
    statements = ["BEGIN;"]
    if OWNER not in before["roles"]:
        statements.append("CREATE ROLE freshifyz_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;")
    if APP not in before["roles"]:
        statements.append("CREATE ROLE freshifyz_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10 PASSWORD '" + scram_verifier(password) + "';")
    # PostgreSQL 16 initializes membership inheritance from the member's
    # NOINHERIT attribute. Enable it only on this new ownership membership.
    statements += ["GRANT freshifyz_owner TO trionex_digital WITH INHERIT TRUE;",
                   "GRANT freshifyz_owner TO trionex_digital WITH SET TRUE;", "COMMIT;"]
    sql("\n".join(statements))
    if not existing_db:
        sql("CREATE DATABASE freshifyz OWNER freshifyz_owner TEMPLATE template0 ENCODING 'UTF8';")
    existing_schema = sql("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'app';", DB)
    if existing_schema and existing_schema != OWNER:
        raise RuntimeError("Conflicting application schema ownership")
    unexpected_owners = sql("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='app' AND c.relowner <> 'freshifyz_owner'::regrole;""", DB)
    if unexpected_owners != "0":
        raise RuntimeError("Application objects must be owned by freshifyz_owner")
    sql("""BEGIN;
      REVOKE ALL ON DATABASE freshifyz FROM PUBLIC;
      GRANT CONNECT ON DATABASE freshifyz TO freshifyz_app;
      SET ROLE freshifyz_owner;
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION freshifyz_owner;
      GRANT USAGE ON SCHEMA app TO freshifyz_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO freshifyz_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO freshifyz_app;
      RESET ROLE;
      ALTER ROLE freshifyz_app IN DATABASE freshifyz SET search_path = app;
      ALTER ROLE freshifyz_app IN DATABASE freshifyz SET statement_timeout = '5s';
      ALTER ROLE freshifyz_app IN DATABASE freshifyz SET lock_timeout = '2s';
      ALTER ROLE freshifyz_app IN DATABASE freshifyz SET idle_in_transaction_session_timeout = '10s';
      COMMIT;""", DB)

    if proposed_hba != original_hba:
        metadata = hba.stat()
        temporary = hba.with_name("pg_hba.conf.freshifyz.tmp")
        if temporary.exists():
            raise RuntimeError("Unexpected temporary configuration file")
        try:
            with temporary.open("x") as stream:
                stream.write(proposed_hba)
                stream.flush()
                os.fsync(stream.fileno())
            os.chown(temporary, metadata.st_uid, metadata.st_gid)
            os.chmod(temporary, metadata.st_mode & 0o777)
            os.replace(temporary, hba)
            if sql("SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;") != "0":
                raise RuntimeError("Access configuration validation failed")
            if sql("SELECT pg_reload_conf();") != "t":
                raise RuntimeError("Access configuration reload failed")
        except Exception:
            # Restore the previous access file if validation/reload fails.
            hba.write_text(original_hba)
            os.chown(hba, metadata.st_uid, metadata.st_gid)
            os.chmod(hba, metadata.st_mode & 0o777)
            sql("SELECT pg_reload_conf();")
            raise
        finally:
            temporary.unlink(missing_ok=True)

    if sql("SELECT has_database_privilege('trionex_digital','freshifyz','CONNECT') AND has_database_privilege('trionex_digital','freshifyz','CREATE');") != "t":
        raise RuntimeError("Administrator ownership access verification failed")
    after = snapshot()
    if before["databases"]["cook_and_eat"] != after["databases"]["cook_and_eat"]:
        raise RuntimeError("Existing database metadata changed unexpectedly")
    if before["roles"][ADMIN] != after["roles"][ADMIN]:
        raise RuntimeError("Existing administrator attributes changed unexpectedly")
    if hba.read_text().replace(block, "", 1) != original_hba.replace(block, "", 1):
        raise RuntimeError("Existing access rules changed unexpectedly")
    print(json.dumps({"success": True, "database": DB, "runtime_role": APP,
                      "created_database": not bool(existing_db),
                      "access_rules_added": proposed_hba != original_hba,
                      "backup": str(backup), "existing_database_preserved": True}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Error strings above never contain credentials or SQL payloads.
        print("Freshifyz provisioning failed: " + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
