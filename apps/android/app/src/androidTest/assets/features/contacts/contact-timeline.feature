@android @desktop @regression
Feature: Contact Timeline
  As an admin
  I want to view a timeline of interactions for a specific contact
  So that I can see their full history of calls, conversations, notes, and reports

  Background:
    Given I am authenticated and on the dashboard

  Scenario: Navigate to contact timeline from contacts list
    When I tap the view contacts button
    And I tap a contact card
    Then I should see the timeline screen

  Scenario: Timeline shows contact identifier
    When I tap the view contacts button
    And I tap a contact card
    Then I should see the timeline contact identifier

  Scenario: Timeline shows events or empty state
    When I tap the view contacts button
    And I tap a contact card
    Then I should see timeline events or the empty state

  Scenario: Navigate back from timeline to contacts
    When I tap the view contacts button
    And I tap a contact card
    And I tap the back button on timeline
    Then I should see the contacts screen
