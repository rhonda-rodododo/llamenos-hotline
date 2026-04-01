import { describe, expect, test } from 'bun:test'
import { TagsService } from './tags'

describe('TagsService', () => {
  test('service has expected methods', () => {
    expect(TagsService.prototype.createTag).toBeDefined()
    expect(TagsService.prototype.listTags).toBeDefined()
    expect(TagsService.prototype.getTag).toBeDefined()
    expect(TagsService.prototype.getTagByName).toBeDefined()
    expect(TagsService.prototype.updateTag).toBeDefined()
    expect(TagsService.prototype.deleteTag).toBeDefined()
    expect(TagsService.prototype.getOrCreateTag).toBeDefined()
    expect(TagsService.prototype.isStrictTags).toBeDefined()
    expect(TagsService.prototype.seedDefaultTags).toBeDefined()
    expect(TagsService.prototype.getTagUsageCount).toBeDefined()
    expect(TagsService.prototype.resetForTest).toBeDefined()
  })
})
