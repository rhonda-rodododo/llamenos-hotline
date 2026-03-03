@android @ios @desktop @regression
Feature: Dashboard Help Navigation
  As a user
  I want to access help from the dashboard
  So that I can quickly find reference material

  Background:
    Given I am on the dashboard

  Scenario: Dashboard shows help card
    Then I should see the help card

  Scenario: Tapping help card navigates to help screen
    When I tap the help card
    Then I should see the help screen
