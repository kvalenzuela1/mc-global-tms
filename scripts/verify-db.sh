#!/usr/bin/env bash
# =============================================================================
# verify-db.sh — Live RLS + audit verification WITHOUT npm (uses psql only).
#
# Verifies FR-TEN (tenant isolation), FR-MASK (commercial hiding at storage
# layer), and FR-AUD (append-only + auto-audit) against a real Postgres, running
# queries as the NON-SUPERUSER role `app_user` so RLS is actually enforced.
#
# Prereqal: a local Postgres with the app schema + seed loaded and an `app_user`
# login role granted SELECT/INSERT on the schema. See README "Local verification".
#
# Env: PGHOST (default 127.0.0.1), DB (default mc_global_tms_test)
# =============================================================================
set -uo pipefail
export PGHOST="${PGHOST:-127.0.0.1}"
DB="${DB:-mc_global_tms_test}"
FAILED=0

ADM=aaaaaaaa-aaaa-aaaa-aaaa-000000000001
DIS=aaaaaaaa-aaaa-aaaa-aaaa-000000000003
CAR=aaaaaaaa-aaaa-aaaa-aaaa-000000000004
DRV=aaaaaaaa-aaaa-aaaa-aaaa-000000000005
RIV=aaaaaaaa-aaaa-aaaa-aaaa-000000000007
MCG=11111111-1111-1111-1111-111111111111
RVORG=99999999-9999-9999-9999-999999999999
LD=88888888-0000-0000-0000-000000000001
RVLD=dddddddd-0000-0000-0000-0000000000ff
AUD=eeeeeeee-0000-0000-0000-0000000000aa

# ground-truth rows (idempotent)
psql -q -U postgres -d "$DB" >/dev/null 2>&1 <<SQL
insert into loads (id,org_id,service_type,reference,origin,destination,status)
 values ('$RVLD','$RVORG','trucking','RV-1','Dallas','Reno','draft') on conflict do nothing;
insert into loads (id,org_id,service_type,reference,origin,destination,status)
 values ('$AUD','$MCG','trucking','AUD-1','X','Y','dispatched') on conflict do nothing;
SQL

q() { psql -tA -q -U app_user -d "$DB" -c "select set_config('request.jwt.claim.sub','$1',false)" -c "$2" 2>&1 | tail -1; }
P() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3 (got '$1' want '$2')"; FAILED=1; fi; }

echo "FR-TEN / FR-MASK — tenant isolation + commercial hiding"
P "$(q $DIS "select count(*) from loads where id='$LD'")" "1" "FR-TEN-01 dispatcher sees own load"
P "$(q $DIS "select count(*) from loads where id='$RVLD'")" "0" "FR-TEN-01 dispatcher blind to rival load"
P "$(q $RIV "select count(*) from loads where id='$LD'")" "0" "FR-TEN-01 rival blind to MCG load"
P "$(q $RIV "select count(*) from memberships where org_id='$MCG'")" "0" "FR-TEN-02 rival blind to MCG memberships"
P "$(q $CAR "select count(*) from loads")" "1" "FR-TEN-04 carrier sees only assigned load"
P "$(q $CAR "select count(*) from quotes")" "0" "FR-MASK-01 carrier blind to quotes"
P "$(q $DRV "select count(*) from loads")" "1" "FR-TEN-04 driver sees only own load"
P "$(q $DRV "select count(*) from quotes")" "0" "FR-MASK-01 driver blind to quotes"

echo "FR-TEN — write guard (WITH CHECK)"
ERR=$(q $DIS "insert into loads (org_id,service_type,reference,origin,destination,status) values ('$RVORG','trucking','HACK','A','B','draft')")
case "$ERR" in *row-level*|*violates*) echo "  PASS  FR-TEN-01 cross-org write blocked";; *) echo "  FAIL  write guard (got '$ERR')"; FAILED=1;; esac

echo "FR-AUD — auto-audit + append-only"
psql -q -U app_user -d "$DB" -c "select set_config('request.jwt.claim.sub','$DIS',false)" -c "update loads set status='in_transit' where id='$AUD'" >/dev/null 2>&1
ROW=$(psql -tA -U postgres -d "$DB" -c "select action||'|'||actor_user_id||'|'||(before_state->>'status')||'|'||(after_state->>'status') from audit_log where entity_id='$AUD' order by id desc limit 1")
P "$ROW" "load.transition|$DIS|dispatched|in_transit" "FR-AUD-01 transition auto-audited"
P "$(q $DRV "select count(*) from audit_log")" "0" "FR-AUD-03 driver blind to audit trail"
UERR=$(psql -U postgres -d "$DB" -c "update audit_log set action='x' where entity_id='$AUD'" 2>&1 | grep -o AUDIT_APPEND_ONLY | head -1)
P "$UERR" "AUDIT_APPEND_ONLY" "FR-AUD-02 audit UPDATE blocked"
DERR=$(psql -U postgres -d "$DB" -c "delete from audit_log where entity_id='$AUD'" 2>&1 | grep -o AUDIT_APPEND_ONLY | head -1)
P "$DERR" "AUDIT_APPEND_ONLY" "FR-AUD-02 audit DELETE blocked"

echo
if [ "$FAILED" = "0" ]; then echo "ALL DB CHECKS PASSED"; else echo "SOME DB CHECKS FAILED"; exit 1; fi
