@android @ios @desktop
Feature: Role Management
  As an admin
  I want to manage roles and permissions
  So that I can control access levels for volunteers

  Background:
    Given I am logged in as an admin

  Scenario: List default roles
    When I request the roles list
    Then I should see at least 5 roles
    And I should see "Super Admin" role
    And I should see "Hub Admin" role
    And I should see "Reviewer" role
    And I should see "Volunteer" role
    And I should see "Reporter" role

  Scenario: Super Admin has wildcard permission
    When I request the roles list
    Then the "Super Admin" role should have wildcard permission
    And the "Super Admin" role should be a system role
    And the "Super Admin" role should be the default role

  Scenario: Create a custom role
    When I create a custom role "Call Monitor" with permissions
    Then the role should be created successfully
    And the role slug should be "call-monitor"

  Scenario: Delete a custom role
    Given a custom role "Temp Role" exists
    When I delete the "Temp Role" role
    Then the role should be removed

  Scenario: Cannot delete system roles
    When I attempt to delete the "Super Admin" role
    Then the deletion should fail with a 403 error

  Scenario: Assign role to volunteer
    Given a volunteer exists
    When I assign the "Reviewer" role to the volunteer
    Then the volunteer should have the "Reviewer" role

  Scenario: Volunteer with Reviewer role can access notes
    Given a volunteer with the "Reviewer" role exists
    When the reviewer logs in
    Then they should see "Notes" in the navigation

  Scenario: Reporter role has limited permissions
    When I request the "Reporter" role details
    Then it should have "reports:create" permission
    And it should not have "notes:read" permission

  Scenario: Reject duplicate role slug
    When I create a custom role with an existing slug
    Then I should see a duplicate slug error

  Scenario: Reject invalid slug format
    When I create a role with slug "Invalid Slug!"
    Then I should see an invalid slug error

  Scenario: Update custom role permissions
    Given a custom role "Call Monitor" exists
    When I update the role permissions
    Then the permissions should be updated

  Scenario: Fetch permissions catalog
    When I request the permissions catalog
    Then I should see all available permissions grouped by domain

  Scenario: Admin can access all endpoints
    Given I am logged in as an admin
    Then I should have access to all API endpoints

  Scenario: Volunteer cannot access admin endpoints
    Given I am logged in as a volunteer
    When I attempt to access an admin endpoint
    Then I should receive a 403 forbidden response

  Scenario: Reporter cannot access call endpoints
    Given I am logged in as a reporter
    When I attempt to access call-related endpoints
    Then I should receive a 403 forbidden response

  Scenario: Multi-role user gets union of permissions
    Given a volunteer has both "Volunteer" and "Reviewer" roles
    When the volunteer logs in
    Then they should have permissions from both roles

  Scenario: Custom role grants only specified permissions
    Given a volunteer has only a custom "Call Monitor" role
    When the volunteer logs in
    Then they should only see endpoints allowed by that role

  Scenario: Custom role user cannot access unauthorized endpoints
    Given a volunteer has only a custom "Call Monitor" role
    When the volunteer attempts to access an unauthorized endpoint
    Then they should receive a 403 forbidden response

  Scenario: Reporter sees reports UI only
    Given I am logged in as a reporter
    Then I should see the reports navigation
    And I should not see the calls navigation
    And I should not see the volunteers management

  Scenario: Admin sees all navigation items
    Given I am logged in as an admin
    Then I should see all navigation items including admin

  Scenario: Domain wildcard grants all domain permissions
    Given a role with "notes:*" wildcard permission
    When the user with that role logs in
    Then they should have all notes-related permissions

  Scenario: Role selector shows all default roles
    When I view the volunteer list
    Then the role dropdown should show all default roles

  Scenario: Change volunteer role via dropdown
    Given a volunteer with "Volunteer" role
    When I change their role to "Hub Admin" via the dropdown
    Then the volunteer should display the "Hub Admin" badge

  Scenario: Hub Admin badge displays after role change
    Given I changed a volunteer's role to "Hub Admin"
    Then I should see the "Hub Admin" badge on their card

  Scenario: Add Volunteer form shows available roles
    When I open the Add Volunteer form
    Then I should see all available roles in the form

  Scenario: Invite form shows available roles
    When I open the Invite form
    Then I should see all available roles in the form

  Scenario: Delete non-existent role returns error
    When I attempt to delete a role that does not exist
    Then I should receive a not found error
