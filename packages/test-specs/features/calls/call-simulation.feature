@android @desktop @e2e @simulation
Feature: Call and Message Simulation
  As an E2E test author
  I want to simulate incoming calls and messages
  So that I can test call flows without a real telephony provider

  # These scenarios exercise the test simulation endpoints in dev.ts.
  # They require a running backend with ENVIRONMENT=development and
  # DEV_RESET_SECRET / E2E_TEST_SECRET configured.

  # ─── Incoming Call Lifecycle ──────────────────────────────────────

  Scenario: Simulate an incoming call
    Given an incoming call from "+15551234567"
    Then the call status should be "ringing"
    And a call ID should be returned

  Scenario: Simulate answering a call
    Given an incoming call from "+15551234567"
    When the volunteer answers the call
    Then the call status should be "in-progress"

  Scenario: Simulate ending a call
    Given an incoming call from "+15551234567"
    When the volunteer answers the call
    And the call is ended
    Then the call status should be "completed"

  Scenario: Simulate a call going to voicemail
    Given an incoming call from "+15559876543"
    When the call goes to voicemail
    Then the call status should be "unanswered"

  Scenario: Simulate an incoming call with language preference
    Given an incoming call from "+15551234567" in "es"
    Then the call status should be "ringing"
    And a call ID should be returned

  Scenario: Simulate an incoming call for a specific hub
    Given an incoming call from "+15551234567" for hub "test-hub-1"
    Then the call status should be "ringing"
    And a call ID should be returned

  Scenario: Simulate answering with a specific volunteer pubkey
    Given an incoming call from "+15551234567"
    When the volunteer with pubkey "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" answers the call
    Then the call status should be "in-progress"

  # ─── Incoming Message Lifecycle ───────────────────────────────────

  Scenario: Simulate an incoming SMS message
    Given an incoming SMS from "+15551112222" with body "I need help"
    Then a conversation ID should be returned
    And a message ID should be returned
    And the simulation should succeed

  Scenario: Simulate an incoming WhatsApp message
    Given an incoming WhatsApp message from "+15553334444" with body "Necesito ayuda"
    Then a conversation ID should be returned
    And a message ID should be returned
    And the simulation should succeed

  Scenario: Simulate an incoming message with explicit channel
    Given an incoming "sms" message from "+15555556666" with body "Please call me back"
    Then a conversation ID should be returned
    And a message ID should be returned

  # ─── Full Call Flow ───────────────────────────────────────────────

  Scenario: Complete call lifecycle - ring, answer, end
    Given an incoming call from "+15557778888"
    Then the call status should be "ringing"
    When the volunteer answers the call
    Then the call status should be "in-progress"
    When the call is ended
    Then the call status should be "completed"
