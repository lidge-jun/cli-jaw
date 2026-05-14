#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  OfficeCLI Integration Smoke Tests for cli-jaw
#  Run from cli-jaw root: bash tests/smoke/test_officecli_integration.sh
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

PASS=0; FAIL=0; TOTAL=12
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKDIR="${SCRIPT_DIR}/.work/officecli"

if [ -n "${OFFICECLI_BIN:-}" ]; then
  OFFICECLI="${OFFICECLI_BIN}"
elif command -v officecli >/dev/null 2>&1; then
  OFFICECLI="officecli"
elif [ -x "${REPO_ROOT}/officecli/bin/release/officecli-mac-arm64" ]; then
  OFFICECLI="${REPO_ROOT}/officecli/bin/release/officecli-mac-arm64"
elif [ -x "${REPO_ROOT}/officecli/bin/release/officecli-mac-x64" ]; then
  OFFICECLI="${REPO_ROOT}/officecli/bin/release/officecli-mac-x64"
elif [ -x "${REPO_ROOT}/officecli/bin/release/officecli-linux-x64" ]; then
  OFFICECLI="${REPO_ROOT}/officecli/bin/release/officecli-linux-x64"
elif [ -x "${REPO_ROOT}/officecli/bin/release/officecli-linux-arm64" ]; then
  OFFICECLI="${REPO_ROOT}/officecli/bin/release/officecli-linux-arm64"
elif [ -x "${REPO_ROOT}/officecli/build-local/officecli" ]; then
  OFFICECLI="${REPO_ROOT}/officecli/build-local/officecli"
else
  OFFICECLI="officecli"
fi

mkdir -p "$WORKDIR"
rm -f "$WORKDIR"/smoke_test.docx "$WORKDIR"/smoke_test.xlsx "$WORKDIR"/smoke_test.pptx "$WORKDIR"/smoke_test.hwp "$WORKDIR"/smoke_mutated.hwp

pass() { ((PASS++)); echo "  ✅ PASS: $1"; }
fail_test() { ((FAIL++)); echo "  ❌ FAIL: $1 — $2"; }
contains_text() { [[ "$1" == *"$2"* ]]; }

echo "═══════════════════════════════════════════"
echo " OfficeCLI Integration Smoke Tests"
echo "═══════════════════════════════════════════"
echo ""

# ─── Test 1: Binary availability ───
echo "1/12  Binary availability"
if $OFFICECLI --version > /dev/null 2>&1; then
  VER=$($OFFICECLI --version 2>/dev/null)
  pass "officecli v${VER} found"
else
  fail_test "officecli binary not found" "Install: scripts/install-officecli.sh"
fi

# ─── Test 2: DOCX create + write + read ───
echo "2/12  DOCX create → write → read"
if $OFFICECLI create "$WORKDIR/smoke_test.docx" > /dev/null 2>&1 && \
   $OFFICECLI add "$WORKDIR/smoke_test.docx" /body --type paragraph --prop text="Hello from cli-jaw" > /dev/null 2>&1; then
  DOCX_TEXT="$($OFFICECLI view "$WORKDIR/smoke_test.docx" text 2>/dev/null)" || DOCX_TEXT=""
  if contains_text "$DOCX_TEXT" "Hello from cli-jaw"; then
    pass "DOCX create/write/read"
  else
    fail_test "DOCX create/write/read" "Write succeeded but text was not readable"
  fi
else
  fail_test "DOCX create/write/read" "Verify officecli docx commands"
fi

# ─── Test 3: XLSX create + write + read ───
echo "3/12  XLSX create → write → read"
if $OFFICECLI create "$WORKDIR/smoke_test.xlsx" > /dev/null 2>&1 && \
   $OFFICECLI set "$WORKDIR/smoke_test.xlsx" /Sheet1/A1 --prop value=TestData > /dev/null 2>&1; then
  XLSX_TEXT="$($OFFICECLI view "$WORKDIR/smoke_test.xlsx" text 2>/dev/null)" || XLSX_TEXT=""
  if contains_text "$XLSX_TEXT" "TestData"; then
    pass "XLSX create/write/read"
  else
    fail_test "XLSX create/write/read" "Write succeeded but cell value was not readable"
  fi
else
  fail_test "XLSX create/write/read" "Verify officecli xlsx commands"
fi

# ─── Test 4: PPTX create + write + read ───
echo "4/12  PPTX create → add slide → read"
if $OFFICECLI create "$WORKDIR/smoke_test.pptx" > /dev/null 2>&1 && \
   $OFFICECLI add "$WORKDIR/smoke_test.pptx" / --type slide --prop title="Smoke Test Slide" > /dev/null 2>&1; then
  PPTX_TEXT="$($OFFICECLI view "$WORKDIR/smoke_test.pptx" outline 2>/dev/null)" || PPTX_TEXT=""
  if contains_text "$PPTX_TEXT" "Smoke Test Slide"; then
    pass "PPTX create/add/read"
  else
    fail_test "PPTX create/add/read" "Slide was created but title was not readable"
  fi
else
  fail_test "PPTX create/add/read" "Verify officecli pptx commands"
fi

# ─── Test 5: Validation ───
echo "5/12  Validation"
VALID_OK=true
for f in smoke_test.docx smoke_test.xlsx smoke_test.pptx; do
  if ! $OFFICECLI validate "$WORKDIR/$f" > /dev/null 2>&1; then
    VALID_OK=false
    break
  fi
done
if $VALID_OK; then
  pass "All three formats pass validation"
else
  fail_test "Validation" "One or more formats failed validation"
fi

# ─── Test 6: CJK text roundtrip ───
echo "6/12  CJK text roundtrip"
if $OFFICECLI add "$WORKDIR/smoke_test.docx" /body --type paragraph --prop text="한글 테스트 日本語 中文" > /dev/null 2>&1; then
  DOCX_TEXT="$($OFFICECLI view "$WORKDIR/smoke_test.docx" text 2>/dev/null)" || DOCX_TEXT=""
  if contains_text "$DOCX_TEXT" "한글 테스트"; then
    pass "CJK text preserved in roundtrip"
  else
    fail_test "CJK text roundtrip" "Korean/CJK text lost during write→read"
  fi
else
  fail_test "CJK text roundtrip" "Failed to append CJK paragraph"
fi

# ─── Test 7: Batch operations ───
echo "7/12  Batch operations"
BATCH_JSON='[{"command":"set","path":"/Sheet1/A2","props":{"value":"BatchValue"}},{"command":"set","path":"/Sheet1/B1","props":{"value":"42"}}]'
if $OFFICECLI batch "$WORKDIR/smoke_test.xlsx" --json <<<"$BATCH_JSON" > /dev/null 2>&1; then
  XLSX_TEXT="$($OFFICECLI view "$WORKDIR/smoke_test.xlsx" text 2>/dev/null)" || XLSX_TEXT=""
  if contains_text "$XLSX_TEXT" "BatchValue"; then
    pass "Batch operations executed"
  else
    fail_test "Batch operations" "Batch command ran but expected cell value was not found"
  fi
else
  fail_test "Batch operations" "Batch JSON command failed"
fi

# ─── Test 8: JSON output ───
echo "8/12  JSON output"
DOC_JSON="$($OFFICECLI get "$WORKDIR/smoke_test.docx" / --json 2>/dev/null)" || DOC_JSON=""
if [ -n "$DOC_JSON" ] && python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('success') is True" <<<"$DOC_JSON" 2>/dev/null; then
  pass "JSON output is valid and successful"
else
  fail_test "JSON output" "get --json did not return valid JSON with success=true"
fi

# ─── Test 9: HWP doctor/capabilities parity ───
echo "9/12  HWP doctor/capabilities parity"
set +e
HWP_DOCTOR_JSON="$($OFFICECLI hwp doctor --json 2>/dev/null)"
HWP_DOCTOR_EXIT=$?
set +e
HWP_CAP_JSON="$($OFFICECLI capabilities --json 2>/dev/null)" || HWP_CAP_JSON=""
HWP_PARITY_JSON="$(python3 - "$HWP_DOCTOR_JSON" "$HWP_CAP_JSON" <<'PY'
import json
import sys

doctor = json.loads(sys.argv[1])
caps = json.loads(sys.argv[2])
doctor_data = doctor.get("data", {})
cap_data = caps.get("data", {})
hwp_ops = cap_data.get("formats", {}).get("hwp", {}).get("operations", {})
doctor_ops = doctor_data.get("operations", {})

result = {
    "doctor_ok": bool(doctor.get("success") is True),
    "caps_ok": bool(caps.get("success") is True),
    "doctor_create": doctor_ops.get("create_blank", {}).get("ready"),
    "caps_create": hwp_ops.get("create_blank", {}).get("ready"),
    "doctor_read": doctor_ops.get("read_text", {}).get("ready"),
    "caps_read": hwp_ops.get("read_text", {}).get("ready"),
    "doctor_mutate": doctor_ops.get("mutate_output", {}).get("ready"),
    "caps_mutate": hwp_ops.get("replace_text", {}).get("ready"),
}
result["parity"] = (
    result["doctor_ok"]
    and result["caps_ok"]
    and isinstance(result["doctor_create"], bool)
    and isinstance(result["caps_create"], bool)
    and result["doctor_create"] == result["caps_create"]
    and result["doctor_read"] == result["caps_read"]
    and result["doctor_mutate"] == result["caps_mutate"]
)
print(json.dumps(result))
PY
)" || HWP_PARITY_JSON=""
if [ -n "$HWP_PARITY_JSON" ] && python3 -c 'import json,sys; assert json.load(sys.stdin)["parity"] is True' <<<"$HWP_PARITY_JSON" 2>/dev/null; then
  pass "HWP doctor/capabilities operation readiness agree"
else
  fail_test "HWP doctor/capabilities parity" "doctor_exit=${HWP_DOCTOR_EXIT}; parity=${HWP_PARITY_JSON:-unparseable}"
fi

# ─── Test 10: HWP blank create contract ───
echo "10/12  HWP blank create contract"
HWP_CREATE_READY="$(python3 - "$HWP_PARITY_JSON" <<'PY'
import json
import sys
print(str(json.loads(sys.argv[1]).get("caps_create") is True).lower())
PY
)" || HWP_CREATE_READY="false"
if [ "$HWP_CREATE_READY" = "true" ]; then
  if $OFFICECLI create "$WORKDIR/smoke_test.hwp" --json > /dev/null 2>&1 && [ -s "$WORKDIR/smoke_test.hwp" ]; then
    pass "HWP blank create succeeded when capability says ready"
  else
    fail_test "HWP blank create contract" "capability ready=true but create failed"
  fi
else
  set +e
  HWP_CREATE_JSON="$($OFFICECLI create "$WORKDIR/smoke_test.hwp" --json 2>/dev/null)"
  HWP_CREATE_EXIT=$?
  set +e
  if [ "$HWP_CREATE_EXIT" -ne 0 ] && python3 - "$HWP_CREATE_JSON" <<'PY' 2>/dev/null
import json
import sys
root = json.loads(sys.argv[1])
code = root.get("error", {}).get("code")
assert code == "hwp_create_dependency_missing"
PY
  then
    pass "HWP blank create dependency guard is explicit"
  else
    fail_test "HWP blank create contract" "expected hwp_create_dependency_missing when create_blank is not ready"
  fi
fi

# ─── Test 11: HWP real fixture read when ready ───
echo "11/12  HWP fixture read when ready"
HWP_READ_READY="$(python3 - "$HWP_PARITY_JSON" <<'PY'
import json
import sys
print(str(json.loads(sys.argv[1]).get("caps_read") is True).lower())
PY
)" || HWP_READ_READY="false"
HWP_MUTATE_READY="$(python3 - "$HWP_PARITY_JSON" <<'PY'
import json
import sys
print(str(json.loads(sys.argv[1]).get("caps_mutate") is True).lower())
PY
)" || HWP_MUTATE_READY="false"
HWP_FIXTURE="${REPO_ROOT}/officecli/tests/fixtures/hwp/rhwp-fields/field-01.hwp"
if [ "$HWP_READ_READY" != "true" ]; then
  pass "HWP read skipped because capability is not ready"
elif [ ! -f "$HWP_FIXTURE" ]; then
  fail_test "HWP fixture read" "missing fixture: $HWP_FIXTURE"
else
  HWP_TEXT="$($OFFICECLI view "$HWP_FIXTURE" text --json 2>/dev/null)" || HWP_TEXT=""
  if ! contains_text "$HWP_TEXT" "마케팅"; then
    fail_test "HWP fixture read" "read_text ready=true but expected fixture token was not found"
  else
    pass "HWP fixture read"
  fi
fi

# ─── Test 12: HWP real fixture mutation when ready ───
echo "12/12  HWP fixture output-first mutation when ready"
if [ "$HWP_MUTATE_READY" != "true" ]; then
  pass "HWP mutation skipped because capability is not ready"
elif [ ! -f "$HWP_FIXTURE" ]; then
  fail_test "HWP output-first mutation" "missing fixture: $HWP_FIXTURE"
else
  BEFORE_HASH="$(shasum -a 256 "$HWP_FIXTURE" | awk '{print $1}')"
  if $OFFICECLI set "$HWP_FIXTURE" /text --prop find=마케팅 --prop value=오피스CLI --prop output="$WORKDIR/smoke_mutated.hwp" --json > /dev/null 2>&1 && [ -s "$WORKDIR/smoke_mutated.hwp" ]; then
    AFTER_HASH="$(shasum -a 256 "$HWP_FIXTURE" | awk '{print $1}')"
    MUTATED_TEXT="$($OFFICECLI view "$WORKDIR/smoke_mutated.hwp" text --json 2>/dev/null)" || MUTATED_TEXT=""
    if [ "$BEFORE_HASH" = "$AFTER_HASH" ] && contains_text "$MUTATED_TEXT" "오피스CLI"; then
      pass "HWP output-first mutation preserved source and read back"
    else
      fail_test "HWP output-first mutation" "source hash changed or mutated token missing"
    fi
  else
    fail_test "HWP output-first mutation" "mutation ready=true but command failed"
  fi
fi

# ─── Cleanup work files ───
rm -f "$WORKDIR"/smoke_test.{docx,xlsx,pptx,hwp} "$WORKDIR"/smoke_mutated.hwp

# ─── Summary ───
echo ""
echo "═══════════════════════════════════════════"
echo " Results: ${PASS}/${TOTAL} passed, ${FAIL}/${TOTAL} failed"
echo "═══════════════════════════════════════════"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
