# Epic 335 — Remaining BDD Failures (10/99)

Status: 89/99 passing (90%). These 10 need targeted fixes.

## Case Management (6 failures)

### 1. Create a new arrest case with title and description
- **Root cause:** Toast "Case created" not visible after submit
- **Details:** The `createRecord` API call may be failing due to encryption payload format. The test mock's `encryptMessage` might return a format the backend rejects.
- **Fix:** Verify the encrypted summary payload matches `CreateRecordBody` schema exactly. Check that the test mock's `encryptMessage` produces valid `readerEnvelopes`.

### 2. Empty state shows create prompt when entity types exist
- **Root cause:** Accumulated records from previous test runs prevent empty state
- **Details:** `test-reset` doesn't clear all CMS records. After many test runs, 1000+ records exist.
- **Fix:** Add CMS record cleanup to the `test-reset` endpoint, OR make the step delete existing records before checking empty state.

### 3. Status pill is read-only for volunteer without update permission
- **Root cause:** No actual volunteer login in test env — step uses admin as fallback
- **Details:** The step `loginAsVolunteer` isn't available; it falls back to `loginAsAdmin` who HAS update permission, so the pill is clickable.
- **Fix:** Create a proper volunteer fixture with restricted permissions, or mock the permission check.

### 4. Timeline tab loads interactions for a case
- **Root cause:** `createInteractionViaApi` creates interaction but the timeline tab click fails because the case detail panel isn't fully loaded yet.
- **Details:** Race condition between card click and detail panel render.
- **Fix:** Add explicit wait for `case-detail-header` visibility before clicking the timeline tab.

### 5. Contacts tab shows linked contacts with roles
- **Root cause:** `linkContactToRecordViaApi` succeeds but contact doesn't appear in the contacts tab due to timing or the contacts tab rendering before data loads.
- **Fix:** Add retry/wait for contact card visibility after clicking the contacts tab.

### 6. Evidence tab shows uploaded files with classification
- **Root cause:** `uploadEvidenceViaApi` creates evidence but the evidence tab doesn't render it — may need the evidence tab to reload after navigation.
- **Fix:** Verify evidence upload API returns correctly, add wait for evidence items to appear.

## Contact Directory (4 failures)

### 7. Empty state shows create prompt when no contacts exist
- **Root cause:** After test-reset, previously-created contacts may persist (same as case management #2).
- **Fix:** Ensure test-reset clears contact directory data.

### 8. Search with no results shows empty message
- **Root cause:** Search uses trigram tokens via `/directory/search` — the search endpoint may not return the expected format or the "no match" text isn't rendered.
- **Fix:** Check the search response format and ensure the "No contacts match your search" text renders for empty results.

### 9. Filter contacts by type / Relationships tab
- **Root cause:** `contactTypeHash` filter parameter may not be passed correctly to the listing API, OR the relationship creation API fails silently.
- **Fix:** Verify the filter query parameter is sent and the backend filters by contactTypeHash. For relationships, verify `createRelationshipViaApi` succeeds.

### 10. Restricted profile tab shows shield and restricted message
- **Root cause:** Test logs in as admin (who can decrypt everything) instead of a volunteer without PII access. The restricted UI never shows.
- **Fix:** Same as case management #3 — needs proper volunteer fixture.
