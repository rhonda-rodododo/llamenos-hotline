import Foundation

// MARK: - ReportTypeDefinition

/// Definition of a template-driven report type, matching the backend `reportTypeDefinitionSchema`.
/// Fetched from `GET /api/reports/types`. Each report type defines structured fields,
/// statuses, and display options for mobile report submission.
struct ReportTypeDefinition: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let label: String
    let labelPlural: String
    let description: String
    let icon: String?
    let color: String?
    let category: String  // always "report"
    let fields: [ReportFieldDefinition]
    let statuses: [StatusOption]
    let defaultStatus: String
    let allowFileAttachments: Bool
    let allowCaseConversion: Bool
    let mobileOptimized: Bool
    let isArchived: Bool
}

// MARK: - ReportFieldDefinition

/// Definition of a single field within a report type template.
/// Drives dynamic form rendering in `TypedReportCreateView`.
struct ReportFieldDefinition: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let label: String
    let type: String  // text, textarea, number, select, multiselect, checkbox, date, file
    let required: Bool
    let options: [FieldOption]?
    let section: String?
    let helpText: String?
    let order: Int
    let accessLevel: String
    let supportAudioInput: Bool

    /// Field type as a strongly-typed enum for switch exhaustivity.
    var fieldType: ReportFieldType {
        ReportFieldType(rawValue: type) ?? .text
    }
}

// MARK: - ReportFieldType

/// Supported field types for report form rendering.
enum ReportFieldType: String, Sendable {
    case text
    case textarea
    case number
    case select
    case multiselect
    case checkbox
    case date
    case file
}

// MARK: - FieldOption

/// Key-label pair for select and multiselect field options.
struct FieldOption: Codable, Equatable, Sendable {
    let key: String
    let label: String
}

// MARK: - StatusOption

/// Status option with display metadata, used in report type definitions.
struct StatusOption: Codable, Identifiable, Equatable, Sendable {
    var id: String { value }
    let value: String
    let label: String
    let color: String?
    let order: Int
    let isClosed: Bool?
}

// MARK: - ReportTypesResponse

/// API response from `GET /api/reports/types`.
struct ReportTypesResponse: Codable, Sendable {
    let reportTypes: [ReportTypeDefinition]
}

// MARK: - CreateTypedReportRequest

/// Request body for `POST /api/reports` with a report type.
/// Extends the base report creation with `reportTypeId`.
///
/// Encoded with a plain `JSONEncoder` (no `convertToSnakeCase`) and sent via
/// `APIService.request(method:path:rawBody:)` because the backend expects
/// camelCase keys (`reportTypeId`, `encryptedContent`, `readerEnvelopes`).
struct CreateTypedReportRequest: Encodable, Sendable {
    let title: String
    let category: String?
    let reportTypeId: String
    let encryptedContent: String
    let readerEnvelopes: [RecipientEnvelope]
}
