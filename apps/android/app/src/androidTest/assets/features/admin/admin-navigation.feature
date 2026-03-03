@android @ios @desktop @smoke
Feature: Admin Panel Navigation
  As an admin
  I want to access the admin panel
  So that I can manage volunteers, bans, audit logs, and invites

  Background:
    Given I am authenticated
    And I am on the settings screen

  Scenario: Navigate to admin panel
    When I scroll to and tap the admin card
    Then I should see the admin screen
    And the admin title should be displayed
    And the admin tabs should be visible

  Scenario: Admin back navigation returns to settings
    When I navigate to the admin panel
    And I tap the back button
    Then I should return to the settings screen
    And the settings identity card should be visible
