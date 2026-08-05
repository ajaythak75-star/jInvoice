import Foundation

struct LineItem: Equatable, Codable {
    let name: String
    let quantity: Double
    let unitPricePaise: Int64
    let totalPricePaise: Int64
    let discountPaise: Int64

    init(name: String, quantity: Double, unitPricePaise: Int64, discountPaise: Int64 = 0) {
        self.name = name
        self.quantity = quantity
        self.unitPricePaise = unitPricePaise
        self.totalPricePaise = Int64(quantity * Double(unitPricePaise))
        self.discountPaise = discountPaise
    }
}
