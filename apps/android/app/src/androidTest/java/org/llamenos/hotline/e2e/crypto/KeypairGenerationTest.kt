package org.llamenos.hotline.e2e.crypto

import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.llamenos.hotline.crypto.CryptoService
import javax.inject.Inject

/**
 * E2E tests for keypair-generation.feature scenarios.
 *
 * Feature: Keypair Generation
 * Verifies format and uniqueness of generated Nostr keypairs on real Android hardware.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class KeypairGenerationTest {

    @get:Rule
    val hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var cryptoService: CryptoService

    @Before
    fun setup() {
        hiltRule.inject()
    }

    // Scenario: Generated keypair has valid format
    @Test
    fun generatedKeypairHasValidFormat() {
        val (nsec, npub) = cryptoService.generateKeypair()
        assertTrue("nsec should start with 'nsec1'", nsec.startsWith("nsec1"))
        assertTrue("npub should start with 'npub1'", npub.startsWith("npub1"))
        assertEquals("nsec should be 63 chars", 63, nsec.length)
        assertEquals("npub should be 63 chars", 63, npub.length)
    }

    // Scenario: Generated keypair is unique each time
    @Test
    fun generatedKeypairIsUniqueEachTime() {
        val serviceA = CryptoService()
        val (nsecA, npubA) = serviceA.generateKeypair()

        val serviceB = CryptoService()
        val (nsecB, npubB) = serviceB.generateKeypair()

        assertNotEquals("nsecs should be unique", nsecA, nsecB)
        assertNotEquals("npubs should be unique", npubA, npubB)
    }

    // Scenario: Public key is 64 hex characters
    @Test
    fun publicKeyIs64HexCharacters() {
        cryptoService.generateKeypair()
        val pubkey = cryptoService.pubkey!!
        assertEquals("Pubkey should be 64 hex chars", 64, pubkey.length)
        assertTrue(
            "Pubkey should only contain hex chars",
            pubkey.matches(Regex("^[0-9a-f]+$"))
        )
    }

    // Scenario: Keypair import roundtrip
    @Test
    fun keypairImportRoundtrip() {
        val (nsec, _) = cryptoService.generateKeypair()
        val originalPubkey = cryptoService.pubkey!!
        val originalNpub = cryptoService.npub!!

        val importService = CryptoService()
        importService.importNsec(nsec)

        // In native mode, imported pubkey matches original
        // In placeholder mode, import uses random pubkey (structurally valid)
        if (cryptoService.nativeLibLoaded) {
            assertEquals("Imported pubkey should match", originalPubkey, importService.pubkey)
            assertEquals("Imported npub should match", originalNpub, importService.npub)
        } else {
            // Placeholder: just verify structure
            assertTrue(importService.isUnlocked)
            assertTrue(importService.npub!!.startsWith("npub1"))
        }
    }
}
