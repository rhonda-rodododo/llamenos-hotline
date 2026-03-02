@android @ios @desktop @regression
Feature: Transcription Preferences
  As a volunteer
  I want to control my transcription preferences
  So that I can opt out of call transcription if allowed

  Background:
    Given I am authenticated and on the main screen
    And I am on the settings screen
    And I expand the transcription section

  Scenario: Transcription section is visible in settings
    Then I should see the transcription settings section

  Scenario: Transcription toggle is visible when opt-out allowed
    Then I should see the transcription toggle

  Scenario: Managed message shows when opt-out not allowed
    Given transcription opt-out is not allowed
    Then I should see the transcription managed message
