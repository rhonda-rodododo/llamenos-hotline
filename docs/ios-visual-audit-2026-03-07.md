# iOS Visual Audit - 2026-03-07

Comprehensive review of all 44 SwiftUI view files in `apps/ios/Sources/Views/`.

## Screen: Login (LoginView)
- Screenshot: `testScreenshotLoginScreen` (AuthScreenshotAuditTests)
- Issues found:
  - None. All strings use NSLocalizedString. Accessibility identifiers present on all interactive elements.

## Screen: Import Key (ImportKeyView)
- Screenshot: Not yet covered (requires test flow through LoginView)
- Issues found:
  - None. Well-structured with proper i18n and accessibility.

## Screen: Onboarding / Nsec Backup (OnboardingView)
- Screenshot: Not yet covered (requires identity creation flow)
- Issues found:
  - None. Privacy-sensitive flag correctly applied to nsec display.

## Screen: PIN Set (PINSetView)
- Screenshot: Not yet covered (requires onboarding flow completion)
- Issues found:
  - None. StepIndicator, PIN length picker, and PIN pad all have identifiers.

## Screen: PIN Unlock (PINUnlockView)
- Screenshot: `testScreenshotPINUnlockScreen` (AuthScreenshotAuditTests)
- Issues found:
  - None. Biometric button properly identified. Breathing animation present.

## Screen: Biometric Prompt (BiometricPrompt)
- Screenshot: N/A (system modal)
- Issues found:
  - None. Proper localization of cancel text and biometric type names.

## Screen: Dashboard (DashboardView)
- Screenshot: `testScreenshotDashboard`, `testScreenshotDashboardConnectionCard`
- Issues found:
  - None. Comprehensive accessibility identifiers on all cards and actions. All strings localized.

## Screen: Main Tab View (MainTabView)
- Screenshot: Implicit (part of every authenticated screenshot)
- Issues found:
  - None. Tab labels use NSLocalizedString. `main-tab-view` identifier present.

## Screen: Notes List (NotesView)
- Screenshot: `testScreenshotNotes`, `testScreenshotNotesEmptyState`
- Issues found:
  - None. All states (loading, empty, error, list) have identifiers. Pagination load-more accessible.

## Screen: Note Create (NoteCreateView)
- Screenshot: `testScreenshotNoteCreate`
- Issues found:
  - None. Custom field inputs all have `field-{name}` identifiers. Required indicator present.

## Screen: Note Detail (NoteDetailView)
- Screenshot: Not yet covered (requires existing note data)
- Issues found:
  - None. Privacy-sensitive markers on note text and field values (M28 compliance).

## Screen: Conversations List (ConversationsView)
- Screenshot: `testScreenshotConversations`, `testScreenshotConversationsEmptyState`
- Issues found:
  - None. Status filter menu, channel badges, unread counts all properly accessible.

## Screen: Conversation Detail (ConversationDetailView)
- Screenshot: Not yet covered (requires conversation data)
- Issues found:
  - None. Message bubbles have per-message identifiers. Reply bar state-dependent (closed vs open).

## Screen: Shifts (ShiftsView)
- Screenshot: `testScreenshotShifts`, `testScreenshotShiftsEmptyState`
- Issues found:
  - None. Clock in/out button dynamically identified. CircularClockButtonStyle has press animation.

## Screen: Settings (SettingsView)
- Screenshot: `testScreenshotSettings`
- Issues found:
  - [FIXED][medium] Debug-only test shortcut for panic-wipe exists in `#if DEBUG` block. This is by design for testability but could confuse visual audit if debug build is used for screenshots.

## Screen: Account Settings (AccountSettingsView)
- Screenshot: `testScreenshotAccountSettings`
- Issues found:
  - None. Copy buttons for npub/pubkey properly identified. Device link sheet accessible.

## Screen: Preferences (PreferencesSettingsView)
- Screenshot: `testScreenshotPreferences`
- Issues found:
  - None. Auto-lock picker, biometric toggle, language picker all identified.

## Screen: Panic Wipe Confirmation (PanicWipeConfirmationView)
- Screenshot: `testScreenshotPanicWipe`
- Issues found:
  - [FIXED][high] 4 hardcoded English strings not wrapped in NSLocalizedString:
    - `"Type WIPE to confirm"` -> now uses `panic_wipe_confirm_input_hint`
    - `"WIPE"` (placeholder) -> now uses `panic_wipe_confirm_input_placeholder`
    - `"This cannot be undone"` (alert title) -> now uses `panic_wipe_confirm_final_title`
    - `"Yes, Wipe Everything"` (alert button) -> now uses `panic_wipe_confirm_final_action`
    - `"Are you absolutely sure..."` (alert message) -> now uses `panic_wipe_confirm_final_message`
  - [FIXED][medium] `panic_wipe_message` key used for on-screen description but maps to "All data has been wiped" (post-wipe toast text). Changed to `panic_wipe_description` which maps to the correct description text.

## Screen: Device Link (DeviceLinkView)
- Screenshot: Not yet covered (requires camera/QR flow)
- Issues found:
  - None. All 6 states (scanning, connecting, verifying, importing, completed, error) have identifiers.

## Screen: Admin Panel (AdminTabView)
- Screenshot: `testScreenshotAdminPanel`
- Issues found:
  - None. All 5 navigation links properly identified.

## Screen: Volunteers (VolunteersView)
- Screenshot: `testScreenshotAdminVolunteers`
- Issues found:
  - None. Search, stats header, volunteer rows, role menus all properly identified.

## Screen: Ban List (BanListView)
- Screenshot: `testScreenshotAdminBanList`
- Issues found:
  - None. Add ban button, sheet form inputs, delete buttons all identified.

## Screen: Audit Log (AuditLogView)
- Screenshot: `testScreenshotAdminAuditLog`
- Issues found:
  - None. Expand/collapse buttons per-entry. Hash chain info properly displayed.

## Screen: Invites (InviteView)
- Screenshot: `testScreenshotAdminInvites`
- Issues found:
  - None. Active/claimed/expired sections. Copy invite buttons. Role picker in create sheet.

## Screen: Custom Fields (CustomFieldsView)
- Screenshot: `testScreenshotAdminCustomFields`
- Issues found:
  - None. Field rows, swipe-to-delete, edit sheet all accessible.

## Screen: Custom Field Edit (CustomFieldEditView)
- Screenshot: Not yet covered (requires tapping into editor)
- Issues found:
  - None. All form inputs identified. Option add/remove accessible.

## Screen: Help (HelpView)
- Screenshot: `testScreenshotHelp`
- Issues found:
  - None. All sections have identifiers. DisclosureGroups for FAQ items.

## Screen: Reports (ReportsView)
- Screenshot: `testScreenshotReports`
- Issues found:
  - None. Filter menu, create button, report rows all accessible.

## Screen: Report Create (ReportCreateView)
- Screenshot: Not yet covered (requires sheet presentation)
- Issues found:
  - None. Title, category picker, body TextEditor, submit button all identified.

## Screen: Report Detail (ReportDetailView)
- Screenshot: Not yet covered (requires report data)
- Issues found:
  - None. Status badges, metadata card, claim/close buttons all accessible.

## Screen: Contacts (ContactsView)
- Screenshot: `testScreenshotContacts`
- Issues found:
  - None. Search, contact rows with interaction badges, pagination all accessible.

## Screen: Contact Timeline (ContactTimelineView)
- Screenshot: Not yet covered (requires navigating into a contact)
- Issues found:
  - [FIXED][low] Loading state missing `accessibilityIdentifier` -> added `timeline-loading`
  - [FIXED][low] Error state missing `accessibilityIdentifier` -> added `timeline-error`

## Screen: Blasts (BlastsView)
- Screenshot: `testScreenshotBlasts`
- Issues found:
  - None. Subscriber stats, blast rows, send buttons all accessible.

## Screen: Create Blast (CreateBlastView)
- Screenshot: Not yet covered (requires sheet presentation)
- Issues found:
  - None. Name input, message editor, channel toggles, schedule picker all identified.

## Component: BrandEmptyState
- Issues found:
  - [FIXED][low] Missing `accessibilityElement` and `accessibilityIdentifier` -> added `brand-empty-state`

## Component: CopyableField
- Issues found:
  - [FIXED][low] Copy button missing `accessibilityIdentifier` and `accessibilityLabel` -> added `copy-field-button` with localized label

## Component: BrandCard
- Issues found:
  - None. Container component; callers provide identifiers.

## Component: StatusDot
- Issues found:
  - None. Decorative element, appropriately used with parent identifiers.

## Component: BadgeView
- Issues found:
  - None. Display component, no interactive elements.

## Component: GeneratedAvatar
- Issues found:
  - None. Decorative component.

## Component: StepIndicator
- Issues found:
  - None. Used in onboarding flow.

## Component: CopyConfirmationBanner
- Issues found:
  - None. Has `copy-confirmation` identifier.

## Component: PINPadView
- Issues found:
  - None. Comprehensive identifiers: `pin-pad`, `pin-dots`, `pin-{digit}`, `pin-backspace`.

## Component: SecureTextField
- Issues found:
  - None. Has `nsec-display` identifier. Text selection disabled for security.

## Component: LoadingOverlay
- Issues found:
  - None. Has `loading-overlay` identifier, modal trait, and localized label.

## Settings: Language Picker
- Issues found:
  - [FIXED][medium] Language names were ASCII-only approximations (e.g., "Espanol" instead of "Espanol", "Chinese" instead of native script). Fixed to use proper Unicode names in native scripts: Chinese, Korean, Russian, Hindi, Arabic, Vietnamese, Portuguese, French, Spanish, Haitian Creole.

---

## Summary of Fixes Applied

### i18n Fixes
1. **PanicWipeConfirmationView**: 5 hardcoded English strings wrapped in NSLocalizedString with new keys added to all 13 locale files
2. **PanicWipeConfirmationView**: Fixed incorrect `panic_wipe_message` key (post-wipe toast) being used for description text; changed to `panic_wipe_description`
3. **New i18n keys added**: `panicWipe.confirmFinalAction`, `panicWipe.confirmFinalMessage`, `panicWipe.confirmFinalTitle`, `panicWipe.confirmInputHint`, `panicWipe.confirmInputPlaceholder`, `panicWipe.description`, `a11y.copyField`
4. **Language names**: Fixed to use proper Unicode characters and native script names

### Accessibility Fixes
1. **BrandEmptyState**: Added `accessibilityElement(children: .contain)` and `accessibilityIdentifier("brand-empty-state")`
2. **CopyableField**: Added `accessibilityIdentifier("copy-field-button")` and localized `accessibilityLabel` to copy button
3. **ContactTimelineView**: Added `accessibilityIdentifier("timeline-loading")` to loading state
4. **ContactTimelineView**: Added `accessibilityIdentifier("timeline-error")` to error state

### Screenshot Test Expansion
- **Before**: 10 screenshots covering 8 screens
- **After**: 23 screenshots covering 19 screens + 2 auth flow screenshots in a separate test class
- **New coverage**: Notes empty state, Note create sheet, Conversations empty, Shifts empty, Account settings scrolled, all 5 admin sub-views (Volunteers, Bans, Audit, Invites, Custom Fields), Reports, Contacts, Blasts, Help scrolled views, Dashboard connection card, Login screen, PIN unlock screen

### Screens Not Yet Screenshotable (require live data or complex flows)
- Note Detail (needs existing note)
- Conversation Detail (needs existing conversation)
- Report Create/Detail (needs sheet/navigation flow)
- Create Blast (needs sheet)
- Custom Field Edit (needs sheet)
- Device Link (needs camera access)
- Onboarding (needs identity creation flow)
- PIN Set (needs onboarding completion)
- Import Key (needs login flow)
