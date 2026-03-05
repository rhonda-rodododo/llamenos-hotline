@android @ios @desktop @security
Feature: Relay URL Validation
  As a security-conscious app
  I want to reject relay URLs pointing to private or local networks
  So that SSRF attacks via device linking are prevented

  Background:
    Given I am authenticated
    And I navigate to the device link screen from settings

  @requires-camera
  Scenario: QR code with localhost relay shows error
    When a QR code with relay URL "wss://localhost:4869" is scanned
    Then I should see the error state
    And the error message should mention private or local network

  @requires-camera
  Scenario: QR code with private IP 192.168.x.x relay shows error
    When a QR code with relay URL "wss://192.168.1.100:4869" is scanned
    Then I should see the error state
    And the error message should mention private or local network

  @requires-camera
  Scenario: QR code with private IP 10.x.x.x relay shows error
    When a QR code with relay URL "wss://10.0.0.1:4869" is scanned
    Then I should see the error state
    And the error message should mention private or local network

  @requires-camera
  Scenario: QR code with loopback IPv6 relay shows error
    When a QR code with relay URL "wss://[::1]:4869" is scanned
    Then I should see the error state
    And the error message should mention private or local network

  @requires-camera
  Scenario: QR code with link-local relay shows error
    When a QR code with relay URL "wss://169.254.1.1:4869" is scanned
    Then I should see the error state
    And the error message should mention private or local network

  @requires-camera
  Scenario: QR code with valid public relay proceeds
    When a QR code with relay URL "wss://relay.llamenos.org" is scanned
    Then I should not see a relay URL error
    And the step should advance to "Verify"
