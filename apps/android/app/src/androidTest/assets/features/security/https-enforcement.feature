@android @ios @desktop @security
Feature: HTTPS Enforcement
  As a security-conscious app
  I want all network connections to use HTTPS/WSS
  So that traffic cannot be intercepted

  Scenario: HTTP hub URL is rejected during setup
    Given I am on the setup or identity creation screen
    When I enter hub URL "http://insecure.example.org"
    And I submit the form
    Then I should see an error about insecure connection
    And the connection should not be established

  Scenario: HTTPS hub URL is accepted
    Given I am on the setup or identity creation screen
    When I enter hub URL "https://hub.llamenos.org"
    And I submit the form
    Then I should not see a connection security error
