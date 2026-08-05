// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "jInvoice",
    defaultLocalization: "en",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "jInvoice", targets: ["jInvoice"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.24.0"),
        .package(url: "https://github.com/google/GoogleSignIn-iOS.git", from: "7.1.0"),
        .package(
            url: "https://github.com/AzureAD/microsoft-authentication-library-for-objc.git",
            from: "1.3.0"
        ),
    ],
    targets: [
        .target(
            name: "jInvoice",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
                .product(name: "MSAL", package: "microsoft-authentication-library-for-objc"),
            ],
            path: "Sources",
            resources: [
                .process("Resources"),
            ]
        ),
        .testTarget(
            name: "jInvoiceTests",
            dependencies: ["jInvoice"],
            path: "Tests"
        ),
    ]
)
