# llamenos-core JNI bindings — keep native method declarations and CryptoService public API
-keepclasseswithmembernames class org.llamenos.hotline.crypto.** {
    native <methods>;
}
-keepclassmembers class org.llamenos.hotline.crypto.CryptoService {
    <fields>;
    <init>(...);
}
-keepclassmembers class org.llamenos.hotline.crypto.EncryptedKeyData { <fields>; <init>(...); }
-keepclassmembers class org.llamenos.hotline.crypto.AuthToken { <fields>; <init>(...); }
-keepclassmembers class org.llamenos.hotline.crypto.Keypair { <fields>; <init>(...); }
-keepclassmembers class org.llamenos.hotline.crypto.EncryptedNote { <fields>; <init>(...); }
-keepclassmembers class org.llamenos.hotline.crypto.NoteEnvelope { <fields>; <init>(...); }
-keepclassmembers class org.llamenos.hotline.crypto.EncryptedMessage { <fields>; <init>(...); }
-keepclassmembers class org.llamenos.hotline.crypto.MessageEnvelope { <fields>; <init>(...); }
-keepclassmembers class org.llamenos.hotline.crypto.PinLockoutState$* { <fields>; <init>(...); }

# Keep UniFFI-generated Kotlin bindings (org.llamenos.core package per uniffi.toml)
-keep class org.llamenos.core.** { *; }

# JNA classes used by UniFFI
-keep class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**

# kotlinx.serialization — keep @Serializable model classes (fields + constructors)
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class org.llamenos.hotline.**$$serializer { *; }
-keepclassmembers class org.llamenos.hotline.** {
    *** Companion;
}
-keepclasseswithmembers class org.llamenos.hotline.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# API model classes — keep fields and constructors for serialization
-keepclassmembers class org.llamenos.hotline.api.models.** { <fields>; <init>(...); }
-keep @kotlinx.serialization.Serializable class org.llamenos.hotline.** { *; }

# Auth-related model classes
-keepclassmembers class org.llamenos.hotline.ui.auth.StoredKeyData { <fields>; <init>(...); }

# OkHttp
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Hilt
-dontwarn dagger.hilt.**

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Prevent R8 from stripping security-sensitive classes
-keep class androidx.security.crypto.EncryptedSharedPreferences { *; }
-keep class androidx.security.crypto.MasterKey { *; }
-keep class androidx.security.crypto.MasterKey$Builder { *; }
