@android @ios @desktop
Feature: Conversations (Desktop)
  As a volunteer or admin
  I want to manage messaging conversations
  So that I can respond to text-based contacts

  Background:
    Given I am logged in as an admin

  Scenario: View conversation thread
    Given a conversation exists
    When I navigate to the "Conversations" page
    And I click on a conversation
    Then I should see the conversation thread
    And I should see message timestamps

  Scenario: Send a message in conversation
    Given I have an open conversation
    When I type a message in the reply field
    And I click "Send"
    Then the message should appear in the thread

  Scenario: Conversation shows channel badge
    Given conversations from different channels exist
    When I navigate to the "Conversations" page
    Then each conversation should show its channel badge

  Scenario: Assign conversation to volunteer
    Given a conversation exists
    When I assign the conversation to a volunteer
    Then the conversation should show the assigned volunteer

  Scenario: Close a conversation
    Given an open conversation exists
    When I close the conversation
    Then the conversation status should change to "Closed"

  Scenario: Reopen a closed conversation
    Given a closed conversation exists
    When I reopen the conversation
    Then the conversation status should change to "Open"

  Scenario: Conversation search
    Given conversations exist
    When I search for a phone number
    Then matching conversations should be displayed

  Scenario: Messaging admin settings section displays
    Given I am on the admin settings page
    Then I should see the messaging configuration section

  Scenario: Configure SMS channel settings
    Given I am on the messaging settings
    When I configure SMS channel with Twilio credentials
    Then the SMS channel should be enabled

  Scenario: Configure WhatsApp channel settings
    Given I am on the messaging settings
    When I configure WhatsApp channel
    Then the WhatsApp channel should be enabled

  Scenario: Send outbound message in conversation
    Given I have an active conversation
    When I type a message and click send
    Then the message should appear in the thread

  Scenario: Message delivery status updates
    Given I sent a message in a conversation
    Then I should see the delivery status indicator

  Scenario: Close and reopen a conversation
    Given I have an active conversation
    When I close the conversation
    Then the conversation status should be "closed"
    When I reopen the conversation
    Then the conversation status should be "active"

  Scenario: Conversation assignment to volunteer
    Given I have an unassigned conversation
    When I assign it to a volunteer
    Then the volunteer name should appear on the conversation

  Scenario: Auto-assign balances load across volunteers
    Given multiple volunteers are available
    When a new conversation arrives
    Then it should be assigned to the volunteer with lowest load

  Scenario: Filter conversations by channel type
    Given conversations exist across SMS and WhatsApp
    When I filter by SMS channel
    Then I should only see SMS conversations
