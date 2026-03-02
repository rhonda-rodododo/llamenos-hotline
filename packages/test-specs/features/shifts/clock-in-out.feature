@android @ios @regression @requires-network
Feature: Clock In/Out
  As a volunteer
  I want to clock in and out
  So that the system knows when I'm available for calls

  Background:
    Given I am authenticated and on the shifts screen

  Scenario: Clock in changes status to on-shift
    Given I am off shift
    When I tap "Clock In"
    Then the clock status should update
    And the button should change to "Clock Out"
    And the shift timer should appear

  Scenario: Clock out changes status to off-shift
    Given I am on shift
    When I tap "Clock Out"
    Then the clock status should show "Off Shift"
    And the button should change to "Clock In"
