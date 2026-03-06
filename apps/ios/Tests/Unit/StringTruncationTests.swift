import XCTest
@testable import Llamenos

final class StringTruncationTests: XCTestCase {

    func testTruncatedNpubShortString() {
        let short = "npub1abc"
        XCTAssertEqual(short.truncatedNpub(), "npub1abc")
    }

    func testTruncatedNpubLongString() {
        let long = "npub1qqqsyqcyq5rqwzqfhg9scnmcesgvse3s43jy5wdxkfhmyzxhldqqu69m0z"
        XCTAssertEqual(long.truncatedNpub(), "npub1qqqsyqc...u69m0z")
    }

    func testTruncatedNpubEmptyString() {
        XCTAssertEqual("".truncatedNpub(), "")
    }

    func testTruncatedPubkeyLongString() {
        let long = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
        XCTAssertEqual(long.truncatedPubkey(), "abcdef12...567890")
    }

    func testTruncatedHashCustomLengths() {
        let hash = "abcdef1234567890"
        XCTAssertEqual(hash.truncatedHash(4, suffixLen: 3), "abcd...890")
    }

    func testTruncatedHashExactLength() {
        // 8 chars: prefix 4 + suffix 3 + "..." = needs > 10 to truncate
        let hash = "abcdefgh"
        XCTAssertEqual(hash.truncatedHash(4, suffixLen: 3), "abcdefgh")
    }
}
