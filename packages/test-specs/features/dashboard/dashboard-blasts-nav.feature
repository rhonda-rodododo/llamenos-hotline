@android @desktop @regression
Feature: Dashboard Blasts Navigation
  As an admin
  I want to access blasts from the dashboard
  So that I can quickly send broadcast messages to volunteers

  Background:
    Given I am authenticated and on the dashboard

  Scenario: Dashboard shows blasts card
    Then I should see the blasts card on the dashboard

  Scenario: Navigate to blasts from dashboard
    When I tap the view blasts button
    Then I should see the blasts screen

  Scenario: Navigate back from blasts to dashboard
    When I tap the view blasts button
    And I tap the back button on blasts
    Then I should see the dashboard
