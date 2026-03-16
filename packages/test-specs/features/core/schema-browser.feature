Feature: Schema Browser
  Users can browse the entity type schema defined by the applied
  CMS template. The schema browser shows entity types, their fields,
  and available statuses. On mobile, the browser is read-only.

  Background:
    Given I am logged in as an admin
    And case management is enabled
    And the "jail-support" template has been applied

  @desktop @ios @android
  Scenario: Schema browser lists entity types
    When I open the schema browser
    Then I should see a list of entity types from the template
    And I should see the "Arrest Case" entity type

  @desktop @ios @android
  Scenario: Entity type detail shows fields
    When I open the schema browser
    And I select the "Arrest Case" entity type
    Then I should see the fields defined for "Arrest Case"
    And each field should show its type and label

  @desktop @ios @android
  Scenario: Entity type detail shows statuses
    When I open the schema browser
    And I select the "Arrest Case" entity type
    Then I should see the statuses defined for "Arrest Case"
    And the initial status should be marked

  @ios @android
  Scenario: Schema browser is read-only on mobile
    When I open the schema browser
    And I select the "Arrest Case" entity type
    Then I should not see any edit controls for the schema
    And I should not see any delete controls for entity types
