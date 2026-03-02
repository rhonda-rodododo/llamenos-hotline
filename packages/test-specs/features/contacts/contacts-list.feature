@android @desktop @regression
Feature: Contacts List
  As an admin
  I want to view a list of contacts
  So that I can see aggregated interaction history for each caller

  Background:
    Given I am authenticated and on the dashboard

  Scenario: Navigate to contacts from dashboard
    When I tap the view contacts button
    Then I should see the contacts screen
    And I should see the contacts title

  Scenario: Contacts screen shows empty state
    When I tap the view contacts button
    Then I should see the contacts empty state

  Scenario: Navigate back from contacts
    When I tap the view contacts button
    And I tap the back button on contacts
    Then I should see the dashboard
