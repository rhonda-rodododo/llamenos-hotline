# Epic 89: Mobile UI Polish & Accessibility

## Problem Statement

Before the mobile app is production-ready, it needs polish: dark mode matching the web app's OKLCH color system, haptic feedback for key actions, VoiceOver/TalkBack accessibility, loading skeletons, error boundaries, offline handling, and i18n verification across all 13 locales (including RTL Arabic). This is the final pass before release — every screen built in Epics 83-86 must meet WCAG 2.1 AA standards and feel native on both iOS and Android.

## Current State

### Web App Design System (`src/client/app.css` — 177 lines)

**Framework:** Tailwind CSS v4 with `@theme` block and OKLCH color space.

**Font:** `DM Sans` (heading and body).

**Color system — Light mode (`:root`):**

| Token | OKLCH Value | Description |
|-------|-------------|-------------|
| `--background` | `oklch(0.985 0.003 90)` | Near-white warm |
| `--foreground` | `oklch(0.18 0.01 250)` | Near-black blue-gray |
| `--card` | `oklch(1 0 0)` | Pure white |
| `--primary` | `oklch(0.45 0.12 195)` | Teal |
| `--secondary` | `oklch(0.96 0.015 195)` | Light teal tint |
| `--muted` | `oklch(0.96 0.005 90)` | Near-white warm |
| `--muted-foreground` | `oklch(0.55 0.01 250)` | Gray text |
| `--accent` | `oklch(0.75 0.15 70)` | Warm amber/gold |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Red-orange |
| `--border` | `oklch(0.92 0.005 90)` | Light border |
| `--ring` | `oklch(0.45 0.12 195)` | Teal (matches primary) |
| `--sidebar` | `oklch(0.98 0.008 195)` | Very light teal |

**Color system — Dark mode (`.dark`):**

| Token | OKLCH Value | Description |
|-------|-------------|-------------|
| `--background` | `oklch(0.14 0.015 250)` | Deep blue-gray |
| `--foreground` | `oklch(0.95 0.005 90)` | Near-white |
| `--card` | `oklch(0.18 0.015 250)` | Slightly lighter than bg |
| `--primary` | `oklch(0.70 0.13 195)` | Lighter teal (high contrast) |
| `--secondary` | `oklch(0.25 0.01 250)` | Dark blue-gray |
| `--muted` | `oklch(0.25 0.01 250)` | Dark muted |
| `--muted-foreground` | `oklch(0.65 0.01 250)` | Light gray text |
| `--accent` | `oklch(0.78 0.14 70)` | Warm amber |
| `--border` | `oklch(0.28 0.01 250)` | Dark border |
| `--sidebar` | `oklch(0.16 0.015 250)` | Slightly lighter than bg |

**Full semantic token set (39 tokens):**
`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring`, `chart-1` through `chart-5`, plus sidebar variants.

**Radius scale:** base `0.625rem` with `-4px` (sm), `-2px` (md), base (lg), `+4px` (xl), `+8px` (2xl), `+12px` (3xl), `+16px` (4xl).

**Hard-coded semantic colors used in components:**
- Status dots: `bg-green-500` (active/available), `bg-yellow-500` (waiting), `bg-gray-400` (closed/offline)
- Event category badges: blue (auth), purple (volunteers), green (calls), amber (settings), cyan (shifts)
- Channel security: green (e2ee), yellow (bridge), orange (provider-encrypted), red (none)
- Role badges: `default` variant (admin), `secondary` (volunteer)
- Active/inactive: `border-green-500/50 text-green-700` / `border-red-500/50 text-red-700`

**Dark mode implementation:** Class-based (`.dark` on `<html>`). Three options: `light`, `dark`, `system`. Preference stored in `localStorage` key `llamenos-theme`.

### i18n Setup (`src/client/lib/i18n.ts` — 63 lines)

**Library:** `i18next` + `react-i18next`

**13 locales:** `en`, `es`, `zh`, `tl`, `vi`, `ar`, `fr`, `ht`, `ko`, `ru`, `hi`, `pt`, `de`

**Locale file structure:** Flat namespace `"translation"`, nested keys. `src/client/locales/en.json` is 905 lines with 50+ top-level sections:
`common`, `auth`, `nav`, `dashboard`, `calls`, `callSettings`, `notes`, `transcription`, `shifts`, `volunteers`, `webauthn`, `banList`, `auditLog`, `ivrAudio`, `ivr`, `spam`, `callHistory`, `profile`, `phone`, `settings`, `session`, `commandPalette`, `onboarding`, `pin`, `profileSettings`, `shortcuts`, `confirm`, `telephonyProvider`, `customFields`, `volunteerProfile`, `setup`, `reports`, `notifications`, `pwa`, `panicWipe`, `pinChallenge`, `recording`, `rcs`, `a11y`, `deviceLink`, `hubs`, `blasts`, `preferences`

**Language detection:**
```typescript
const savedLang = localStorage.getItem('llamenos-lang') || navigator.language.split('-')[0]
```

**RTL support:** Only `ar` is RTL. `syncDocumentLang()` sets `document.documentElement.dir`.

**Usage pattern:**
```typescript
const { t } = useTranslation()
t('volunteers.title')                      // simple key
t('volunteers.removeVolunteer', { name })  // interpolation
t('auditLog.events.callAnswered')          // nested key
```

## Requirements

### Functional Requirements

1. **Dark mode** — NativeWind dark variant matching web app's OKLCH teal/amber palette
2. **Haptic feedback** — Tactile feedback on key volunteer actions
3. **Accessibility** — VoiceOver (iOS) / TalkBack (Android) full navigation
4. **Loading states** — Skeleton screens for lists, spinners for mutations
5. **Error boundaries** — Crash recovery with retry
6. **Offline indicator** — Visual status when relay/API disconnected
7. **i18n verification** — All 13 locales render without layout overflow, RTL for Arabic

### Non-Functional Requirements

- WCAG 2.1 AA compliance for mobile
- RTL layout support for Arabic (mirrored navigation, text alignment)
- CJK character rendering (Chinese, Korean)
- Hindi/Vietnamese diacritics display correctly
- Graceful degradation when offline (cached data visible, mutations queued)

## Technical Design

### Dark Mode with NativeWind

NativeWind v4 supports `dark:` variant classes. The challenge is mapping the web app's OKLCH CSS variables to React Native colors.

**OKLCH to Hex conversion** (computed once, stored as constants):

```typescript
// src/lib/theme.ts — Design tokens for React Native
// Converted from web app's OKLCH values to hex for RN compatibility

export const colors = {
  light: {
    background: '#faf9f7',      // oklch(0.985 0.003 90)
    foreground: '#1a1d2e',      // oklch(0.18 0.01 250)
    card: '#ffffff',            // oklch(1 0 0)
    primary: '#0d7377',         // oklch(0.45 0.12 195)
    primaryForeground: '#ffffff',
    secondary: '#e8f4f4',       // oklch(0.96 0.015 195)
    muted: '#f3f2f0',          // oklch(0.96 0.005 90)
    mutedForeground: '#6b6e7a', // oklch(0.55 0.01 250)
    accent: '#c49a3c',          // oklch(0.75 0.15 70)
    destructive: '#e5484d',     // oklch(0.577 0.245 27.325)
    border: '#e8e6e3',          // oklch(0.92 0.005 90)
    ring: '#0d7377',            // matches primary
  },
  dark: {
    background: '#161a2a',      // oklch(0.14 0.015 250)
    foreground: '#f0eeeb',      // oklch(0.95 0.005 90)
    card: '#1e2236',            // oklch(0.18 0.015 250)
    primary: '#3db8bc',         // oklch(0.70 0.13 195)
    primaryForeground: '#0a0a0a',
    secondary: '#2a2e42',       // oklch(0.25 0.01 250)
    muted: '#2a2e42',
    mutedForeground: '#9499ab', // oklch(0.65 0.01 250)
    accent: '#d4a84a',          // oklch(0.78 0.14 70)
    destructive: '#e5484d',
    border: '#363a50',          // oklch(0.28 0.01 250)
    ring: '#3db8bc',
  },
} as const
```

**NativeWind Tailwind config:**
```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        // ... map all 39 tokens
      },
      fontFamily: {
        sans: ['DMSans-Regular'],
        'sans-medium': ['DMSans-Medium'],
        'sans-bold': ['DMSans-Bold'],
      },
    },
  },
  presets: [require('nativewind/preset')],
}
```

**Theme provider:**
```typescript
// src/lib/theme-provider.tsx
import { useColorScheme } from 'react-native'
import { useSettingsStore } from './store'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme()
  const { themePref } = useSettingsStore()  // 'light' | 'dark' | 'system'
  const resolvedScheme = themePref === 'system' ? systemScheme : themePref

  // NativeWind reads `colorScheme` from context
  return (
    <View className={resolvedScheme === 'dark' ? 'dark' : ''} style={{ flex: 1 }}>
      {children}
    </View>
  )
}
```

**Font loading:**
```typescript
// DM Sans loaded via expo-font in _layout.tsx
import { useFonts } from 'expo-font'

const [fontsLoaded] = useFonts({
  'DMSans-Regular': require('@/assets/fonts/DMSans-Regular.ttf'),
  'DMSans-Medium': require('@/assets/fonts/DMSans-Medium.ttf'),
  'DMSans-Bold': require('@/assets/fonts/DMSans-Bold.ttf'),
})
```

### Haptic Feedback

```typescript
// src/lib/haptics.ts
import * as Haptics from 'expo-haptics'

export const haptic = {
  // Light: button taps, list item selection
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  // Medium: call answer, note save, shift sign-up
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  // Heavy: panic wipe trigger, destructive actions
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  // Warning: shift drop, ban add, volunteer deactivation
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  // Success: message sent, settings saved
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  // Error: auth failure, decryption failure
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
}
```

**Usage map:**

| Action | Haptic | Rationale |
|--------|--------|-----------|
| Button tap | `light` | Standard tactile confirmation |
| Call answer | `medium` | Important action confirmation |
| Call decline | `warning` | Destructive-adjacent |
| Note save | `success` | Completion signal |
| Message sent | `success` | Completion signal |
| Shift sign-up | `medium` | Commitment action |
| Shift drop | `warning` | Cancellation |
| Ban add | `warning` | Moderation action |
| Volunteer deactivate | `warning` | Administrative action |
| PIN incorrect | `error` | Auth failure |
| Decryption failure | `error` | Crypto failure |
| Panic wipe trigger | `heavy` | Emergency action |
| Pull-to-refresh | `light` | Standard interaction |
| Swipe-to-delete | `light` → `warning` on confirm | Progressive feedback |

### Accessibility

**Accessibility labels — component patterns:**

```typescript
// Every interactive element must have:
<Pressable
  accessibilityLabel={t('volunteers.addVolunteer')}
  accessibilityRole="button"
  accessibilityState={{ disabled: loading }}
  accessibilityHint={t('a11y.opensAddForm')}
>

// Status indicators:
<View
  accessibilityLabel={t('dashboard.onShift')}
  accessibilityRole="text"
/>

// Lists:
<FlatList
  accessibilityLabel={t('notes.notesList')}
  accessibilityRole="list"
/>

// Encrypted content:
<View
  accessibilityLabel={
    decrypted
      ? t('a11y.decryptedNote', { preview: decrypted.slice(0, 50) })
      : t('a11y.encryptedContent')
  }
/>
```

**Minimum touch targets:** 44x44pt (iOS) / 48x48dp (Android). All buttons, list items, and interactive areas must meet this. Use `hitSlop` for small icons:

```typescript
<Pressable hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
  <Icon size={20} />
</Pressable>
```

**Focus management:**
- Modal open → focus first interactive element
- Modal close → return focus to trigger element
- Screen navigation → announce screen title via `accessibilityViewIsModal`
- Error states → announce error message to screen reader

**Reduced motion:**
```typescript
import { AccessibilityInfo } from 'react-native'
const [reduceMotion, setReduceMotion] = useState(false)
useEffect(() => {
  AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
  return () => sub.remove()
}, [])
```

### Loading States — Skeleton Screens

```typescript
// src/components/Skeleton.tsx
import Animated, { useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated'

export function Skeleton({ width, height, className }: {
  width: number | string
  height: number
  className?: string
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withRepeat(
      withTiming(0.5, { duration: 1000 }),
      -1, true
    ),
  }))

  return (
    <Animated.View
      className={cn('rounded-md bg-muted', className)}
      style={[{ width, height }, animatedStyle]}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    />
  )
}

// Pre-built skeletons for common patterns:
export function NoteCardSkeleton() { /* 3 lines of varying width */ }
export function ConversationCardSkeleton() { /* avatar + 2 lines */ }
export function VolunteerCardSkeleton() { /* name + role badge + phone */ }
export function AuditEntrySkeleton() { /* badge + text + timestamp */ }
export function ShiftCardSkeleton() { /* time range + role */ }
```

**Pull-to-refresh:** Every list screen uses `RefreshControl`:

```typescript
<FlatList
  refreshControl={
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={handleRefresh}
      tintColor={colors[scheme].primary}  // Theme-aware spinner color
    />
  }
/>
```

### Error Boundaries

```typescript
// src/components/ErrorBoundary.tsx
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary'

function ErrorFallback({ error, resetErrorBoundary }: {
  error: Error
  resetErrorBoundary: () => void
}) {
  return (
    <View className="flex-1 items-center justify-center p-8">
      <AlertTriangle className="text-destructive mb-4" size={48} />
      <Text className="text-lg font-sans-bold text-foreground mb-2">
        {t('common.somethingWentWrong')}
      </Text>
      <Text className="text-muted-foreground text-center mb-6">
        {error.message}
      </Text>
      <Pressable
        onPress={resetErrorBoundary}
        className="bg-primary px-6 py-3 rounded-lg"
        accessibilityLabel={t('common.tryAgain')}
        accessibilityRole="button"
      >
        <Text className="text-primary-foreground font-sans-medium">
          {t('common.tryAgain')}
        </Text>
      </Pressable>
    </View>
  )
}

// Wrap each screen/tab independently
export function ScreenErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ReactErrorBoundary FallbackComponent={ErrorFallback}>
      {children}
    </ReactErrorBoundary>
  )
}
```

### Offline Handling

```typescript
// src/components/OfflineBanner.tsx
import NetInfo from '@react-native-community/netinfo'

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const { state: relayState } = useRelay()  // From Nostr relay context (Epic 84)

  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false)
    })
    return () => unsub()
  }, [])

  const showBanner = !isOnline || relayState === 'disconnected'
  if (!showBanner) return null

  return (
    <View className="bg-destructive/10 px-4 py-2 flex-row items-center">
      <WifiOff size={16} className="text-destructive mr-2" />
      <Text className="text-destructive text-sm font-sans-medium">
        {!isOnline ? t('common.offline') : t('common.relayDisconnected')}
      </Text>
    </View>
  )
}
```

**Mutation queueing** (React Query `onMutate` + `onError` + retry):
```typescript
// React Query already retries failed mutations
const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
  },
})
```

**Cached data:** React Query's `staleTime` and `gcTime` ensure data is visible when offline. Lists show last-fetched data with a "Last updated X ago" footer.

### i18n for React Native

**Library:** Same `i18next` + `react-i18next` as web app. Locale JSON files copied from `src/client/locales/`.

**Mobile-specific setup:**

```typescript
// src/lib/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getLocales } from 'expo-localization'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { I18nManager } from 'react-native'

// Import all locale files (bundled with app)
import en from '@/locales/en.json'
import es from '@/locales/es.json'
// ... all 13 locales

const RTL_LANGUAGES = ['ar']
const LANGUAGE_CODES = ['en', 'es', 'zh', 'tl', 'vi', 'ar', 'fr', 'ht', 'ko', 'ru', 'hi', 'pt', 'de']

export async function initI18n(): Promise<void> {
  const savedLang = await AsyncStorage.getItem('llamenos-lang')
  const deviceLang = getLocales()[0]?.languageCode ?? 'en'
  const lang = savedLang ?? (LANGUAGE_CODES.includes(deviceLang) ? deviceLang : 'en')

  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, es: { translation: es }, /* ... */ },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })

  // RTL support
  const isRTL = RTL_LANGUAGES.includes(lang)
  if (I18nManager.isRTL !== isRTL) {
    I18nManager.forceRTL(isRTL)
    // Note: forceRTL requires app restart to take effect on Android
  }
}

export async function setLanguage(lang: string): Promise<void> {
  await i18n.changeLanguage(lang)
  await AsyncStorage.setItem('llamenos-lang', lang)
  const isRTL = RTL_LANGUAGES.includes(lang)
  if (I18nManager.isRTL !== isRTL) {
    I18nManager.forceRTL(isRTL)
    // Show alert: "Please restart the app for layout changes"
  }
}
```

**RTL layout considerations:**
- NativeWind automatically mirrors `flex-row` to `flex-row-reverse` in RTL
- Icons with directional meaning (arrows, chevrons) need explicit RTL handling
- Text alignment: NativeWind handles `text-left`/`text-right` mirroring
- Swipe gestures: swipe-to-delete direction reverses in RTL

**i18n verification checklist (per locale):**

| Locale | Script | Direction | Key Concerns |
|--------|--------|-----------|-------------|
| en | Latin | LTR | Baseline |
| es | Latin | LTR | Longer strings (30-40% expansion) |
| zh | CJK | LTR | Character width, line breaking |
| tl | Latin | LTR | Similar to en |
| vi | Latin + diacritics | LTR | Diacritic stacking (ả, ẩ, ỹ) |
| ar | Arabic | **RTL** | Full RTL layout, connected script |
| fr | Latin | LTR | Longer strings, accents |
| ht | Latin | LTR | Similar to fr |
| ko | Hangul | LTR | Character width, spacing |
| ru | Cyrillic | LTR | Moderate string expansion |
| hi | Devanagari | LTR | Line height (tall glyphs), conjuncts |
| pt | Latin | LTR | Similar to es |
| de | Latin | LTR | Long compound words (may overflow) |

**German compound word handling:** Use `numberOfLines` + `ellipsizeMode` on constrained labels. Test longest strings: `Benachrichtigungseinstellungen` ("notification settings").

### Toast Notifications

```typescript
// src/lib/toast.ts
import Toast from 'react-native-toast-message'

export const toast = {
  success: (message: string) => Toast.show({ type: 'success', text1: message }),
  error: (message: string) => Toast.show({ type: 'error', text1: message }),
  info: (message: string) => Toast.show({ type: 'info', text1: message }),
}
```

Custom toast config matching the app's design system:
```typescript
const toastConfig = {
  success: ({ text1 }) => (
    <View className="bg-card border border-green-500/50 rounded-xl px-4 py-3 mx-4 flex-row items-center shadow-lg">
      <CheckCircle size={20} className="text-green-500 mr-3" />
      <Text className="text-foreground font-sans-medium flex-1">{text1}</Text>
    </View>
  ),
  error: ({ text1 }) => (
    <View className="bg-card border border-destructive/50 rounded-xl px-4 py-3 mx-4 flex-row items-center shadow-lg">
      <AlertCircle size={20} className="text-destructive mr-3" />
      <Text className="text-foreground font-sans-medium flex-1">{text1}</Text>
    </View>
  ),
}
```

## Files to Create

### Theme & Design
- `src/lib/theme.ts` — Color tokens (light/dark hex values from OKLCH)
- `src/lib/theme-provider.tsx` — Dark mode context, system preference
- `src/assets/fonts/DMSans-*.ttf` — DM Sans font files (Regular, Medium, Bold)
- `tailwind.config.js` — Update with full semantic color palette

### Interaction
- `src/lib/haptics.ts` — Haptic feedback utility with semantic methods
- `src/lib/toast.ts` — Toast notification wrapper

### Accessibility
- `src/components/ScreenErrorBoundary.tsx` — Error boundary per-screen
- `src/components/Skeleton.tsx` — Animated skeleton + pre-built variants
- `src/components/OfflineBanner.tsx` — Network/relay status indicator

### i18n
- `src/lib/i18n.ts` — i18next setup for React Native (AsyncStorage, expo-localization, RTL)
- `src/locales/*.json` — Copy all 13 locale files from web app

### Dependencies to Install

```bash
npx expo install expo-haptics expo-font expo-localization react-native-toast-message
# react-native-reanimated already from Epic 83/84
# @react-native-community/netinfo already from Epic 84
```

## Acceptance Criteria

- [ ] Dark mode toggles correctly (light/dark/system) and persists across restarts
- [ ] Color palette matches web app's teal/amber OKLCH theme (verified side-by-side)
- [ ] DM Sans font loaded and used throughout
- [ ] Haptic feedback fires on all mapped actions
- [ ] VoiceOver (iOS) can navigate all screens and read all content
- [ ] TalkBack (Android) can navigate all screens and read all content
- [ ] All interactive elements have accessibility labels
- [ ] Minimum touch targets met (44pt iOS / 48dp Android)
- [ ] Reduced motion preference respected (animations disabled)
- [ ] Loading skeletons appear during initial data fetch
- [ ] Pull-to-refresh works on all list screens
- [ ] Error boundaries catch crashes and show retry UI
- [ ] Offline banner shows when network/relay disconnected
- [ ] Cached data visible when offline
- [ ] Failed mutations retry automatically when online
- [ ] All 13 locales render without layout overflow
- [ ] Arabic RTL layout works correctly (navigation, text, swipe gestures)
- [ ] CJK characters (zh, ko) display correctly
- [ ] Hindi Devanagari conjuncts display correctly
- [ ] Vietnamese diacritics display correctly
- [ ] German compound words don't overflow constrained labels
- [ ] Toast notifications match design system colors

## Dependencies

- **Epic 83** (Mobile Foundation) — base NativeWind setup, React Query, Zustand
- **Epic 84** (Mobile Core Screens) — screens to polish, Nostr relay for offline indicator
- **Epic 85** (Mobile Admin & Messaging) — admin screens to polish
