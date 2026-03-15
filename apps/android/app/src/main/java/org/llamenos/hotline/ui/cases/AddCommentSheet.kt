package org.llamenos.hotline.ui.cases

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Bottom sheet for adding an encrypted comment to a case timeline.
 *
 * The comment text is passed to the ViewModel, which encrypts it
 * with E2EE (per-message forward secrecy) before posting to the API.
 *
 * @param onSubmit Called with the plaintext comment when the user submits
 * @param onDismiss Called when the sheet is dismissed
 * @param isSubmitting Whether a comment submission is in progress
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddCommentSheet(
    onSubmit: (String) -> Unit,
    onDismiss: () -> Unit,
    isSubmitting: Boolean = false,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var comment by remember { mutableStateOf("") }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            // Header
            Text(
                text = "Add Comment",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.testTag("comment-sheet-title"),
            )

            Spacer(Modifier.height(16.dp))

            // Comment input
            OutlinedTextField(
                value = comment,
                onValueChange = { comment = it },
                label = { Text("Comment") },
                placeholder = { Text("Write a comment...") },
                minLines = 3,
                maxLines = 8,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("comment-input"),
            )

            Spacer(Modifier.height(16.dp))

            // Submit button
            Button(
                onClick = {
                    if (comment.isNotBlank()) {
                        onSubmit(comment.trim())
                    }
                },
                enabled = comment.isNotBlank() && !isSubmitting,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("comment-submit"),
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Text("Submit")
            }

            Spacer(Modifier.height(8.dp))

            // E2EE indicator
            Text(
                text = "Your comment will be end-to-end encrypted",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                modifier = Modifier.testTag("comment-e2ee-notice"),
            )
        }
    }
}
