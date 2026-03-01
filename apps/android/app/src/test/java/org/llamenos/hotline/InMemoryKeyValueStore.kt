package org.llamenos.hotline

import org.llamenos.hotline.crypto.KeyValueStore

/**
 * In-memory implementation of [KeyValueStore] for unit tests.
 * No Android framework dependencies — runs in pure JVM tests.
 */
class InMemoryKeyValueStore : KeyValueStore {
    private val storage = mutableMapOf<String, String>()

    override fun store(key: String, value: String) {
        storage[key] = value
    }

    override fun retrieve(key: String): String? = storage[key]

    override fun delete(key: String) {
        storage.remove(key)
    }

    override fun clear() {
        storage.clear()
    }

    override fun contains(key: String): Boolean = storage.containsKey(key)
}
