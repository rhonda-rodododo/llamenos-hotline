@android @ios @desktop @regression
Feature: Advanced Settings
  As a volunteer
  I want to configure advanced settings
  So that I can customize auto-lock, logging, and cache behavior

  Background:
    Given I am authenticated and on the main screen
    And I am on the settings screen
    And I expand the advanced settings section

  Scenario: Advanced settings section shows auto-lock options
    Then I should see the auto-lock timeout options

  Scenario: Advanced settings section shows debug logging toggle
    Then I should see the debug logging toggle

  Scenario: Advanced settings section shows clear cache button
    Then I should see the clear cache button

  Scenario: Clear cache shows confirmation dialog
    When I tap the clear cache button
    Then I should see the clear cache confirmation dialog
