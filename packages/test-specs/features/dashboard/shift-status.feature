@android @ios @desktop @regression
Feature: Dashboard Shift Actions
  As a volunteer on the dashboard
  I want to quickly clock in/out
  So that I can start receiving calls without navigating to shifts

  Background:
    Given I am authenticated and on the dashboard

  Scenario: Clock in button shows when off shift
    Given I am off shift
    Then the dashboard clock button should say "Clock In"

  Scenario: Tapping clock in attempts to clock in
    Given I am off shift
    When I tap the dashboard clock button
    Then a clock-in request should be sent
    And the button should show a loading state briefly
