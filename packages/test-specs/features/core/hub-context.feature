Feature: Hub Context & Multi-Hub UX

  The client sends hub context on all CMS API calls via URL path
  prefixing (/hubs/:hubId/*). Hub switching remounts the page,
  forcing all data to reload for the new hub.

  @desktop @ios @android
  Scenario: Single-hub volunteer sees no hub selector
    Given a volunteer in a single-hub deployment
    When the volunteer views the sidebar
    Then the hub selector should not be visible

  @desktop @ios @android
  Scenario: Multi-hub volunteer sees hub selector
    Given a volunteer assigned to multiple hubs
    When the volunteer views the sidebar
    Then the hub selector should be visible

  @desktop
  Scenario: Hub switch reloads page data
    Given a volunteer assigned to multiple hubs
    And the volunteer is on the cases page
    When the volunteer switches to a different hub
    Then the cases page should reload
