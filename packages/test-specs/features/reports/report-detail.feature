@android @desktop @regression
Feature: Report Detail
  As a volunteer or admin
  I want to view report details
  So that I can understand the full context of an incident report

  Background:
    Given I am authenticated and on the dashboard

  Scenario: Report detail screen has title
    When I tap the view reports button
    And I tap the first report card
    Then I should see the report detail screen

  Scenario: Report detail shows metadata card
    When I tap the view reports button
    And I tap the first report card
    Then I should see the report metadata card

  Scenario: Report detail shows status badge
    When I tap the view reports button
    And I tap the first report card
    Then I should see the report status badge

  Scenario: Navigate back from report detail
    When I tap the view reports button
    And I tap the first report card
    Then I should see the report detail screen
    When I tap the back button on report detail
    Then I should see the reports screen
