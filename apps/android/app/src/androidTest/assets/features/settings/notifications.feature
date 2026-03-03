@android @desktop @regression
Feature: Notification Preferences
  As a user
  I want to configure my notification preferences
  So that I only receive alerts I care about

  Background:
    Given I am authenticated and on the main screen

  Scenario: Notifications section is visible in settings
    When I tap the "Settings" tab
    Then I should see the notifications section

  Scenario: Notification toggles are displayed
    When I tap the "Settings" tab
    And I expand the "notifications" section
    Then I should see the notification toggles
