@android @ios @desktop
Feature: Volunteer Profile
  As an admin
  I want to view detailed volunteer profiles
  So that I can see their shifts, activity, and role information

  Background:
    Given I am logged in as an admin
    And I have created a volunteer
    And I navigate to the "Volunteers" page

  Scenario: Navigate to volunteer profile from list
    When I tap a volunteer card
    Then I should see the volunteer detail screen

  Scenario: Profile card shows volunteer information
    When I tap a volunteer card
    Then I should see the volunteer name

  Scenario: Profile card shows join date
    When I tap a volunteer card
    Then I should see the volunteer join date

  Scenario: Recent activity section is displayed
    When I tap a volunteer card
    Then I should see the recent activity card

  Scenario: Navigate back from volunteer profile
    When I tap a volunteer card
    And I tap the back button on the volunteer detail
    Then I should see the "Volunteers" heading
