@android @ios @desktop @smoke
Feature: Conversations List
  As a volunteer
  I want to see conversations from callers
  So that I can respond to messages (SMS, WhatsApp, Signal)

  Background:
    Given I am authenticated and on the main screen

  Scenario: Navigate to conversations tab
    When I tap the "Conversations" tab
    Then I should see the conversations screen
    And the filter chips should be visible

  Scenario: Filter chips are displayed
    When I tap the "Conversations" tab
    Then I should see the "Active" filter chip
    And I should see the "Closed" filter chip
    And I should see the "All" filter chip

  Scenario: Default filter is Active
    When I tap the "Conversations" tab
    Then the "Active" filter should be selected
