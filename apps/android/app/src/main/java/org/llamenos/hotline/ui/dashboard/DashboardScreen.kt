package org.llamenos.hotline.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.llamenos.hotline.R
import org.llamenos.hotline.api.WebSocketService

/**
 * Dashboard screen showing shift status, connection state, and active calls.
 *
 * This is the main screen after authentication. Full features (call handling,
 * note-taking, shift management) will be implemented in Epic 208.
 *
 * @param viewModel Hilt-injected ViewModel for dashboard state
 * @param onLock Callback to lock the app (clears key from memory, navigates to PIN unlock)
 * @param onLogout Callback to fully logout (clears stored keys, navigates to login)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel,
    onLock: () -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.app_name),
                        modifier = Modifier.testTag("dashboard-title"),
                    )
                },
                actions = {
                    // Lock button -- clears key from memory, keeps stored keys
                    IconButton(
                        onClick = onLock,
                        modifier = Modifier.testTag("lock-button"),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Lock,
                            contentDescription = stringResource(R.string.lock_app),
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                    // Logout button -- clears all data
                    IconButton(
                        onClick = onLogout,
                        modifier = Modifier.testTag("logout-button"),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ExitToApp,
                            contentDescription = stringResource(R.string.logout),
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
            )
        },
        modifier = modifier,
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Connection status card
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("connection-card"),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val (statusColor, statusText) = when (uiState.connectionState) {
                        WebSocketService.ConnectionState.CONNECTED ->
                            MaterialTheme.colorScheme.primary to stringResource(R.string.status_connected)

                        WebSocketService.ConnectionState.CONNECTING ->
                            MaterialTheme.colorScheme.tertiary to stringResource(R.string.status_connecting)

                        WebSocketService.ConnectionState.RECONNECTING ->
                            MaterialTheme.colorScheme.tertiary to stringResource(R.string.status_reconnecting)

                        WebSocketService.ConnectionState.DISCONNECTED ->
                            MaterialTheme.colorScheme.error to stringResource(R.string.status_disconnected)
                    }

                    Icon(
                        imageVector = Icons.Filled.Circle,
                        contentDescription = null,
                        tint = statusColor,
                        modifier = Modifier.size(12.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = statusText,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.testTag("connection-status"),
                    )
                }
            }

            // Shift status card
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("shift-card"),
                colors = CardDefaults.cardColors(
                    containerColor = if (uiState.isOnShift) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
                ),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                ) {
                    Text(
                        text = stringResource(R.string.shift_status),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = if (uiState.isOnShift) {
                            stringResource(R.string.on_shift)
                        } else {
                            stringResource(R.string.off_shift)
                        },
                        style = MaterialTheme.typography.bodyLarge,
                        color = if (uiState.isOnShift) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.testTag("shift-status-text"),
                    )
                }
            }

            // Active calls card
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("calls-card"),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Phone,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(
                            text = stringResource(R.string.active_calls),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = uiState.activeCallCount.toString(),
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.testTag("active-call-count"),
                        )
                    }
                }
            }

            // Identity info
            if (uiState.npub.isNotEmpty()) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("identity-card"),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                    ) {
                        Text(
                            text = stringResource(R.string.your_identity),
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = uiState.npub,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.testTag("dashboard-npub"),
                        )
                    }
                }
            }
        }
    }
}
