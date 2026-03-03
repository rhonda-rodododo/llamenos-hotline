@android @ios @desktop @smoke
Feature: Shifts Tab
  As a volunteer
  I want to see available shifts and my clock status
  So that I can manage when I receive calls

  Background:
    Given I am authenticated and on the main screen

  Scenario: Navigate to shifts tab
    When I tap the "Shifts" tab
    Then I should see the clock in/out card
    And the clock status text should be displayed

  Scenario: Clock in button visible when off shift
    When I tap the "Shifts" tab
    Then the "Clock In" button should be visible

  Scenario: Shifts show schedule or empty state
    When I tap the "Shifts" tab
    Then I should see either the shifts list, empty state, or loading indicator
