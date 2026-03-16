package org.llamenos.hotline.ui.hubs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.llamenos.hotline.R

/**
 * Screen for creating a new hub.
 *
 * Provides a form with name, description, and phone number fields.
 * On successful creation, navigates back to the hub list.
 *
 * @param viewModel Shared HubManagementViewModel for creating the hub
 * @param onNavigateBack Callback to navigate back on success or cancel
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateHubScreen(
    viewModel: HubManagementViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsState()

    var name by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var phoneNumber by rememberSaveable { mutableStateOf("") }

    // Navigate back on successful creation
    LaunchedEffect(uiState.createSuccess) {
        if (uiState.createSuccess) {
            viewModel.clearCreateSuccess()
            onNavigateBack()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.hubs_create_hub),
                        modifier = Modifier.testTag("create-hub-title"),
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("create-hub-back"),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.common_back),
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
            // Description text
            Text(
                text = stringResource(R.string.hubs_create_hub_description),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("create-hub-description"),
            )

            // Hub name
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(stringResource(R.string.hubs_hub_name)) },
                placeholder = { Text(stringResource(R.string.hubs_hub_name_placeholder)) },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("create-hub-name-field"),
            )

            // Description
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text(stringResource(R.string.hubs_hub_description)) },
                placeholder = { Text(stringResource(R.string.hubs_hub_description_placeholder)) },
                minLines = 3,
                maxLines = 5,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("create-hub-description-field"),
            )

            // Phone number
            OutlinedTextField(
                value = phoneNumber,
                onValueChange = { phoneNumber = it },
                label = { Text(stringResource(R.string.hubs_hub_phone_number)) },
                placeholder = { Text("+1234567890") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("create-hub-phone-field"),
            )

            Text(
                text = stringResource(R.string.hubs_hub_phone_number_help),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            )

            // Error message
            if (uiState.createError != null) {
                Text(
                    text = uiState.createError ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("create-hub-error"),
                )
            }

            Spacer(Modifier.height(8.dp))

            // Submit button
            Button(
                onClick = {
                    viewModel.createHub(
                        name = name.trim(),
                        description = description.trim().takeIf { it.isNotEmpty() },
                        phoneNumber = phoneNumber.trim().takeIf { it.isNotEmpty() },
                    )
                },
                enabled = name.isNotBlank() && !uiState.isCreating,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("create-hub-submit"),
            ) {
                Text(
                    text = if (uiState.isCreating) {
                        stringResource(R.string.common_loading)
                    } else {
                        stringResource(R.string.hubs_create_hub)
                    },
                )
            }
        }
    }
}
