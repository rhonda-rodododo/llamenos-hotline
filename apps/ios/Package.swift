// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Llamenos",
    platforms: [.iOS(.v17)],
    dependencies: [],
    targets: [
        .target(
            name: "Llamenos",
            dependencies: [],
            path: "Sources"
        ),
        .testTarget(
            name: "LlamenosTests",
            dependencies: ["Llamenos"],
            path: "Tests"
        ),
    ]
)
