// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Llamenos",
    platforms: [.iOS(.v17)],
    dependencies: [],
    targets: [
        .binaryTarget(
            name: "LlamenosCoreFFI",
            path: "LlamenosCoreFFI.xcframework"
        ),
        .target(
            name: "Llamenos",
            dependencies: ["LlamenosCoreFFI"],
            path: "Sources"
        ),
        .testTarget(
            name: "LlamenosTests",
            dependencies: ["Llamenos"],
            path: "Tests/Unit"
        ),
    ]
)
