import { describe, expect, test } from 'bun:test'
import { TeamsService } from './teams'

describe('TeamsService', () => {
  test('service can be instantiated', () => {
    expect(TeamsService).toBeDefined()
    expect(TeamsService.prototype.createTeam).toBeDefined()
    expect(TeamsService.prototype.listTeams).toBeDefined()
    expect(TeamsService.prototype.getTeam).toBeDefined()
    expect(TeamsService.prototype.updateTeam).toBeDefined()
    expect(TeamsService.prototype.deleteTeam).toBeDefined()
    expect(TeamsService.prototype.addMembers).toBeDefined()
    expect(TeamsService.prototype.removeMember).toBeDefined()
    expect(TeamsService.prototype.listMembers).toBeDefined()
    expect(TeamsService.prototype.getUserTeamIds).toBeDefined()
    expect(TeamsService.prototype.assignContacts).toBeDefined()
    expect(TeamsService.prototype.unassignContact).toBeDefined()
    expect(TeamsService.prototype.listTeamContacts).toBeDefined()
    expect(TeamsService.prototype.autoAssignForUser).toBeDefined()
    expect(TeamsService.prototype.resetForTest).toBeDefined()
  })
})
