package org.llamenos.hotline.api

import okhttp3.Interceptor
import okhttp3.Response
import org.llamenos.hotline.crypto.CryptoService
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp [Interceptor] that injects Schnorr authentication tokens into every request.
 *
 * The Authorization header contains a Bearer token with a JSON payload:
 * ```
 * Authorization: Bearer {"pubkey":"<hex>","timestamp":<ms>,"token":"<schnorr_sig>"}
 * ```
 *
 * The token is created synchronously via [CryptoService.createAuthTokenSync] because
 * OkHttp interceptors execute on OkHttp's thread pool and cannot use coroutines.
 * Schnorr signing is ~1ms so blocking the calling thread is acceptable.
 *
 * Thread safety: The interceptor synchronizes on [cryptoService] to prevent a race
 * between the `isUnlocked` check and token creation if `lock()` is called concurrently
 * (e.g., from the background timeout handler on the main thread).
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val cryptoService: CryptoService,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        val method = originalRequest.method
        val path = originalRequest.url.encodedPath

        val authenticatedRequest = synchronized(cryptoService) {
            if (!cryptoService.isUnlocked) {
                return@synchronized null
            }

            try {
                val token = cryptoService.createAuthTokenSync(method, path)
                val authHeaderValue = buildString {
                    append("""{"pubkey":"""")
                    append(token.pubkey)
                    append("""","timestamp":""")
                    append(token.timestamp)
                    append(""","token":"""")
                    append(token.token)
                    append(""""}""")
                }

                originalRequest.newBuilder()
                    .header("Authorization", "Bearer $authHeaderValue")
                    .build()
            } catch (_: Exception) {
                // Key was locked between the isUnlocked check and the signing call.
                // Proceed without authentication — the server will return 401 and
                // the app will redirect to the unlock screen.
                null
            }
        }

        return chain.proceed(authenticatedRequest ?: originalRequest)
    }
}
