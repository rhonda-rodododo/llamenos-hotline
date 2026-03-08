import AVFoundation
import SwiftUI

// MARK: - RecordingPlayerView

/// Audio playback component for call recordings. Uses AVPlayer with streaming
/// from the API. Provides play/pause, seek, and progress display.
struct RecordingPlayerView: View {
    let recordingId: String
    @Bindable var viewModel: AdminViewModel
    @State private var playerState = RecordingPlayerState()

    var body: some View {
        VStack(spacing: 16) {
            // Waveform placeholder / status
            recordingHeader

            // Progress bar
            progressSection

            // Time display
            timeDisplay

            // Controls
            controlButtons
        }
        .padding()
        .background(Color.brandCard)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.brandBorder, lineWidth: 1)
        )
        .onAppear {
            setupPlayer()
        }
        .onDisappear {
            teardownPlayer()
        }
        .accessibilityIdentifier("recording-player")
    }

    // MARK: - Header

    private var recordingHeader: some View {
        HStack {
            Image(systemName: "waveform")
                .font(.title2)
                .foregroundStyle(Color.brandPrimary)

            VStack(alignment: .leading, spacing: 2) {
                Text(NSLocalizedString("admin_recording_title", comment: "Call Recording"))
                    .font(.brand(.headline))
                    .foregroundStyle(Color.brandForeground)

                Text(recordingId.count > 16
                    ? "\(recordingId.prefix(8))...\(recordingId.suffix(6))"
                    : recordingId)
                    .font(.brandMono(.caption))
                    .foregroundStyle(Color.brandMutedForeground)
            }

            Spacer()

            if playerState.isLoading {
                ProgressView()
                    .scaleEffect(0.8)
            } else if let error = playerState.error {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .help(error)
            }
        }
    }

    // MARK: - Progress Section

    private var progressSection: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                // Background track
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.brandMuted)
                    .frame(height: 4)

                // Progress fill
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.brandPrimary)
                    .frame(
                        width: max(0, geometry.size.width * playerState.progress),
                        height: 4
                    )

                // Scrubber handle
                Circle()
                    .fill(Color.brandPrimary)
                    .frame(width: 12, height: 12)
                    .offset(x: max(0, geometry.size.width * playerState.progress - 6))
            }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let fraction = max(0, min(1, value.location.x / geometry.size.width))
                        seekToFraction(fraction)
                    }
            )
        }
        .frame(height: 12)
        .accessibilityIdentifier("recording-progress-bar")
    }

    // MARK: - Time Display

    private var timeDisplay: some View {
        HStack {
            Text(formatTime(playerState.currentTime))
                .font(.brandMono(.caption))
                .foregroundStyle(Color.brandMutedForeground)
                .accessibilityIdentifier("recording-current-time")

            Spacer()

            Text(formatTime(playerState.duration))
                .font(.brandMono(.caption))
                .foregroundStyle(Color.brandMutedForeground)
                .accessibilityIdentifier("recording-duration")
        }
    }

    // MARK: - Control Buttons

    private var controlButtons: some View {
        HStack(spacing: 32) {
            // Seek backward 15s
            Button {
                seekRelative(-15)
            } label: {
                Image(systemName: "gobackward.15")
                    .font(.title2)
                    .foregroundStyle(Color.brandForeground)
            }
            .disabled(!playerState.isReady)
            .accessibilityIdentifier("recording-seek-back")
            .accessibilityLabel(NSLocalizedString(
                "admin_recording_seek_back",
                comment: "Skip back 15 seconds"
            ))

            // Play / Pause
            Button {
                togglePlayPause()
            } label: {
                Image(systemName: playerState.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.brandPrimary)
            }
            .disabled(!playerState.isReady)
            .accessibilityIdentifier("recording-play-pause")
            .accessibilityLabel(playerState.isPlaying
                ? NSLocalizedString("admin_recording_pause", comment: "Pause")
                : NSLocalizedString("admin_recording_play", comment: "Play"))

            // Seek forward 15s
            Button {
                seekRelative(15)
            } label: {
                Image(systemName: "goforward.15")
                    .font(.title2)
                    .foregroundStyle(Color.brandForeground)
            }
            .disabled(!playerState.isReady)
            .accessibilityIdentifier("recording-seek-forward")
            .accessibilityLabel(NSLocalizedString(
                "admin_recording_seek_forward",
                comment: "Skip forward 15 seconds"
            ))
        }
    }

    // MARK: - Player Setup

    private func setupPlayer() {
        guard let url = viewModel.recordingStreamURL(recordingId: recordingId) else {
            playerState.error = NSLocalizedString(
                "admin_recording_no_url",
                comment: "No recording URL available"
            )
            return
        }

        playerState.isLoading = true

        let playerItem = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: playerItem)
        playerState.player = player

        // Observe status for readiness
        playerState.statusObserver = playerItem.observe(\.status) { item, _ in
            DispatchQueue.main.async {
                switch item.status {
                case .readyToPlay:
                    playerState.isLoading = false
                    playerState.isReady = true
                    if let duration = player.currentItem?.duration,
                       duration.isNumeric {
                        playerState.duration = CMTimeGetSeconds(duration)
                    }
                case .failed:
                    playerState.isLoading = false
                    playerState.error = item.error?.localizedDescription
                        ?? NSLocalizedString("admin_recording_load_failed", comment: "Failed to load recording")
                default:
                    break
                }
            }
        }

        // Periodic time observer
        let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
        playerState.timeObserverToken = player.addPeriodicTimeObserver(
            forInterval: interval,
            queue: .main
        ) { time in
            let current = CMTimeGetSeconds(time)
            playerState.currentTime = current
            if playerState.duration > 0 {
                playerState.progress = CGFloat(current / playerState.duration)
            }
        }

        // Observe end of playback
        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { _ in
            playerState.isPlaying = false
            playerState.progress = 0
            playerState.currentTime = 0
            player.seek(to: .zero)
        }
    }

    private func teardownPlayer() {
        playerState.player?.pause()
        if let token = playerState.timeObserverToken {
            playerState.player?.removeTimeObserver(token)
        }
        playerState.statusObserver?.invalidate()
        playerState.player = nil
    }

    // MARK: - Playback Controls

    private func togglePlayPause() {
        guard let player = playerState.player else { return }
        if playerState.isPlaying {
            player.pause()
            playerState.isPlaying = false
        } else {
            player.play()
            playerState.isPlaying = true
        }
    }

    private func seekRelative(_ seconds: Double) {
        guard let player = playerState.player else { return }
        let target = max(0, min(playerState.duration, playerState.currentTime + seconds))
        let time = CMTime(seconds: target, preferredTimescale: 600)
        player.seek(to: time)
    }

    private func seekToFraction(_ fraction: CGFloat) {
        guard let player = playerState.player, playerState.duration > 0 else { return }
        let target = Double(fraction) * playerState.duration
        let time = CMTime(seconds: target, preferredTimescale: 600)
        player.seek(to: time)
    }

    // MARK: - Formatting

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - RecordingPlayerState

/// Internal state for the recording player, keeping AVPlayer details out of the view model.
@Observable
final class RecordingPlayerState {
    var player: AVPlayer?
    var isPlaying: Bool = false
    var isLoading: Bool = false
    var isReady: Bool = false
    var currentTime: Double = 0
    var duration: Double = 0
    var progress: CGFloat = 0
    var error: String?
    var timeObserverToken: Any?
    var statusObserver: NSKeyValueObservation?
}
