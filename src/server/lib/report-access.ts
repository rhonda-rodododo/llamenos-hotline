import { checkPermission } from '../middleware/permission-guard'

interface ReportLike {
  contactIdentifierHash: string
  assignedTo?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Verify that a user has access to a report.
 * Returns true if allowed, false if forbidden.
 *
 * Three-tier access:
 * 1. reports:read-all — can see everything
 * 2. reports:read-assigned — can see reports assigned to them
 * 3. Own reports — reporterPubkey in metadata matches pubkey
 */
export function verifyReportAccess(
  report: ReportLike,
  pubkey: string,
  permissions: string[]
): boolean {
  if (checkPermission(permissions, 'reports:read-all')) return true
  if (checkPermission(permissions, 'reports:read-assigned') && report.assignedTo === pubkey)
    return true
  if (isReportOwner(report, pubkey)) return true
  return false
}

/** Check if the pubkey is the owner/reporter of this report. */
export function isReportOwner(report: ReportLike, pubkey: string): boolean {
  const meta = report.metadata as { reporterPubkey?: string } | undefined
  // New reports store reporter pubkey in metadata (contactIdentifierHash has unique suffix)
  if (meta?.reporterPubkey === pubkey) return true
  // Legacy fallback: direct match on contactIdentifierHash
  if (report.contactIdentifierHash === pubkey) return true
  return false
}

/** Verify that a conversation is actually a report. Returns false if not. */
export function isReport(report: ReportLike): boolean {
  const meta = report.metadata as { type?: string } | undefined
  return meta?.type === 'report'
}
