# Epic 89: Mobile UI Polish & Accessibility

## Problem Statement

Before the mobile app is production-ready, it needs polish: dark mode, haptic feedback, accessibility labels, loading states, error boundaries, offline handling, and i18n verification. This is the final pass before release.

## Requirements

### Functional Requirements

1. **Dark mode** — NativeWind dark variant, matches web app theme
2. **Haptic feedback** — Call answer, note save, shift sign-up
3. **Accessibility** — VoiceOver/TalkBack labels on all interactive elements
4. **Loading states** — Skeleton screens for lists, spinners for actions
5. **Error boundaries** — User-friendly error screens with retry
6. **Offline indicator** — Visual indicator when relay/API disconnected
7. **i18n verification** — All 13 locales render correctly (RTL for Arabic)

### Non-Functional Requirements

- WCAG 2.1 AA compliance for mobile
- RTL layout support for Arabic locale
- Graceful degradation when offline (cached data visible)

## Technical Design

### Dark Mode
- NativeWind `dark:` variant classes
- System preference detection via `useColorScheme()`
- Manual override stored in settings
- Colors match web app's CSS variables

### Haptic Feedback
- `expo-haptics` for tactile feedback
- Light impact: button taps
- Medium impact: call answer, note save
- Warning: shift drop, ban add

### Accessibility
- `accessibilityLabel` on all interactive elements
- `accessibilityRole` (button, link, header, etc.)
- `accessibilityState` (selected, disabled, expanded)
- Screen reader testing with VoiceOver (iOS) and TalkBack (Android)

### Loading & Error States
- Skeleton screens (NativeWind animated placeholder)
- Pull-to-refresh on lists
- Error boundary component with retry button
- Toast notifications for success/failure

### Offline Handling
- Show cached data when offline
- Queue API mutations for retry when online
- Visual indicator (banner or status bar)
- Disable actions that require connectivity

### i18n Verification
- Render each of 13 locales and verify no layout overflow
- Arabic RTL layout (I18nManager.forceRTL)
- CJK character rendering (zh, ko)
- Hindi/Vietnamese diacritics

## Acceptance Criteria

- [ ] Dark mode toggles correctly and persists
- [ ] Haptic feedback fires on key actions
- [ ] VoiceOver/TalkBack can navigate all screens
- [ ] All interactive elements have accessibility labels
- [ ] Loading skeletons appear during data fetch
- [ ] Error boundaries catch and display crashes gracefully
- [ ] Offline indicator shows when disconnected
- [ ] All 13 locales render without layout issues
- [ ] Arabic RTL layout works correctly

## Dependencies

- **Epic 84** (Mobile Core Screens) — screens must exist before polishing
- **Epic 85** (Mobile Admin & Messaging) — all screens must be built
