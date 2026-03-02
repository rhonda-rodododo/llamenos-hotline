@android @ios @desktop @regression @requires-camera
Feature: Device Linking
  As a user with an identity on another device
  I want to link this device by scanning a QR code
  So that I can use the same identity on both devices

  Background:
    Given I am authenticated
    And I navigate to the device link screen from settings

  Scenario: Device link screen shows step indicator
    Then I should see the step indicator
    And I should see step labels (Scan, Verify, Import)
    And the current step should be "Scan"

  Scenario: Device link shows camera or permission prompt
    Then I should see either the camera preview or the camera permission prompt

  Scenario: Camera permission denied shows request button
    Given camera permission is not granted
    Then I should see the "Request Camera Permission" button

  @requires-camera
  Scenario: Invalid QR code shows error
    When a QR code with invalid format is scanned
    Then I should see the error state
    And the error message should mention "Invalid QR code format"
    And I should see "Retry" and "Cancel" buttons

  Scenario: Cancel returns to settings
    When I tap the back button
    Then I should return to the settings screen

  Scenario: Device link back navigation
    When I tap the back button
    Then I should see the settings screen
    And the device link card should still be visible
