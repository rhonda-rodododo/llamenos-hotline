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

  Scenario: Contacts shows list or empty state
    When I tap the view contacts button
    Then I should see the contacts content or empty state

  Scenario: Navigate back from contacts
    When I tap the view contacts button
    And I tap the back button on contacts
    Then I should see the dashboard

  Scenario: Contacts has pull to refresh
    When I tap the view contacts button
    Then the contacts screen should support pull to refresh

  Scenario: Navigate back from contacts returns to dashboard
    When I tap the view contacts button
    Then I should see the contacts title
    When I tap the back button on contacts
    Then I should see the dashboard

  Scenario: Contacts screen accessible from dashboard card
    Then I should see the contacts card on the dashboard
    When I tap the view contacts button
    Then I should see the contacts screen

  Scenario: Contacts has search input
    When I tap the view contacts button
    Then I should see the contacts search field

  Scenario: Contacts list displays contact identifiers
    When I tap the view contacts button
    Then I should see contacts with identifiers or the empty state
