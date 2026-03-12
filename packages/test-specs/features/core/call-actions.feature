@backend
Feature: In-Call Quick Actions
  Volunteers can ban callers and create notes during active calls
  without navigating away from the call screen.

  Background:
    Given the server is reset
    And 2 volunteers are on shift

  @calls @bans
  Scenario: Ban and hang up during active call
    Given volunteer 0 is on an active call with a unique caller
    When volunteer 0 bans and hangs up the call
    Then the response should indicate the caller was banned
    And the call status should be "completed"
    And the caller should be in the ban list

  @calls @bans
  Scenario: Ban and hang up with custom reason
    Given volunteer 0 is on an active call with a unique caller
    When volunteer 0 bans and hangs up with reason "Threatening language"
    Then the response should indicate the caller was banned
    And the ban reason should be "Threatening language"

  @calls @bans
  Scenario: Cannot ban another volunteer's call
    Given volunteer 0 is on an active call with a unique caller
    When volunteer 1 tries to ban and hang up that call
    Then the response status should be 403

  @calls @notes
  Scenario: Create note during active call
    Given volunteer 0 is on an active call with a unique caller
    When volunteer 0 creates a note for the active call
    Then a note should exist linked to that call ID

  @calls @bans
  Scenario: Banned caller cannot call back
    Given volunteer 0 is on an active call with a unique caller
    And volunteer 0 bans and hangs up the call
    When the same caller tries to call again
    Then the call should be rejected
