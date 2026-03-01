# llamenos-core JNI bindings — keep all native method declarations
-keep class org.llamenos.hotline.crypto.** { *; }

# Keep UniFFI-generated Kotlin bindings (will be in this package when linked)
-keep class uniffi.llamenos_core.** { *; }

# Keep data classes used by kotlinx.serialization
-keepattributes *Annotation*
-keep class org.llamenos.hotline.api.** { *; }

# kotlinx.serialization
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
-keep class androidx.security.crypto.** { *; }
