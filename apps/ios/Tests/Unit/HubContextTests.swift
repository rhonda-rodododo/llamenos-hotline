import Foundation
import Testing
@testable import Llamenos

@MainActor
struct HubContextTests {

    @Test func initialActiveHubIdIsNilWhenNothingPersisted() {
        UserDefaults.standard.removeObject(forKey: "activeHubId")
        let ctx = HubContext()
        #expect(ctx.activeHubId == nil)
    }

    @Test func initialActiveHubIdRestoresFromUserDefaults() {
        UserDefaults.standard.set("hub-abc-123", forKey: "activeHubId")
        let ctx = HubContext()
        #expect(ctx.activeHubId == "hub-abc-123")
        UserDefaults.standard.removeObject(forKey: "activeHubId")
    }

    @Test func setActiveHubUpdatesPropertyAndPersists() {
        UserDefaults.standard.removeObject(forKey: "activeHubId")
        let ctx = HubContext()
        ctx.setActiveHub("hub-xyz-999")
        #expect(ctx.activeHubId == "hub-xyz-999")
        #expect(UserDefaults.standard.string(forKey: "activeHubId") == "hub-xyz-999")
        UserDefaults.standard.removeObject(forKey: "activeHubId")
    }

    @Test func clearActiveHubSetsNilAndRemovesFromUserDefaults() {
        UserDefaults.standard.set("hub-abc-123", forKey: "activeHubId")
        let ctx = HubContext()
        ctx.clearActiveHub()
        #expect(ctx.activeHubId == nil)
        #expect(UserDefaults.standard.string(forKey: "activeHubId") == nil)
    }
}
