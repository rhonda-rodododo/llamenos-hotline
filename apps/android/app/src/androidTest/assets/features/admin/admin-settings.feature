@android @ios @desktop @regression
Feature: Admin Settings
  As an admin
  I want to manage hub-level settings like transcription
  So that I can configure the organization's features

  Background:
    Given I am logged in as an admin
    And I navigate to the admin settings tab

  Scenario: Admin settings tab shows transcription card
    Then I should see the transcription settings card

  Scenario: Transcription toggle controls global transcription
    Then I should see the transcription enabled toggle
    And I should see the transcription opt-out toggle

  Scenario: Toggling transcription updates the setting
    When I toggle transcription on
    Then transcription should be enabled
