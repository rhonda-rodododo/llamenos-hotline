@android @ios @regression
Feature: Conversation Filters
  As a volunteer
  I want to filter conversations by status
  So that I can focus on active or review closed ones

  Background:
    Given I am authenticated and on the conversations screen

  Scenario: Switch to Closed filter
    When I tap the "Closed" filter chip
    Then the "Closed" filter should be selected
    And the conversation list should update

  Scenario: Switch to All filter
    When I tap the "All" filter chip
    Then the "All" filter should be selected

  Scenario: Switch back to Active filter
    Given I have selected the "Closed" filter
    When I tap the "Active" filter chip
    Then the "Active" filter should be selected

  Scenario: Conversations show empty or list state
    Then I should see either the conversations list, empty state, or loading indicator
