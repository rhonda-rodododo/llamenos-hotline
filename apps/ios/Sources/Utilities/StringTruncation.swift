import Foundation

extension String {
    func truncatedNpub() -> String {
        truncatedHash(12, suffixLen: 6)
    }

    func truncatedPubkey() -> String {
        truncatedHash(8, suffixLen: 6)
    }

    func truncatedHash(_ prefixLen: Int = 8, suffixLen: Int = 6) -> String {
        guard count > prefixLen + suffixLen + 3 else { return self }
        let pre = prefix(prefixLen)
        let suf = suffix(suffixLen)
        return "\(pre)...\(suf)"
    }
}
