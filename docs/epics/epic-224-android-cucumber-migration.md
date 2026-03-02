# Epic 224: Android Cucumber-Android Migration

## Overview

Migrate the 25 Android Compose UI test classes (106 `@Test` methods) from Gherkin-as-Specification to actual Cucumber-driven execution using `cucumber-android:7.18.1` with first-class Hilt + Compose support. Feature files from `packages/test-specs/` become the executable test source.

## Current State

- 25 test classes in `apps/android/.../e2e/` with 106 `@Test` methods
- Tests are plain Compose UI Tests — no Cucumber dependency
- Feature files exist in `packages/test-specs/features/` but are specification-only
- `HiltTestRunner` in `HiltTestRunner.kt` extends `AndroidJUnitRunner`
- `hilt-android-testing:2.53.1` already in dependencies
- `TestNavigationHelper.kt` + `ComposeTestExtensions.kt` provide shared helpers

## Architecture

### Before (Gherkin-as-Specification)
```
packages/test-specs/features/*.feature  →  (human reads)  →  writes Kotlin @Test
                                                              ↓
                                            validate-coverage.ts checks naming match
```

### After (Cucumber-Driven)
```
packages/test-specs/features/*.feature  →  Gradle copies to androidTest/assets/features/
                                                              ↓
                                            CucumberHiltRunner discovers features
                                                              ↓
                                            Step definitions match Given/When/Then
                                                              ↓
                                            ComposeRuleHolder provides compose test rule
                                                              ↓
                                            Hilt injects CryptoService, KeystoreService
```

## Dependencies to Add

### Version Catalog (`gradle/libs.versions.toml`)
```toml
[versions]
cucumber = "7.18.1"

[libraries]
cucumber-android = { group = "io.cucumber", name = "cucumber-android", version.ref = "cucumber" }
cucumber-android-hilt = { group = "io.cucumber", name = "cucumber-android-hilt", version.ref = "cucumber" }
```

### Build Gradle (`app/build.gradle.kts`)
```kotlin
androidTestImplementation(libs.cucumber.android)
androidTestImplementation(libs.cucumber.android.hilt)
```

## Test Runner

Replace `HiltTestRunner` with `CucumberHiltRunner`:

```kotlin
// src/androidTest/java/org/llamenos/hotline/CucumberHiltRunner.kt
package org.llamenos.hotline

import android.app.Application
import android.content.Context
import dagger.hilt.android.testing.HiltTestApplication
import io.cucumber.android.runner.CucumberAndroidJUnitRunner
import io.cucumber.junit.CucumberOptions

@CucumberOptions(
    features = ["features"],
    glue = ["org.llamenos.hotline.steps"],
    tags = "@android"
)
class CucumberHiltRunner : CucumberAndroidJUnitRunner() {
    override fun newApplication(
        cl: ClassLoader,
        className: String,
        context: Context
    ): Application {
        return super.newApplication(cl, HiltTestApplication::class.java.name, context)
    }
}
```

Update `build.gradle.kts`:
```kotlin
testInstrumentationRunner = "org.llamenos.hotline.CucumberHiltRunner"
```

## Compose Rule Holder

```kotlin
// src/androidTest/java/org/llamenos/hotline/steps/ComposeRuleHolder.kt
package org.llamenos.hotline.steps

import androidx.compose.ui.test.junit4.createEmptyComposeRule
import io.cucumber.junit.WithJunitRule
import org.junit.Rule
import javax.inject.Inject
import javax.inject.Singleton

@WithJunitRule
@Singleton
class ComposeRuleHolder @Inject constructor() {
    @get:Rule(order = 1)
    val composeRule = createEmptyComposeRule()
}
```

## Activity Scenario Holder

Must be `@Singleton` + `@Inject constructor()` for Hilt to inject into step definition classes:

```kotlin
// src/androidTest/java/org/llamenos/hotline/steps/ActivityScenarioHolder.kt
package org.llamenos.hotline.steps

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import io.cucumber.java.After
import org.llamenos.hotline.MainActivity
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ActivityScenarioHolder @Inject constructor() {
    var scenario: ActivityScenario<MainActivity>? = null

    fun launch() {
        val intent = Intent(
            InstrumentationRegistry.getInstrumentation().targetContext,
            MainActivity::class.java
        )
        scenario = ActivityScenario.launch(intent)
    }

    @After(order = 10000)
    fun close() {
        scenario?.close()
        scenario = null
    }
}
```

## Base Steps

```kotlin
// src/androidTest/java/org/llamenos/hotline/steps/BaseSteps.kt
package org.llamenos.hotline.steps

import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.SemanticsNodeInteractionCollection
import javax.inject.Inject

abstract class BaseSteps : SemanticsNodeInteractionsProvider {
    @Inject
    lateinit var composeRuleHolder: ComposeRuleHolder

    override fun onAllNodes(
        matcher: SemanticsMatcher,
        useUnmergedTree: Boolean
    ): SemanticsNodeInteractionCollection =
        composeRuleHolder.composeRule.onAllNodes(matcher, useUnmergedTree)

    override fun onNode(
        matcher: SemanticsMatcher,
        useUnmergedTree: Boolean
    ): SemanticsNodeInteraction =
        composeRuleHolder.composeRule.onNode(matcher, useUnmergedTree)
}
```

## Step Definition Structure

Convert the 25 test classes into domain-organized step definitions:

```
steps/
  common/
    ComposeRuleHolder.kt        # JUnit rule holder
    ActivityScenarioHolder.kt   # Activity lifecycle
    BaseSteps.kt                # SemanticsNodeInteractionsProvider base
    NavigationSteps.kt          # Tab navigation, back navigation
    AuthSteps.kt                # Login, PIN entry, identity creation
    AssertionSteps.kt           # Generic "I should see" / "I should not see"
  auth/
    LoginSteps.kt               # Login screen-specific steps
    OnboardingSteps.kt          # Identity creation flow
    PinSteps.kt                 # PIN setup + unlock steps
    KeyImportSteps.kt           # Key import flow
  dashboard/
    DashboardSteps.kt           # Dashboard display + shift actions
  notes/
    NoteSteps.kt                # Note list, create, detail
  conversations/
    ConversationSteps.kt        # List, filters
  shifts/
    ShiftSteps.kt               # List, clock in/out
  settings/
    SettingsSteps.kt            # Display, lock/logout, device link
  admin/
    AdminSteps.kt               # Navigation, tabs, access control
  crypto/
    CryptoSteps.kt              # All crypto tests (pure API, no UI)
```

### Example: Converting LoginScreenTest → LoginSteps

**Before** (`e2e/auth/LoginScreenTest.kt`):
```kotlin
@Test
fun loginScreenDisplaysAllRequiredElements() {
    composeRule.waitForIdle()
    composeRule.onNodeWithTag("app-title").assertExists()
    composeRule.onNodeWithTag("hub-url-input").assertExists()
    composeRule.onNodeWithTag("nsec-input").assertExists()
    composeRule.onNodeWithTag("import-key-button").assertExists()
    composeRule.onNodeWithTag("create-identity-button").assertExists()
}
```

**After** (`steps/auth/LoginSteps.kt`):
```kotlin
@HiltAndroidTest
class LoginSteps(
    private val scenarioHolder: ActivityScenarioHolder
) : BaseSteps() {

    @Given("the app is freshly installed")
    fun theAppIsFreshlyInstalled() {
        scenarioHolder.launch()
    }

    @When("the app launches")
    fun theAppLaunches() {
        composeRuleHolder.composeRule.waitForIdle()
    }

    @Then("I should see the app title")
    fun iShouldSeeTheAppTitle() {
        onNodeWithTag("app-title").assertExists()
    }

    @Then("I should see the hub URL input")
    fun iShouldSeeTheHubUrlInput() {
        onNodeWithTag("hub-url-input").assertExists()
    }

    // ... etc
}
```

### Crypto Steps (Non-UI)

Crypto tests don't need ComposeRuleHolder — they inject CryptoService directly:

```kotlin
@HiltAndroidTest
class CryptoSteps : BaseSteps() {
    @Inject lateinit var cryptoService: CryptoService

    private var keypairResult: Pair<String, String>? = null

    @When("I generate a keypair")
    fun iGenerateAKeypair() {
        keypairResult = cryptoService.generateKeypair()
    }

    @Then("the nsec should start with {string}")
    fun theNsecShouldStartWith(prefix: String) {
        assertTrue(keypairResult!!.first.startsWith(prefix))
    }
}
```

## Feature File Copying

### Gradle Task (already partially exists)

Update the existing `copyTestVectors` to also copy feature files:

```kotlin
// app/build.gradle.kts
val copyFeatureFiles by tasks.registering(Copy::class) {
    from("${rootProject.projectDir}/../../packages/test-specs/features")
    into("src/androidTest/assets/features")
}

val copyTestVectors by tasks.registering(Copy::class) {
    from("${rootProject.projectDir}/../../packages/crypto/tests/fixtures/test-vectors.json")
    into("src/androidTest/assets")
}

tasks.named("preBuild") {
    dependsOn(copyFeatureFiles, copyTestVectors)
}
```

### .gitignore Addition
```
# Feature files are copied from packages/test-specs at build time
apps/android/app/src/androidTest/assets/features/
```

## Migration Plan

### Phase 1: Infrastructure
1. Add cucumber-android + cucumber-android-hilt to version catalog + build.gradle.kts
2. Create `CucumberHiltRunner.kt` (replaces `HiltTestRunner.kt`)
3. Create `ComposeRuleHolder.kt`, `ActivityScenarioHolder.kt`, `BaseSteps.kt`
4. Create Gradle `copyFeatureFiles` task
5. Verify: `assembleDebugAndroidTest` compiles

### Phase 2: Common Steps
6. Create `NavigationSteps.kt` — shared tab navigation, back navigation
7. Create `AuthSteps.kt` — login, PIN entry, identity setup
8. Create `AssertionSteps.kt` — generic "I should see" steps

### Phase 3: Domain Steps (convert each test class → step definition)
9. Auth: LoginSteps, OnboardingSteps, PinSteps, KeyImportSteps
10. Dashboard: DashboardSteps
11. Notes: NoteSteps
12. Conversations: ConversationSteps
13. Shifts: ShiftSteps
14. Settings: SettingsSteps
15. Admin: AdminSteps
16. Crypto: CryptoSteps

### Phase 4: Cleanup
17. Delete all 25 old test classes from `e2e/`
18. Delete `TestNavigationHelper.kt` + `ComposeTestExtensions.kt` (absorbed into steps)
19. Delete `HiltTestRunner.kt` (replaced by `CucumberHiltRunner.kt`)
20. Update build.gradle.kts `testInstrumentationRunner`

## Verification

```bash
# Compile
cd apps/android && ./gradlew clean assembleDebugAndroidTest

# Lint
cd apps/android && ./gradlew lintDebug

# Run on device (Pixel 6a)
cd apps/android && ./gradlew connectedDebugAndroidTest

# Validate coverage
bun run test-specs:validate --platform android
```

Expected: All 102 scenarios (tagged `@all` or `@android` or `@mobile`) pass.

## Dependencies

- Epic 223 (tags must be applied to feature files first)
