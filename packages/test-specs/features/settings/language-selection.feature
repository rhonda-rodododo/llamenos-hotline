@android @ios @desktop
Feature: Language Selection
  As a volunteer
  I want to select my app language and spoken languages
  So that I can use the app in my preferred language and receive calls in languages I speak

  Background:
    Given the app is launched
    And I tap the "Settings" tab

  Scenario: Language section visible in settings
    When I expand the language section
    Then I should see the language options

  Scenario: Language chips display all supported languages
    When I expand the language section
    Then I should see language chips for all supported locales

  Scenario: Select a language
    When I expand the language section
    And I tap a language chip
    Then the language chip should be selected

  Scenario: Spoken languages section visible in profile
    When I expand the profile section
    Then I should see the spoken languages chips

  Scenario: Toggle spoken language selection
    When I expand the profile section
    And I tap a spoken language chip
    Then the spoken language chip should be selected
