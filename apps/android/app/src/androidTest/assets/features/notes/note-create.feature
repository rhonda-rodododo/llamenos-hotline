@android @ios @desktop @smoke
Feature: Note Creation
  As a volunteer on a call
  I want to create encrypted notes
  So that the call is documented securely

  Background:
    Given I am authenticated and on the note creation screen

  Scenario: Note text input accepts text
    When I type "Test note content" in the note text field
    Then the text "Test note content" should be displayed

  Scenario: Back navigation returns to notes list
    When I tap the back button
    Then I should return to the notes list
    And the create note FAB should be visible

  @regression
  Scenario: Note creation with custom fields
    Given custom fields are configured for notes
    When I type "Call note with fields" in the note text field
    Then I should see custom field inputs below the text field
