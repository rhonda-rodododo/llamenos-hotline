Feature: Note Thread Replies
  As a volunteer
  I want to view and post replies on notes
  So that I can collaborate with other volunteers in threaded discussions

  Background:
    Given the app is launched
    And I tap the "Notes" tab

  Scenario: Thread section visible on note detail
    Given I am on the note detail screen
    Then I should see the thread replies section
    And I should see the reply input field

  Scenario: Empty thread shows placeholder
    Given I am on the note detail screen
    And the note has no replies
    Then I should see the no replies message

  Scenario: Reply count displayed in thread header
    Given I am on the note detail screen
    Then I should see the reply count in the thread header

  Scenario: Reply input and send button present
    Given I am on the note detail screen
    Then I should see the reply input field
    And I should see the send reply button

  Scenario: Reply count badge shown on note card
    Given I am on the notes list
    Then notes with replies should show a reply count badge
