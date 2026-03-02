@android @ios @regression
Feature: Admin Tabs
  As an admin
  I want to switch between admin tabs
  So that I can manage different aspects of the system

  Background:
    Given I am authenticated
    And I have navigated to the admin panel

  Scenario: All four admin tabs are present
    Then I should see the following tabs:
      | tab         |
      | Volunteers  |
      | Ban List    |
      | Audit Log   |
      | Invites     |

  Scenario: Default tab is Volunteers
    Then the "Volunteers" tab should be selected by default
    And volunteers content should be displayed (loading, empty, or list)

  Scenario Outline: Switch to admin tab
    When I tap the "<tab>" tab
    Then <tab_content> content should be displayed (loading, empty, or list)

    Examples:
      | tab        | tab_content  |
      | Ban List   | bans         |
      | Audit Log  | audit        |
      | Invites    | invites      |

  Scenario: Switch between all tabs without crash
    When I tap "Ban List"
    And I tap "Audit Log"
    And I tap "Invites"
    And I tap "Volunteers"
    Then I should be on the Volunteers tab
    And no crashes should occur
