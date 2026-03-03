@android @ios @desktop @regression
Feature: Note Detail View
  As a volunteer
  I want to view the full details of a note
  So that I can review the complete call documentation

  Background:
    Given I am authenticated
    And at least one note exists

  Scenario: Note detail displays decrypted content
    When I navigate to a note's detail view
    Then I should see the full note text
    And I should see the creation date
    And I should see the author pubkey

  Scenario: Note detail back navigation
    When I am on a note detail view
    And I tap the back button
    Then I should return to the notes list

  Scenario: Note detail shows copy button
    When I am on a note detail view
    Then a copy button should be visible in the top bar
