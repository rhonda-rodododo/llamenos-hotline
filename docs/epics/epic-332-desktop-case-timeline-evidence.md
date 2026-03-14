# Epic 332: Desktop: Case Timeline & Evidence Viewer

**Status**: PENDING
**Priority**: Medium
**Depends on**: Epic 323 (Case Interactions & Timeline), Epic 325 (Evidence & Chain of Custody)
**Blocks**: None
**Branch**: `desktop`

## Summary

Build the case timeline component and evidence viewer for the record detail page (Epic 330's Timeline and Evidence tabs). The timeline is a chronological feed of all interactions tied to a case: notes, calls, messages, status changes, file uploads, and inline comments. Each interaction has a type icon, author name, timestamp, and content preview. The evidence viewer displays attached files with thumbnails, metadata, chain-of-custody table, and an upload flow with drag-and-drop. This epic makes the case detail page fully functional by filling in the Timeline and Evidence tabs that Epic 330 defines as placeholders. ~10 files created, ~4 files modified.

## Problem Statement

Epic 330 creates the record detail page with tabbed sections, but the Timeline and Evidence tabs are placeholders. Without them:
- Volunteers cannot see the chronological history of a case (when was it created, who changed the status, what notes were taken, what calls were made)
- There is no way to view or upload evidence files from within a case
- The chain-of-custody audit trail for evidence is invisible

The timeline is the central narrative of a case -- it tells the story of what happened, when, and by whom. For legal cases, the evidence chain of custody is critical for court admissibility. Both must be built to make the case management system functional for real-world use.

## Implementation

### Phase 1: API Verification

No new API routes. This epic consumes APIs from:
- Epic 323: `GET /api/records/:id/interactions` (list interactions for a case), `POST /api/records/:id/interactions` (create inline comment)
- Epic 325: `GET /api/records/:id/evidence` (list evidence), `POST /api/records/:id/evidence` (upload evidence), `GET /api/evidence/:id` (single evidence), `GET /api/evidence/:id/custody` (chain of custody)
- Existing note and call APIs for linked interaction content

### Phase 2: Desktop UI

#### Task 1: Case Timeline Component

**File**: `src/client/components/cases/CaseTimeline.tsx` (new)

The primary timeline component, embedded in the record detail page's "Timeline" tab:

```typescript
interface CaseTimelineProps {
  recordId: string
  interactions: CaseInteraction[]
  onAddComment: (text: string) => void
  loading?: boolean
}

interface CaseInteraction {
  id: string
  type: 'note' | 'call' | 'message' | 'status_change' | 'file_upload' | 'comment' | 'assignment' | 'contact_link'
  sourceId?: string            // ID of the linked entity (noteId, callId, etc.)
  actorPubkey: string
  actorName?: string           // Decrypted from hub member profiles
  timestamp: string
  encryptedContent?: string    // Encrypted interaction details
  contentEnvelopes?: RecipientEnvelope[]
  metadata?: Record<string, unknown>  // Type-specific metadata (e.g., duration for calls)
}
```

Timeline layout (vertical, chronological, newest-first with option to reverse):
- Each entry is a row with:
  - **Left column**: type icon (color-coded)
  - **Center column**: actor name, content preview, metadata
  - **Right column**: timestamp (relative, with absolute on hover)
- Type-specific rendering:
  - `note`: notepad icon, note title + first line preview, "View note" link
  - `call`: phone icon, "Call from [last4]", duration, call status
  - `message`: message-circle icon, message preview (first 100 chars), channel badge (SMS/Signal/WhatsApp)
  - `status_change`: arrow-right icon, "Status changed from [old] to [new]" with color badges
  - `file_upload`: paperclip icon, file name, file size, file type icon
  - `comment`: message-square icon, inline comment text (full, not preview)
  - `assignment`: user-plus icon, "Assigned to [name]" or "Unassigned [name]"
  - `contact_link`: link icon, "Linked contact [name] as [role]"
- **Inline comment composer** at the bottom: text input + send button for quick comments

Icon mapping:
```typescript
const interactionIcons: Record<CaseInteraction['type'], LucideIcon> = {
  note: FileText,
  call: Phone,
  message: MessageCircle,
  status_change: ArrowRight,
  file_upload: Paperclip,
  comment: MessageSquare,
  assignment: UserPlus,
  contact_link: Link2,
}

const interactionColors: Record<CaseInteraction['type'], string> = {
  note: 'text-blue-500',
  call: 'text-green-500',
  message: 'text-purple-500',
  status_change: 'text-amber-500',
  file_upload: 'text-gray-500',
  comment: 'text-slate-500',
  assignment: 'text-teal-500',
  contact_link: 'text-indigo-500',
}
```

Key `data-testid` attributes:
- `case-timeline` -- timeline container
- `timeline-entry-{id}` -- each timeline entry
- `timeline-entry-icon-{id}` -- type icon
- `timeline-entry-actor-{id}` -- actor name
- `timeline-entry-content-{id}` -- content preview
- `timeline-entry-time-{id}` -- timestamp
- `timeline-entry-type-{type}` -- type-specific entries (for filtering)
- `timeline-comment-input` -- inline comment text input
- `timeline-comment-send` -- send comment button
- `timeline-empty` -- empty state ("No activity yet")
- `timeline-sort-toggle` -- newest-first / oldest-first toggle

#### Task 2: Timeline Entry Detail Components

**File**: `src/client/components/cases/timeline/NotePreview.tsx` (new)
**File**: `src/client/components/cases/timeline/CallSummary.tsx` (new)
**File**: `src/client/components/cases/timeline/StatusChangeBadge.tsx` (new)

Type-specific rendering components:

```typescript
// NotePreview - shows title + first line of decrypted note content
interface NotePreviewProps {
  noteId: string
  title: string
  preview: string
  onViewFull: () => void
}

// CallSummary - shows call metadata
interface CallSummaryProps {
  callId: string
  callerLast4: string
  duration?: number         // seconds
  status: 'answered' | 'missed' | 'voicemail'
  hasRecording: boolean
  hasTranscription: boolean
}

// StatusChangeBadge - shows old->new status transition
interface StatusChangeBadgeProps {
  oldStatus: string
  newStatus: string
  oldColor: string
  newColor: string
}
```

Key `data-testid` attributes:
- `note-preview-{noteId}` -- note preview
- `note-view-full-{noteId}` -- view full note link
- `call-summary-{callId}` -- call summary
- `call-duration-{callId}` -- call duration
- `status-change-old` -- old status badge
- `status-change-new` -- new status badge

#### Task 3: Evidence Tab Component

**File**: `src/client/components/cases/EvidenceTab.tsx` (new)

Evidence file list and viewer, embedded in the record detail page's "Evidence" tab:

```typescript
interface EvidenceTabProps {
  recordId: string
  evidence: EvidenceItem[]
  onUpload: (file: File) => void
  onView: (evidenceId: string) => void
  loading?: boolean
}

interface EvidenceItem {
  id: string
  recordId: string
  filename: string
  mimeType: string
  fileSize: number
  encryptedFileUrl: string
  integrityHash: string        // SHA-256 of encrypted file
  classification: 'general' | 'sensitive' | 'legal' | 'medical'
  uploadedAt: string
  uploadedBy: string
  uploadedByName?: string
  custodyEntryCount: number
}
```

Layout:
- **Header**: "Evidence" title, upload button, view toggle (grid/list)
- **Grid view**: thumbnail cards with file type icon, filename, upload date
- **List view**: table with filename, type, size, uploaded by, uploaded at, custody entries count
- **Upload area**: drag-and-drop zone (dashed border, "Drop files here or click to browse")
- **Empty state**: "No evidence attached to this case"

File type icons:
- Images (jpg, png, gif): image thumbnail preview
- PDFs: document icon with "PDF" label
- Videos: video icon
- Audio: headphones icon
- Other: file icon

Key `data-testid` attributes:
- `evidence-tab` -- tab container
- `evidence-upload-button` -- upload button
- `evidence-upload-zone` -- drag-and-drop area
- `evidence-view-toggle` -- grid/list toggle
- `evidence-item-{id}` -- each evidence item
- `evidence-item-name-{id}` -- filename
- `evidence-item-type-{id}` -- file type indicator
- `evidence-item-size-{id}` -- file size
- `evidence-item-custody-count-{id}` -- custody entry count
- `evidence-empty` -- empty state

#### Task 4: Evidence Detail Dialog

**File**: `src/client/components/cases/EvidenceDetailDialog.tsx` (new)

Dialog for viewing evidence details and chain of custody:

```typescript
interface EvidenceDetailDialogProps {
  evidence: EvidenceItem
  custodyChain: CustodyEntry[]
  open: boolean
  onClose: () => void
  onDownload: () => void
}

interface CustodyEntry {
  id: string
  evidenceId: string
  action: 'uploaded' | 'viewed' | 'downloaded' | 'shared' | 'exported'
  actorPubkey: string
  actorName?: string
  timestamp: string
  ipAddress?: string         // Hashed for privacy
  metadata?: Record<string, unknown>
}
```

Layout:
- **File preview section**: rendered preview for images and PDFs, file icon for other types
- **Metadata panel**: filename, file type, file size, integrity hash, classification badge, upload date, uploaded by
- **Chain of custody table**: chronological list of all access events
  - Columns: Action, Actor, Timestamp
  - Each row: action icon (eye for viewed, download for downloaded, share for shared), actor name, formatted timestamp
- **Actions**: Download button, Share button (creates a new custody entry)

Key `data-testid` attributes:
- `evidence-detail-dialog` -- dialog root
- `evidence-preview` -- file preview area
- `evidence-metadata` -- metadata panel
- `evidence-integrity-hash` -- integrity hash display
- `evidence-classification` -- classification badge
- `evidence-download-button` -- download action
- `custody-chain-table` -- custody chain table
- `custody-entry-{id}` -- each custody entry row
- `custody-action-{id}` -- action type
- `custody-actor-{id}` -- actor name
- `custody-time-{id}` -- timestamp

#### Task 5: Evidence Upload Flow

**File**: `src/client/components/cases/EvidenceUploadDialog.tsx` (new)

Dialog for uploading evidence to a case:

```typescript
interface EvidenceUploadDialogProps {
  recordId: string
  open: boolean
  onUploaded: (evidence: EvidenceItem) => void
  onCancel: () => void
}
```

Upload flow:
1. User selects file via file picker or drag-and-drop
2. Client reads file, computes SHA-256 integrity hash
3. Client encrypts file with random symmetric key
4. Client wraps key via ECIES for appropriate recipients
5. Client uploads encrypted file to `POST /api/records/:id/evidence`
6. Server stores file and creates initial custody entry (action: 'uploaded')
7. Dialog shows progress bar during upload, success confirmation when done

Fields during upload:
- Classification: dropdown (general, sensitive, legal, medical)
- Description: optional text
- File selection: drag-and-drop zone + file picker button

Key `data-testid` attributes:
- `evidence-upload-dialog` -- dialog root
- `evidence-upload-dropzone` -- drag-and-drop area
- `evidence-upload-file-picker` -- file picker button
- `evidence-upload-classification` -- classification dropdown
- `evidence-upload-description` -- description input
- `evidence-upload-progress` -- progress bar
- `evidence-upload-submit` -- upload button
- `evidence-upload-cancel` -- cancel button

#### Task 6: Integration with Record Detail Page

**File**: `src/client/components/cases/RecordDetailPage.tsx` (modify -- from Epic 330)

Replace the Timeline and Evidence tab placeholders with the real components:

```typescript
// In the tabbed content:
<TabsContent value="timeline" data-testid="record-tab-timeline-content">
  <CaseTimeline
    recordId={record.id}
    interactions={interactions}
    onAddComment={handleAddComment}
  />
</TabsContent>

<TabsContent value="evidence" data-testid="record-tab-evidence-content">
  <EvidenceTab
    recordId={record.id}
    evidence={evidenceItems}
    onUpload={handleUploadEvidence}
    onView={handleViewEvidence}
  />
</TabsContent>
```

#### Task 7: i18n Strings

**File**: `packages/i18n/locales/en.json` (modify)

```json
{
  "timeline": {
    "title": "Timeline",
    "noActivity": "No activity yet",
    "addComment": "Add a comment...",
    "sendComment": "Send",
    "newestFirst": "Newest first",
    "oldestFirst": "Oldest first",
    "note": "Note",
    "call": "Call",
    "message": "Message",
    "statusChange": "Status changed",
    "fileUpload": "File uploaded",
    "comment": "Comment",
    "assignment": "Assignment",
    "contactLink": "Contact linked",
    "viewFullNote": "View full note",
    "callDuration": "{{duration}} duration",
    "callMissed": "Missed call",
    "callAnswered": "Answered",
    "statusFrom": "from",
    "statusTo": "to",
    "assignedTo": "Assigned to {{name}}",
    "unassignedFrom": "Unassigned {{name}}",
    "linkedContact": "Linked {{name}} as {{role}}"
  },
  "evidence": {
    "title": "Evidence",
    "noEvidence": "No evidence attached to this case",
    "uploadEvidence": "Upload Evidence",
    "dragDropPrompt": "Drag files here or click to browse",
    "classification": "Classification",
    "classificationGeneral": "General",
    "classificationSensitive": "Sensitive",
    "classificationLegal": "Legal",
    "classificationMedical": "Medical",
    "description": "Description",
    "integrityHash": "Integrity Hash (SHA-256)",
    "fileSize": "File Size",
    "fileType": "File Type",
    "uploadedBy": "Uploaded by",
    "uploadedAt": "Uploaded at",
    "download": "Download",
    "chainOfCustody": "Chain of Custody",
    "custodyAction": "Action",
    "custodyActor": "Actor",
    "custodyTime": "Time",
    "custodyUploaded": "Uploaded",
    "custodyViewed": "Viewed",
    "custodyDownloaded": "Downloaded",
    "custodyShared": "Shared",
    "custodyExported": "Exported",
    "viewGrid": "Grid View",
    "viewList": "List View",
    "uploading": "Uploading...",
    "uploadComplete": "Upload complete",
    "uploadFailed": "Upload failed"
  }
}
```

#### Task 8: BDD Feature File

**File**: `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature` (new)

```gherkin
@desktop
Feature: Case Timeline & Evidence Viewer (Desktop)
  Users can view chronological case history and manage evidence files.

  Background:
    Given the user is logged in as an admin
    And case management is enabled
    And an arrest case "JS-2026-0001" exists

  @timeline
  Scenario: View timeline with mixed interaction types
    Given case "JS-2026-0001" has interactions:
      | type          | content                           |
      | note          | Initial intake note               |
      | call          | Call from 1234, 5 min             |
      | status_change | reported -> confirmed             |
      | comment       | Attorney assigned                 |
    When the user views the "Timeline" tab
    Then 4 timeline entries should be visible
    And the entries should be in chronological order
    And each entry should have a type icon and timestamp

  @timeline
  Scenario: Add inline comment to timeline
    Given the user is viewing the "Timeline" tab for "JS-2026-0001"
    When the user types "Follow up needed" in the comment input
    And clicks "Send"
    Then a new comment entry should appear in the timeline
    And the comment text should be "Follow up needed"

  @timeline
  Scenario: Note preview shows title and content snippet
    Given case "JS-2026-0001" has a note interaction with title "Arrest Report"
    When the user views the timeline
    Then the note entry should show "Arrest Report"
    And a "View full note" link should be visible

  @timeline
  Scenario: Status change shows old and new status badges
    Given case "JS-2026-0001" has a status change from "reported" to "confirmed"
    When the user views the timeline
    Then the status change entry should show "reported" badge
    And the status change entry should show "confirmed" badge

  @evidence
  Scenario: View evidence list
    Given case "JS-2026-0001" has 3 evidence files
    When the user views the "Evidence" tab
    Then 3 evidence items should be visible
    And each item should show filename and file type

  @evidence
  Scenario: Upload evidence file
    Given the user is viewing the "Evidence" tab for "JS-2026-0001"
    When the user clicks "Upload Evidence"
    And selects a file "arrest-photo.jpg"
    And sets classification to "Legal"
    And clicks "Upload"
    Then the evidence should be uploaded
    And "arrest-photo.jpg" should appear in the evidence list

  @evidence
  Scenario: View evidence chain of custody
    Given evidence "arrest-photo.jpg" has been uploaded and viewed twice
    When the user clicks on "arrest-photo.jpg"
    Then the evidence detail dialog should open
    And the chain of custody should show 3 entries:
      | action     |
      | Uploaded   |
      | Viewed     |
      | Viewed     |
    And the integrity hash should be displayed

  @evidence
  Scenario: Download evidence creates custody entry
    Given evidence "arrest-photo.jpg" exists
    When the user downloads "arrest-photo.jpg"
    Then a new "Downloaded" entry should be added to the custody chain
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/client/components/cases/CaseTimeline.tsx` | Main timeline component |
| `src/client/components/cases/timeline/NotePreview.tsx` | Note interaction preview |
| `src/client/components/cases/timeline/CallSummary.tsx` | Call interaction summary |
| `src/client/components/cases/timeline/StatusChangeBadge.tsx` | Status change display |
| `src/client/components/cases/EvidenceTab.tsx` | Evidence file list (grid/list) |
| `src/client/components/cases/EvidenceDetailDialog.tsx` | Evidence detail + custody chain |
| `src/client/components/cases/EvidenceUploadDialog.tsx` | Evidence upload with encryption |
| `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature` | Desktop BDD scenarios |
| `tests/steps/cases/timeline-evidence-steps.ts` | Desktop step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `src/client/components/cases/RecordDetailPage.tsx` | Replace Timeline + Evidence tab placeholders |
| `src/client/lib/api.ts` | Add interaction + evidence API client functions |
| `packages/i18n/locales/en.json` | Add timeline + evidence i18n sections |
| `packages/i18n/locales/*.json` | Propagate to all 13 locales |
| `tests/test-ids.ts` | Add timeline + evidence test IDs |

## Testing

### Desktop BDD
- `bun run test:desktop` -- 8 scenarios in `timeline-evidence.feature`

## Acceptance Criteria & Test Scenarios

- [ ] Timeline displays mixed interaction types in chronological order
  -> `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature: "View timeline with mixed interaction types"`
- [ ] Inline comments can be added to timeline
  -> `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature: "Add inline comment to timeline"`
- [ ] Note preview shows title and snippet
  -> `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature: "Note preview shows title and content snippet"`
- [ ] Status change shows old and new status badges
  -> `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature: "Status change shows old and new status badges"`
- [ ] Evidence list displays attached files
  -> `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature: "View evidence list"`
- [ ] Evidence can be uploaded with encryption
  -> `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature: "Upload evidence file"`
- [ ] Chain of custody is visible and accurate
  -> `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature: "View evidence chain of custody"`
- [ ] Download creates custody entry
  -> `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature: "Download evidence creates custody entry"`
- [ ] All platform BDD suites pass
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/platform/desktop/cases/timeline-evidence.feature` | New | 8 desktop scenarios for timeline + evidence |
| `tests/steps/cases/timeline-evidence-steps.ts` | New | Desktop step definitions |

## Risk Assessment

- **Medium risk**: Timeline performance (Task 1) -- a case with 100+ interactions needs efficient rendering. Mitigated by pagination (load 50 at a time with "Load more" button) and avoiding heavy decryption on initial load (decrypt only visible entries).
- **Medium risk**: Evidence upload encryption (Task 5) -- encrypting large files (10MB+ images, videos) in the browser could block the UI. Mitigated by using Web Worker for encryption (already established pattern from transcription) and showing a progress bar.
- **Medium risk**: Chain of custody integrity (Task 4) -- custody entries must be tamper-evident. The existing hash-chained audit log (Epic 77) provides the foundation. Each custody entry references the previous entry's hash.
- **Low risk**: Timeline component (Task 1) -- standard vertical list component using shadcn/ui primitives. No complex layout or animation.
- **Low risk**: Type-specific renderers (Task 2) -- small focused components with clear interfaces.

## Execution

- **Phase 1**: Verify Epic 323 + 325 APIs (no new code)
- **Phase 2**: CaseTimeline -> NotePreview + CallSummary + StatusChangeBadge -> EvidenceTab -> EvidenceDetailDialog -> EvidenceUploadDialog -> RecordDetailPage integration -> i18n -> BDD -> gate
- **Phase 3**: `bun run test:all`
