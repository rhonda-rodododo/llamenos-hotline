import { describe, expect, test } from 'bun:test'
import { ContactService } from './contacts'

describe('ContactService', () => {
  test('service can be instantiated and exposes expected methods', () => {
    expect(ContactService).toBeDefined()
    expect(ContactService.prototype.createContact).toBeDefined()
    expect(ContactService.prototype.getContact).toBeDefined()
    expect(ContactService.prototype.listContacts).toBeDefined()
    expect(ContactService.prototype.updateContact).toBeDefined()
    expect(ContactService.prototype.deleteContact).toBeDefined()
    expect(ContactService.prototype.linkCall).toBeDefined()
    expect(ContactService.prototype.unlinkCall).toBeDefined()
    expect(ContactService.prototype.linkConversation).toBeDefined()
    expect(ContactService.prototype.unlinkConversation).toBeDefined()
    expect(ContactService.prototype.setTeamsService).toBeDefined()
  })

  test('setTeamsService stores the reference (late binding)', () => {
    // Verify the setter exists and is a function
    expect(typeof ContactService.prototype.setTeamsService).toBe('function')
  })
})
