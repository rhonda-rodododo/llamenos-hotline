@android @ios @desktop @regression
Feature: Help & Reference Screen
  As a user
  I want to access help, FAQ, and security information
  So that I can understand how to use the app safely

  Scenario: Help screen displays security card
    Given I am on the help screen
    Then I should see the security overview card
    And it should show encryption status for notes, reports, auth, and sessions

  Scenario: Help screen displays volunteer guide
    Given I am on the help screen
    Then I should see the volunteer guide section
    And the volunteer guide should be expandable

  Scenario: Help screen displays admin guide
    Given I am on the help screen
    Then I should see the admin guide section
    And the admin guide should be expandable

  Scenario: Help screen displays FAQ sections
    Given I am on the help screen
    Then I should see the FAQ title
    And I should see FAQ sections for getting started, calls, notes, and admin

  Scenario: FAQ sections are expandable
    Given I am on the help screen
    When I expand the "Getting Started" FAQ section
    Then I should see FAQ questions and answers
