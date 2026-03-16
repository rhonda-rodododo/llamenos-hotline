import SwiftUI

extension Color {
    // Semantic tokens (adaptive light/dark via asset catalog)
    static let brandBackground = Color("Background")
    static let brandForeground = Color("Foreground")
    static let brandCard = Color("Card")
    static let brandCardForeground = Color("CardForeground")
    static let brandPrimary = Color("BrandPrimary")
    static let brandPrimaryForeground = Color("PrimaryForeground")
    static let brandSecondary = Color("Secondary")
    static let brandSecondaryForeground = Color("SecondaryForeground")
    static let brandMuted = Color("Muted")
    static let brandMutedForeground = Color("MutedForeground")
    static let brandAccent = Color("BrandAccent")
    static let brandAccentForeground = Color("AccentForeground")
    static let brandDestructive = Color("Destructive")
    static let brandDestructiveForeground = Color("DestructiveForeground")
    static let brandBorder = Color("Border")
    static let brandInput = Color("InputBorder")
    static let brandRing = Color("BrandPrimary")

    // Semantic convenience — status colors
    static let statusActive = Color.green
    static let statusWarning = Color("BrandAccent")
    static let statusDanger = Color("Destructive")
    static let statusInfo = Color("BrandPrimary")

    // Legacy direct-value colors (used in tests, GeneratedAvatar)
    static let brandTeal = Color(red: 0x51 / 255.0, green: 0xAF / 255.0, blue: 0xAE / 255.0)
    static let brandCyan = Color(red: 0x5B / 255.0, green: 0xC5 / 255.0, blue: 0xC5 / 255.0)
    static let brandDarkTeal = Color(red: 0x2D / 255.0, green: 0x9B / 255.0, blue: 0x9B / 255.0)
    static let brandNavy = Color(red: 0x02 / 255.0, green: 0x0A / 255.0, blue: 0x12 / 255.0)

    /// Initialize a Color from a hex string (e.g., "#FF5733" or "FF5733").
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: Double
        switch hex.count {
        case 6:
            r = Double((int >> 16) & 0xFF) / 255
            g = Double((int >> 8) & 0xFF) / 255
            b = Double(int & 0xFF) / 255
        default:
            r = 0.42; g = 0.44; b = 0.50
        }
        self.init(red: r, green: g, blue: b)
    }
}
