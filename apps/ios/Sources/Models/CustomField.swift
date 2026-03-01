import Foundation

// MARK: - CustomFieldDefinition

/// Definition of a custom field attached to notes, matching the protocol spec (Appendix B).
/// Fetched from `GET /api/settings/custom-fields`.
struct CustomFieldDefinition: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let label: String
    let type: FieldType
    let required: Bool
    let options: [String]?
    let validation: FieldValidation?
    let visibleToVolunteers: Bool
    let editableByVolunteers: Bool
    let context: FieldContext
    let allowFileUpload: Bool?
    let acceptedFileTypes: [String]?
    let order: Int
    let createdAt: String?

    // MARK: - FieldType

    enum FieldType: String, Codable, Sendable {
        case text
        case number
        case select
        case checkbox
        case textarea
    }

    // MARK: - FieldContext

    enum FieldContext: String, Codable, Sendable {
        case callNotes = "call-notes"
        case reports
        case both
    }

    // MARK: - FieldValidation

    struct FieldValidation: Codable, Sendable {
        let minLength: Int?
        let maxLength: Int?
        let min: Int?
        let max: Int?
    }
}

// MARK: - CustomFieldsResponse

/// API response from `GET /api/settings/custom-fields`.
struct CustomFieldsResponse: Codable, Sendable {
    let fields: [CustomFieldDefinition]
}
