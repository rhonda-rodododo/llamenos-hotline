package org.llamenos.hotline.hub

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import app.cash.turbine.test
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class ActiveHubStateTest {

    @get:Rule val tmpFolder = TemporaryFolder()

    private val testDispatcher = UnconfinedTestDispatcher()
    private val testScope = TestScope(testDispatcher)
    private lateinit var dataStore: DataStore<Preferences>
    private lateinit var state: ActiveHubState

    @Before
    fun setUp() {
        dataStore = PreferenceDataStoreFactory.create(
            scope = testScope,
            produceFile = { tmpFolder.newFile("test_prefs.preferences_pb") }
        )
        state = ActiveHubState(dataStore, testScope)
    }

    @Test
    fun `activeHubId is null initially`() = runTest(testDispatcher) {
        state.activeHubId.test {
            assertNull(awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `setActiveHub persists and emits new value`() = runTest(testDispatcher) {
        state.setActiveHub("hub-uuid-001")
        state.activeHubId.test {
            assertEquals("hub-uuid-001", awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `setActiveHub twice emits latest value`() = runTest(testDispatcher) {
        state.setActiveHub("hub-uuid-001")
        state.setActiveHub("hub-uuid-002")
        state.activeHubId.test {
            assertEquals("hub-uuid-002", awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `clearActiveHub sets value back to null`() = runTest(testDispatcher) {
        state.setActiveHub("hub-uuid-001")
        state.clearActiveHub()
        state.activeHubId.test {
            assertNull(awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }
}
