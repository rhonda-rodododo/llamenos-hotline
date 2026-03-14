import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  listDirectoryContacts,
  searchDirectoryContacts,
  getDirectoryContact,
  type DirectoryContact,
  type DirectoryContactType,
} from '@/lib/api'
import { formatRelativeTime } from '@/lib/format'
import { ContactCard } from '@/components/contacts/contact-card'
import { ContactProfile } from '@/components/contacts/contact-profile'
import { CreateContactDialog } from '@/components/contacts/create-contact-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Users, Plus, Search, Loader2, Lock,
} from 'lucide-react'

export const Route = createFileRoute('/contacts-directory')({
  component: ContactDirectoryPage,
})

function ContactDirectoryPage() {
  const { t } = useTranslation()
  const { hasNsec } = useAuth()
  const { toast } = useToast()

  const [contacts, setContacts] = useState<DirectoryContact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedContact, setSelectedContact] = useState<DirectoryContact | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Filter state
  const [typeFilter, setTypeFilter] = useState<string>('all')

  // Load contacts
  const loadContacts = useCallback(async () => {
    setLoading(true)
    try {
      const params: {
        limit?: number
        contactType?: DirectoryContactType
      } = { limit: 50 }
      if (typeFilter !== 'all') {
        params.contactType = typeFilter as DirectoryContactType
      }
      const res = await listDirectoryContacts(params)
      setContacts(res.contacts)
      setTotal(res.total)
    } catch {
      toast(t('contactDirectory.loadError', { defaultValue: 'Failed to load contacts' }), 'error')
    } finally {
      setLoading(false)
    }
  }, [typeFilter, t, toast])

  useEffect(() => { loadContacts() }, [loadContacts])

  // Debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    if (!value.trim()) {
      setIsSearching(false)
      loadContacts()
      return
    }

    setIsSearching(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchDirectoryContacts(value.trim())
        setContacts(res.contacts)
        setTotal(res.contacts.length)
      } catch {
        toast(t('contactDirectory.searchError', { defaultValue: 'Search failed' }), 'error')
      } finally {
        setIsSearching(false)
      }
    }, 300)
  }, [loadContacts, t, toast])

  // Load full contact detail when selected
  useEffect(() => {
    if (!selectedId) {
      setSelectedContact(null)
      return
    }

    // Try to use the list version first for instant display
    const listContact = contacts.find(c => c.id === selectedId)
    if (listContact) {
      setSelectedContact(listContact)
    }

    setDetailLoading(true)
    getDirectoryContact(selectedId)
      .then(full => setSelectedContact(full))
      .catch(() => {
        toast(t('contactDirectory.detailError', { defaultValue: 'Failed to load contact details' }), 'error')
      })
      .finally(() => setDetailLoading(false))
  }, [selectedId, contacts, t, toast])

  const handleContactCreated = useCallback((contact: DirectoryContact) => {
    setContacts(prev => [contact, ...prev])
    setTotal(prev => prev + 1)
    setSelectedId(contact.id)
  }, [])

  const showEmptyState = !loading && contacts.length === 0 && !searchQuery

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <h1 data-testid="page-title" className="text-xl font-bold sm:text-2xl">
            {t('contactDirectory.title', { defaultValue: 'Contact Directory' })}
          </h1>
          {total > 0 && (
            <Badge variant="secondary" className="text-xs">
              {total}
            </Badge>
          )}
        </div>
        <Button size="sm" data-testid="new-contact-btn" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t('contactDirectory.new', { defaultValue: 'New Contact' })}
        </Button>
      </div>

      {showEmptyState ? (
        <Card data-testid="empty-state">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {t('contactDirectory.noContacts', { defaultValue: 'No contacts in the directory' })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('contactDirectory.noContactsHint', { defaultValue: 'Contacts are created automatically from incoming calls, or you can add them manually.' })}
            </p>
            <Button
              size="sm"
              className="mt-4"
              data-testid="empty-state-create-btn"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('contactDirectory.new', { defaultValue: 'New Contact' })}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex h-[calc(100vh-12rem)] gap-4">
          {/* Left pane: contact list */}
          <div
            data-testid="contact-list"
            className="w-80 shrink-0 overflow-y-auto rounded-lg border border-border bg-card md:block"
          >
            {/* Search + filters */}
            <div className="sticky top-0 z-10 border-b border-border bg-card p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-testid="contact-search-input"
                  placeholder={t('contactDirectory.searchPlaceholder', { defaultValue: 'Search contacts...' })}
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Search indicator */}
              {isSearching && (
                <div data-testid="search-indicator" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {t('contactDirectory.searchingSecurely', { defaultValue: 'Searching securely...' })}
                </div>
              )}

              {/* Type filter */}
              <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setSearchQuery('') }}>
                <SelectTrigger data-testid="contact-type-filter" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t('contactDirectory.allTypes', { defaultValue: 'All types' })}
                  </SelectItem>
                  <SelectItem value="individual">
                    {t('contactDirectory.typeIndividual', { defaultValue: 'Individual' })}
                  </SelectItem>
                  <SelectItem value="organization">
                    {t('contactDirectory.typeOrganization', { defaultValue: 'Organization' })}
                  </SelectItem>
                  <SelectItem value="legal_resource">
                    {t('contactDirectory.typeLegalResource', { defaultValue: 'Legal Resource' })}
                  </SelectItem>
                  <SelectItem value="service_provider">
                    {t('contactDirectory.typeServiceProvider', { defaultValue: 'Service Provider' })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Contact list */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <Search className="h-6 w-6 mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery
                    ? t('contactDirectory.noSearchResults', { defaultValue: 'No contacts match your search.' })
                    : t('contactDirectory.noFilterResults', { defaultValue: 'No contacts match the selected filter.' })}
                </p>
              </div>
            ) : (
              <div className="p-2 space-y-1.5">
                {contacts.map(contact => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    isSelected={selectedId === contact.id}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right pane: contact detail */}
          <div
            data-testid="contact-detail"
            className="flex flex-1 flex-col rounded-lg border border-border bg-card overflow-hidden"
          >
            {selectedContact ? (
              detailLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ContactProfile contact={selectedContact} />
              )
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
                <Users className="h-10 w-10 mb-3" />
                <p>{t('contactDirectory.selectContact', { defaultValue: 'Select a contact to view details' })}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <CreateContactDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleContactCreated}
      />
    </div>
  )
}
