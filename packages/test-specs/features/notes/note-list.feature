@android @ios @smoke
Feature: Notes List
  As a volunteer
  I want to see my encrypted notes
  So that I can review call documentation

  Background:
    Given I am authenticated and on the main screen

  Scenario: Navigate to notes tab
    When I tap the "Notes" tab
    Then I should see the notes screen
    And the create note FAB should be visible

  Scenario: Notes tab shows empty state or list
    When I tap the "Notes" tab
    Then I should see either the notes list, empty state, or loading indicator

  Scenario: Create note FAB navigates to create screen
    When I tap the "Notes" tab
    And I tap the create note FAB
    Then I should see the note creation screen
    And the note text input should be visible
    And the save button should be visible
    And the back button should be visible
