@android @ios @desktop @smoke
Feature: Dashboard Display
  As an authenticated volunteer
  I want to see the dashboard
  So that I can see my status at a glance

  Background:
    Given I am authenticated and on the dashboard

  Scenario: Dashboard displays all status cards
    Then I should see the connection status card
    And I should see the shift status card
    And I should see the active calls card
    And I should see the recent notes card
    And I should see the identity card

  Scenario: Dashboard shows npub in identity card
    Then the identity card should display my npub
    And the npub should start with "npub1"

  Scenario: Dashboard shows connection status
    Then the connection card should show a status text
    And the top bar should show a connection dot

  Scenario: Dashboard shows shift status
    Then the shift card should show "Off Shift" or "On Shift"
    And a clock in/out button should be visible

  Scenario: Dashboard shows active call count
    Then the calls card should display a numeric call count
    And the count should be "0" for a fresh session

  Scenario: Dashboard shows recent notes section
    Then the recent notes card should be displayed
    And either recent notes or "no recent notes" message should appear

  @regression
  Scenario: Dashboard lock button is present
    Then the lock button should be visible in the top bar

  @regression
  Scenario: Dashboard logout button is present
    Then the logout button should be visible in the top bar
