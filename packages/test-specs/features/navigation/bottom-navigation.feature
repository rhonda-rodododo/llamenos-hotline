@android @ios @smoke
Feature: Bottom Navigation
  As an authenticated user
  I want to switch between tabs
  So that I can access different features

  Background:
    Given I am authenticated and on the dashboard

  Scenario: All five tabs are visible
    Then I should see the Dashboard tab
    And I should see the Notes tab
    And I should see the Conversations tab
    And I should see the Shifts tab
    And I should see the Settings tab

  Scenario: Tab switching preserves state
    When I tap the "Shifts" tab
    Then I should see the shifts screen
    When I tap the "Notes" tab
    Then I should see the notes screen
    When I tap the "Dashboard" tab
    Then I should see the dashboard
    When I tap the "Settings" tab
    Then I should see the settings screen

  Scenario: Tab switching between conversations and notes
    When I tap the "Conversations" tab
    Then I should see the conversation filters
    When I tap the "Notes" tab
    Then I should see the create note FAB
    When I tap the "Conversations" tab
    Then I should see the conversation filters
