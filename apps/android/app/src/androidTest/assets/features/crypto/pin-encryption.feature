@android @ios @desktop @smoke @crypto
Feature: PIN Encryption
  As a user setting a PIN
  I want my private key to be encrypted with the PIN
  So that it's protected at rest

  Scenario: PIN encryption roundtrip with correct PIN
    Given I have a loaded keypair
    When I encrypt the key with PIN "1234"
    And I lock the crypto service
    And I decrypt with PIN "1234"
    Then the crypto service should be unlocked
    And the pubkey should match the original

  Scenario: PIN encryption fails with wrong PIN
    Given I have a loaded keypair
    When I encrypt the key with PIN "1234"
    And I lock the crypto service
    And I attempt to decrypt with PIN "9999"
    Then decryption should fail with "Incorrect PIN"
    And the crypto service should remain locked

  Scenario: Encrypted key data has correct structure
    Given I have a loaded keypair
    When I encrypt the key with PIN "5678"
    Then the encrypted data should have a non-empty ciphertext
    And the encrypted data should have a non-empty salt
    And the encrypted data should have a non-empty nonce
    And the encrypted data should have a pubkey matching the original
    And the iterations should be 600,000

  @regression
  Scenario Outline: PIN validation rejects invalid inputs
    Given I have a loaded keypair
    When I attempt to encrypt with PIN "<pin>"
    Then encryption should "<result>"

    Examples:
      | pin     | result           |
      | 123     | fail (too short) |
      | 1234567 | fail (too long)  |
      |         | fail (empty)     |
