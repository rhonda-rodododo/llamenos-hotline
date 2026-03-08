package org.llamenos.hotline.ui.admin

import android.media.MediaPlayer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.llamenos.hotline.R
import org.llamenos.hotline.api.ApiService

/**
 * Audio playback composable for call recordings.
 *
 * Uses Android [MediaPlayer] for audio playback. Downloads the recording
 * from the API and streams it. Provides play/pause, seek forward/back 15s,
 * progress indicator, and time display.
 *
 * @param recordingId The recording ID to fetch from the API
 * @param apiService The API service for constructing the recording URL
 */
@Composable
fun RecordingPlayer(
    recordingId: String,
    apiService: ApiService,
    modifier: Modifier = Modifier,
) {
    var isPlaying by remember { mutableStateOf(false) }
    var isPrepared by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var currentPosition by remember { mutableIntStateOf(0) }
    var duration by remember { mutableIntStateOf(0) }
    var progress by remember { mutableFloatStateOf(0f) }

    val mediaPlayer = remember { MediaPlayer() }

    // Initialize media player
    DisposableEffect(recordingId) {
        try {
            val baseUrl = apiService.getBaseUrl()
            val url = "$baseUrl/api/recordings/$recordingId/audio"

            mediaPlayer.reset()
            mediaPlayer.setDataSource(url)

            // Add auth headers via request properties
            mediaPlayer.setOnPreparedListener { mp ->
                duration = mp.duration
                isPrepared = true
                isLoading = false
            }

            mediaPlayer.setOnErrorListener { _, what, extra ->
                error = "Playback error (code: $what/$extra)"
                isLoading = false
                isPlaying = false
                true
            }

            mediaPlayer.setOnCompletionListener {
                isPlaying = false
                currentPosition = 0
                progress = 0f
            }

            mediaPlayer.prepareAsync()
        } catch (e: Exception) {
            error = e.message ?: "Failed to initialize player"
            isLoading = false
        }

        onDispose {
            try {
                if (mediaPlayer.isPlaying) {
                    mediaPlayer.stop()
                }
                mediaPlayer.reset()
                mediaPlayer.release()
            } catch (_: Exception) {
                // Ignore errors during cleanup
            }
        }
    }

    // Update progress while playing
    LaunchedEffect(isPlaying) {
        while (isPlaying) {
            try {
                currentPosition = mediaPlayer.currentPosition
                progress = if (duration > 0) {
                    currentPosition.toFloat() / duration.toFloat()
                } else {
                    0f
                }
            } catch (_: Exception) {
                isPlaying = false
            }
            delay(250L)
        }
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag("recording-player"),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(R.string.admin_recording_playback),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )

            Spacer(Modifier.height(12.dp))

            when {
                isLoading -> {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .size(32.dp)
                            .testTag("recording-loading"),
                    )
                }

                error != null -> {
                    Text(
                        text = error ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("recording-error"),
                    )
                }

                isPrepared -> {
                    // Progress bar
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("recording-progress"),
                    )

                    Spacer(Modifier.height(8.dp))

                    // Time display
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            text = formatDuration(currentPosition),
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.testTag("recording-current-time"),
                        )
                        Text(
                            text = formatDuration(duration),
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.testTag("recording-total-time"),
                        )
                    }

                    Spacer(Modifier.height(8.dp))

                    // Controls
                    Row(
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Rewind 15s
                        IconButton(
                            onClick = {
                                val newPos = (mediaPlayer.currentPosition - 15_000).coerceAtLeast(0)
                                mediaPlayer.seekTo(newPos)
                                currentPosition = newPos
                                progress = if (duration > 0) newPos.toFloat() / duration.toFloat() else 0f
                            },
                            modifier = Modifier.testTag("recording-rewind"),
                        ) {
                            Icon(
                                imageVector = Icons.Filled.FastRewind,
                                contentDescription = stringResource(R.string.admin_recording_seek_back),
                            )
                        }

                        Spacer(Modifier.width(8.dp))

                        // Play / Pause
                        IconButton(
                            onClick = {
                                if (isPlaying) {
                                    mediaPlayer.pause()
                                    isPlaying = false
                                } else {
                                    mediaPlayer.start()
                                    isPlaying = true
                                }
                            },
                            modifier = Modifier
                                .size(48.dp)
                                .testTag("recording-play-pause"),
                        ) {
                            Icon(
                                imageVector = if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                                contentDescription = if (isPlaying) {
                                    stringResource(R.string.admin_recording_pause)
                                } else {
                                    stringResource(R.string.admin_recording_play)
                                },
                                modifier = Modifier.size(36.dp),
                            )
                        }

                        Spacer(Modifier.width(8.dp))

                        // Forward 15s
                        IconButton(
                            onClick = {
                                val newPos = (mediaPlayer.currentPosition + 15_000).coerceAtMost(duration)
                                mediaPlayer.seekTo(newPos)
                                currentPosition = newPos
                                progress = if (duration > 0) newPos.toFloat() / duration.toFloat() else 0f
                            },
                            modifier = Modifier.testTag("recording-forward"),
                        ) {
                            Icon(
                                imageVector = Icons.Filled.FastForward,
                                contentDescription = stringResource(R.string.admin_recording_seek_forward),
                            )
                        }

                        Spacer(Modifier.width(8.dp))

                        // Stop
                        IconButton(
                            onClick = {
                                mediaPlayer.pause()
                                mediaPlayer.seekTo(0)
                                isPlaying = false
                                currentPosition = 0
                                progress = 0f
                            },
                            modifier = Modifier.testTag("recording-stop"),
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Stop,
                                contentDescription = stringResource(R.string.admin_recording_stop),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Format milliseconds to mm:ss display string.
 */
private fun formatDuration(millis: Int): String {
    val totalSeconds = millis / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%d:%02d".format(minutes, seconds)
}
