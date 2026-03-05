@android @ios @security @crypto
Feature: Wake Key Validation
  As a security-conscious app
  I want push notification wake key encryption to validate inputs
  So that malformed payloads cannot crash or exploit the app

  Scenario: Wake key generation produces valid public key
    When a wake key pair is generated
    Then the public key should be 64 hex characters
    And the public key should be a valid secp256k1 point

  Scenario: Wake key decryption rejects malformed ephemeral public key
    Given a wake key pair exists
    When I attempt to decrypt a wake payload with ephemeral key "deadbeef"
    Then decryption should fail gracefully
    And no crash should occur

  Scenario: Wake key decryption rejects truncated ciphertext
    Given a wake key pair exists
    When I attempt to decrypt a wake payload with truncated ciphertext
    Then decryption should fail gracefully
    And no crash should occur

  Scenario: Wake key decryption rejects empty payload
    Given a wake key pair exists
    When I attempt to decrypt an empty wake payload
    Then decryption should fail gracefully
    And no crash should occur
