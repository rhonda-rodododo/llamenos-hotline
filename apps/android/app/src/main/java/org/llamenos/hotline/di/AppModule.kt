package org.llamenos.hotline.di

import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * Hilt dependency injection module for the llamenos application.
 *
 * All core services use constructor injection (`@Inject constructor`) and
 * are annotated with `@Singleton`, so Hilt binds them automatically.
 * This module exists as the extension point for any future `@Provides`
 * methods that require custom construction logic (e.g., configuring
 * OkHttpClient with certificates, database instances).
 *
 * Automatically-bound singletons (via @Inject constructor + @Singleton):
 *
 *   CryptoService       (no deps)
 *   KeystoreService     (@ApplicationContext Context)
 *   AuthInterceptor     (CryptoService)
 *   ApiService          (AuthInterceptor, KeystoreService)
 *   WebSocketService    (CryptoService, KeystoreService)
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule
