package org.llamenos.hotline.model

import kotlinx.serialization.Serializable

/**
 * Re-export generated AssignReportBody from protocol package.
 */
typealias AssignReportRequest = org.llamenos.protocol.AssignReportBody

/**
 * Re-export generated ReportCategoriesResponse from protocol package.
 * The generated type has the same shape: categories: List<String>.
 */
typealias ReportCategoriesResponse = org.llamenos.protocol.ReportCategoriesResponse

/**
 * A report — a specialized conversation with structured metadata.
 *
 * Client-specific shape for the reports UI. The generated ReportResponse
 * (org.llamenos.protocol.ReportResponse) has a different shape with
 * E2EE fields (encryptedContent, readerEnvelopes) and uses enum types
 * for status. This type uses plain Strings and adds UI metadata.
 */
@Serializable
data class Report(
    val id: String,
    val channelType: String = "reports",
    val contactHash: String? = null,
    val assignedTo: String? = null,
    val status: String,
    val createdAt: String,
    val updatedAt: String? = null,
    val lastMessageAt: String? = null,
    val messageCount: Int = 0,
    val metadata: ReportMetadata? = null,
)

/**
 * Report-specific metadata embedded in the conversation.
 */
@Serializable
data class ReportMetadata(
    val type: String = "report",
    val reportTitle: String? = null,
    val reportCategory: String? = null,
    val reportTypeId: String? = null,
    val linkedCallId: String? = null,
    val reportId: String? = null,
    val conversionStatus: String? = null,
)

/**
 * Paginated reports list response from GET /reports.
 * Client-side wrapper — the generated ReportListResponse uses JsonArray
 * for conversations and Double for total. This uses typed Report list and Int.
 */
@Serializable
data class ReportsListResponse(
    val conversations: List<Report>,
    val total: Int = 0,
)

/**
 * Request body for POST /reports (create a new report).
 * Client-specific simplified shape — the generated CreateReportBody
 * uses CreateReportBodyReaderEnvelope for envelopes (same fields but different type name).
 */
@Serializable
data class CreateReportRequest(
    val title: String,
    val category: String? = null,
    val encryptedContent: String,
    val readerEnvelopes: List<ReportEnvelope>,
)

/**
 * ECIES envelope for a report reader.
 */
@Serializable
data class ReportEnvelope(
    val pubkey: String,
    val wrappedKey: String,
    val ephemeralPubkey: String,
)

/**
 * Request body for PATCH /reports/:id (status update).
 * Client-specific shape — uses plain String for status instead of the
 * generated UpdateReportBody which uses UpdateConversationBodyStatus enum.
 */
@Serializable
data class UpdateReportRequest(
    val status: String,
)

/**
 * Request body for POST /reports/:id/convert-to-case.
 */
@Serializable
data class ConvertReportToCaseRequest(
    val reportId: String,
    val title: String,
    val reportTypeId: String? = null,
)

/**
 * Response from POST /reports/:id/convert-to-case.
 */
@Serializable
data class ConvertReportToCaseResponse(
    val recordId: String,
    val reportId: String,
)
