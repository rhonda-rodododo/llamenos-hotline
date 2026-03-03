@android @ios @desktop @regression
Feature: Conversation Assignment
  As an admin
  I want to assign conversations to volunteers
  So that the right person handles each contact

  Background:
    Given I am authenticated and on the main screen

  Scenario: Assign button is visible on conversation detail
    Given I navigate to the conversations tab
    And I open a conversation
    Then I should see the assign conversation button

  Scenario: Assign dialog opens with volunteer list
    Given I navigate to the conversations tab
    And I open a conversation
    When I tap the assign conversation button
    Then I should see the assign dialog
