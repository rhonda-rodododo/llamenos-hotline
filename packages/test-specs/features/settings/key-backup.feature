@android @desktop @regression
Feature: Key Backup Settings
  As a user
  I want to see key backup information in settings
  So that I understand how to recover my identity

  Background:
    Given I am authenticated and on the main screen

  Scenario: Key backup section is visible in settings
    When I tap the "Settings" tab
    Then I should see the key backup section

  Scenario: Key backup shows security warning
    When I tap the "Settings" tab
    And I expand the "key backup" section
    Then I should see the key backup warning
