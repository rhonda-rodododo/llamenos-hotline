package org.llamenos.hotline.ui.triage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.llamenos.hotline.R
import org.llamenos.hotline.model.Report
import org.llamenos.hotline.util.DateFormatUtils

/**
 * Triage queue screen showing reports with `allowCaseConversion: true`.
 * Admins review incoming reports and convert them to case records.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TriageScreen(
    viewModel: TriageViewModel,
    onNavigateBack: () -> Unit,
    onNavigateToDetail: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.triage_title),
                        modifier = Modifier.testTag("triage-title"),
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("triage-back"),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.contacts_back),
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
        PullToRefreshBox(
            isRefreshing = uiState.isRefreshing,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Status filter chips
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("triage-filters"),
                ) {
                    items(TriageStatusFilter.entries.toList()) { filter ->
                        FilterChip(
                            selected = uiState.selectedFilter == filter,
                            onClick = { viewModel.setFilter(filter) },
                            label = {
                                Text(
                                    when (filter) {
                                        TriageStatusFilter.ALL -> stringResource(R.string.triage_filter_all)
                                        TriageStatusFilter.PENDING -> stringResource(R.string.triage_filter_pending)
                                        TriageStatusFilter.IN_PROGRESS -> stringResource(R.string.triage_filter_in_progress)
                                        TriageStatusFilter.COMPLETED -> stringResource(R.string.triage_filter_completed)
                                    },
                                )
                            },
                            modifier = Modifier.testTag("triage-filter-${filter.name.lowercase()}"),
                        )
                    }
                }

                when {
                    uiState.isLoading && uiState.reports.isEmpty() -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .testTag("triage-loading"),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    }

                    uiState.reports.isEmpty() && !uiState.isLoading -> {
                        EmptyTriage(modifier = Modifier.fillMaxSize())
                    }

                    else -> {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxSize()
                                .testTag("triage-list"),
                            contentPadding = PaddingValues(
                                horizontal = 16.dp,
                                vertical = 8.dp,
                            ),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(
                                items = uiState.reports,
                                key = { it.id },
                            ) { report ->
                                TriageReportCard(
                                    report = report,
                                    reportTypeLabel = viewModel.reportTypeLabel(report.metadata?.reportId),
                                    onClick = { onNavigateToDetail(report.id) },
                                )
                            }
                        }
                    }
                }

                // Error card
                if (uiState.error != null) {
                    org.llamenos.hotline.ui.components.ErrorCard(
                        error = uiState.error ?: "",
                        onDismiss = { viewModel.dismissError() },
                        onRetry = { viewModel.loadTriageQueue() },
                        testTag = "triage-error",
                    )
                }
            }
        }
    }
}

/**
 * Card for a single triage report.
 */
@Composable
private fun TriageReportCard(
    report: Report,
    reportTypeLabel: String?,
    onClick: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Card(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .testTag("triage-card-${report.id}"),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            // Title
            Text(
                text = report.metadata?.reportTitle ?: stringResource(R.string.triage_untitled),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("triage-report-title"),
            )

            Spacer(Modifier.height(8.dp))

            // Status + type row
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Status chip
                Text(
                    text = report.status.replaceFirstChar { it.uppercase() },
                    style = MaterialTheme.typography.labelSmall,
                    color = when (report.status) {
                        "waiting" -> MaterialTheme.colorScheme.tertiary
                        "active" -> MaterialTheme.colorScheme.primary
                        "closed" -> MaterialTheme.colorScheme.outline
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    modifier = Modifier.testTag("triage-report-status"),
                )

                // Report type
                if (reportTypeLabel != null) {
                    Text(
                        text = reportTypeLabel,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }

                // Category (legacy)
                val category = report.metadata?.reportCategory
                if (reportTypeLabel == null && category != null) {
                    Text(
                        text = category,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }

            Spacer(Modifier.height(4.dp))

            // Date
            Text(
                text = DateFormatUtils.formatTimestamp(report.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}

/**
 * Empty state for the triage queue.
 */
@Composable
private fun EmptyTriage(
    modifier: Modifier = Modifier,
) {
    org.llamenos.hotline.ui.components.EmptyState(
        icon = Icons.Filled.Inbox,
        title = stringResource(R.string.triage_empty_title),
        subtitle = stringResource(R.string.triage_empty_message),
        testTag = "triage-empty",
        modifier = modifier,
    )
}
