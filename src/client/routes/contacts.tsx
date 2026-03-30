import { CreateContactDialog } from '@/components/contacts/create-contact-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfig } from '@/lib/config'
import { decryptHubField } from '@/lib/hub-field-crypto'
import { useContacts } from '@/lib/queries/contacts'
import { useTeamContacts, useTeams } from '@/lib/queries/teams'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BookUser, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** ContactRecord augmented with fields populated by decryptObjectFields */
type DecryptedContact = {
  id: string
  contactType: string
  riskLevel?: string
  tags: string[]
  lastInteractionAt?: string
  createdAt: string
  displayName?: string
  notes?: string
  [key: string]: unknown
}

type ContactsSearch = {
  contactType: string
  riskLevel: string
  q: string
  teamId: string
}

export const Route = createFileRoute('/contacts')({
  validateSearch: (search: Record<string, unknown>): ContactsSearch => ({
    contactType: (search?.contactType as string) || '',
    riskLevel: (search?.riskLevel as string) || '',
    q: (search?.q as string) || '',
    teamId: (search?.teamId as string) || '',
  }),
  component: ContactDirectoryPage,
})

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/10 text-green-500 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-500 border-red-500/20',
}

function ContactDirectoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/contacts' })
  const { contactType, riskLevel, q, teamId } = Route.useSearch()
  const [searchInput, setSearchInput] = useState(q)
  const [createOpen, setCreateOpen] = useState(false)
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'

  const { data: contacts = [], isLoading: loading } = useContacts({
    contactType: contactType || undefined,
    riskLevel: riskLevel || undefined,
  })
  const { data: teams = [] } = useTeams()
  const { data: teamContacts = [] } = useTeamContacts(teamId || '')

  const decryptedContacts = contacts as unknown as DecryptedContact[]

  // Team contact IDs for filtering
  const teamContactIds = useMemo(
    () => (teamId ? new Set(teamContacts.map((tc) => tc.contactId)) : null),
    [teamId, teamContacts]
  )

  const filtered = useMemo(() => {
    let result = decryptedContacts

    // Filter by team
    if (teamContactIds) {
      result = result.filter((c) => teamContactIds.has(c.id))
    }

    // Filter by search query
    if (q) {
      const lower = q.toLowerCase()
      result = result.filter((c) => (c.displayName ?? '[encrypted]').toLowerCase().includes(lower))
    }

    return result
  }, [decryptedContacts, q, teamContactIds])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    navigate({ search: (prev) => ({ ...prev, q: searchInput }) })
  }

  function handleContactTypeChange(value: string) {
    navigate({ search: (prev) => ({ ...prev, contactType: value === 'all' ? '' : value }) })
  }

  function handleRiskLevelChange(value: string) {
    navigate({ search: (prev) => ({ ...prev, riskLevel: value === 'all' ? '' : value }) })
  }

  function handleTeamChange(value: string) {
    navigate({ search: (prev) => ({ ...prev, teamId: value === 'all' ? '' : value }) })
  }

  function getContactTypeLabel(type: string): string {
    if (type === 'partner-org') return t('contacts.partnerOrg')
    if (type === 'referral-resource') return t('contacts.referralResource')
    return t(`contacts.${type}`, { defaultValue: type })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookUser className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('contacts.title')}</h1>
        </div>
        <Button data-testid="new-contact-btn" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('contacts.newContact')}
        </Button>
      </div>

      {/* Search and filter bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <form onSubmit={handleSearch} className="flex flex-1 gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="contact-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('contacts.search')}
                  className="pl-9"
                />
              </div>
              <Button
                data-testid="contact-search-btn"
                type="submit"
                size="sm"
                aria-label={t('a11y.searchButton', { defaultValue: 'Search' })}
              >
                <Search className="h-4 w-4" />
              </Button>
            </form>
            <div className="flex gap-2">
              <Select value={contactType || 'all'} onValueChange={handleContactTypeChange}>
                <SelectTrigger data-testid="contact-type-filter" className="w-40">
                  <SelectValue placeholder={t('contacts.type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('contacts.type')}</SelectItem>
                  <SelectItem value="caller">{t('contacts.caller')}</SelectItem>
                  <SelectItem value="partner-org">{t('contacts.partnerOrg')}</SelectItem>
                  <SelectItem value="referral-resource">
                    {t('contacts.referralResource')}
                  </SelectItem>
                  <SelectItem value="other">{t('contacts.other')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={riskLevel || 'all'} onValueChange={handleRiskLevelChange}>
                <SelectTrigger data-testid="risk-level-filter" className="w-36">
                  <SelectValue placeholder={t('contacts.riskLevel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('contacts.riskLevel')}</SelectItem>
                  <SelectItem value="low">{t('contacts.low')}</SelectItem>
                  <SelectItem value="medium">{t('contacts.medium')}</SelectItem>
                  <SelectItem value="high">{t('contacts.high')}</SelectItem>
                  <SelectItem value="critical">{t('contacts.critical')}</SelectItem>
                </SelectContent>
              </Select>
              {teams.length > 0 && (
                <Select value={teamId || 'all'} onValueChange={handleTeamChange}>
                  <SelectTrigger data-testid="team-filter" className="w-40">
                    <SelectValue placeholder={t('teams.team', { defaultValue: 'Team' })} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t('teams.allTeams', { defaultValue: 'All Teams' })}
                    </SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {decryptHubField(team.encryptedName, hubId, '[encrypted]')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contact list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <BookUser className="mx-auto mb-2 h-8 w-8 opacity-40" />
              {t('contacts.noContacts')}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  data-testid="contact-row"
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 sm:px-6"
                  onClick={() => {
                    navigate({
                      to: '/contacts/$contactId',
                      params: { contactId: contact.id },
                      search: (prev) => prev,
                    })
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {contact.displayName ?? '[encrypted]'}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-xs capitalize">
                    {getContactTypeLabel(contact.contactType)}
                  </Badge>
                  {contact.riskLevel && contact.riskLevel !== 'low' && (
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-xs capitalize ${RISK_COLORS[contact.riskLevel] ?? ''}`}
                    >
                      {t(`contacts.${contact.riskLevel}`, { defaultValue: contact.riskLevel })}
                    </Badge>
                  )}
                  {contact.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {contact.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {contact.tags.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{contact.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {contact.lastInteractionAt
                      ? new Date(contact.lastInteractionAt).toLocaleDateString()
                      : new Date(contact.createdAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateContactDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false)
        }}
      />
    </div>
  )
}
