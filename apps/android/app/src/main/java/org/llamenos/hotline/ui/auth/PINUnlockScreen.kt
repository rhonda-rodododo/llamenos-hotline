package org.llamenos.hotline.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.llamenos.hotline.R
import org.llamenos.hotline.ui.components.LoadingOverlay
import org.llamenos.hotline.ui.components.PINPad

/**
 * PIN unlock screen for returning users with stored keys.
 *
 * Accepts the user's PIN and attempts to decrypt the stored nsec.
 * Shows biometric option if configured.
 * Shows error on incorrect PIN and clears the entry.
 */
@Composable
fun PINUnlockScreen(
    viewModel: AuthViewModel,
    onAuthenticated: () -> Unit,
    onResetIdentity: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsState()
    var localPin by remember { mutableStateOf("") }

    // Navigate to dashboard when authenticated
    LaunchedEffect(uiState.isAuthenticated) {
        if (uiState.isAuthenticated) {
            onAuthenticated()
        }
    }

    // Reset local pin on error
    LaunchedEffect(uiState.error) {
        if (uiState.error != null) {
            localPin = ""
        }
    }

    Scaffold(modifier = modifier) { paddingValues ->
        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    text = stringResource(R.string.unlock_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.testTag("unlock-title"),
                )

                Spacer(Modifier.height(8.dp))

                Text(
                    text = stringResource(R.string.unlock_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )

                Spacer(Modifier.height(48.dp))

                PINPad(
                    pin = localPin,
                    maxLength = 4,
                    onPinChange = { newPin ->
                        localPin = newPin
                        viewModel.updatePin(newPin)
                    },
                    onComplete = { completedPin ->
                        viewModel.unlockWithPin(completedPin)
                    },
                    errorMessage = uiState.error,
                )

                Spacer(Modifier.height(32.dp))

                // Use biometric button (when available)
                OutlinedButton(
                    onClick = {
                        // Biometric authentication will be implemented when
                        // the biometric prompt integration is added.
                        // For now, this button serves as a placeholder for
                        // the UI layout.
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("biometric-unlock"),
                ) {
                    Text(stringResource(R.string.use_biometric))
                }

                Spacer(Modifier.height(16.dp))

                // Reset identity link
                OutlinedButton(
                    onClick = {
                        viewModel.resetAuthState()
                        onResetIdentity()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("reset-identity"),
                ) {
                    Text(
                        text = stringResource(R.string.reset_identity),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            LoadingOverlay(
                isLoading = uiState.isLoading,
                message = stringResource(R.string.decrypting_keys),
            )
        }
    }
}
