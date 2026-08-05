import Foundation

let nativeTextThreshold = 50

enum PageType {
    case native, scanned
}

enum PdfClassification {
    case native
    case scanned
    case mixed([Int: PageType])
    case encrypted
}
