@desktop @android @regression
Feature: Contacts
  As an admin
  I want to view contacts and their interaction timelines
  So that I can see aggregated history for each caller

  # ── Contacts List ─────────────────────────────────────────────────

  Scenario: Navigate to contacts from dashboard
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    Then I should see the contacts screen
    And I should see the contacts title

  Scenario: Contacts shows list or empty state
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    Then I should see the contacts content or empty state

  Scenario: Navigate back from contacts
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    And I tap the back button on contacts
    Then I should see the dashboard

  Scenario: Contacts has pull to refresh
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    Then the contacts screen should support pull to refresh

  Scenario: Navigate back from contacts returns to dashboard
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    Then I should see the contacts title
    When I tap the back button on contacts
    Then I should see the dashboard

  Scenario: Contacts screen accessible from dashboard card
    Given I am authenticated and on the dashboard
    Then I should see the contacts card on the dashboard
    When I tap the view contacts button
    Then I should see the contacts screen

  Scenario: Contacts has search input
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    Then I should see the contacts search field

  Scenario: Contacts list displays contact identifiers
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    Then I should see contacts with identifiers or the empty state

  # ── Contact Timeline ──────────────────────────────────────────────

  Scenario: Navigate to contact timeline from contacts list
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    And I tap a contact card
    Then I should see the timeline screen

  Scenario: Timeline shows contact identifier
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    And I tap a contact card
    Then I should see the timeline contact identifier

  Scenario: Timeline shows events or empty state
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    And I tap a contact card
    Then I should see timeline events or the empty state

  Scenario: Navigate back from timeline to contacts
    Given I am authenticated and on the dashboard
    When I tap the view contacts button
    And I tap a contact card
    And I tap the back button on timeline
    Then I should see the contacts screen
