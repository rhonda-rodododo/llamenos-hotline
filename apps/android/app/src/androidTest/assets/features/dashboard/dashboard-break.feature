@android @ios @desktop @regression
Feature: Dashboard Break Toggle
  As a volunteer on shift
  I want to toggle break mode
  So that I can temporarily pause receiving calls

  Background:
    Given I am authenticated and on the main screen

  Scenario: Break button is visible when on shift
    Given the volunteer is on shift
    Then I should see the break toggle button

  Scenario: Break banner appears when on break
    Given the volunteer is on break
    Then I should see the on-break banner
