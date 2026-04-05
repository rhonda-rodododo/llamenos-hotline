import { describe, expect, it } from 'bun:test'
import { FirehoseInferenceClient } from './firehose-inference'

describe('FirehoseInferenceClient', () => {
  it('should be constructable with endpoint URL', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    expect(client).toBeDefined()
  })

  it('should generate JSON schema from custom field definitions', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    const fields = [
      { name: 'size', label: 'Size', type: 'text' as const, required: true, options: [] },
      { name: 'activity', label: 'Activity', type: 'text' as const, required: true, options: [] },
      {
        name: 'location',
        label: 'Location',
        type: 'location' as const,
        required: true,
        options: [],
      },
      {
        name: 'equipment',
        label: 'Equipment',
        type: 'text' as const,
        required: false,
        options: [],
      },
      {
        name: 'urgency',
        label: 'Urgency',
        type: 'select' as const,
        required: true,
        options: ['high', 'medium', 'low'],
      },
    ]
    const schema = client.buildJsonSchemaFromFields(fields)

    expect(schema.type).toBe('object')
    expect(schema.properties.size).toBeDefined()
    expect(schema.properties.size.type).toBe('string')
    expect(schema.properties.activity).toBeDefined()
    expect(schema.properties.urgency.enum).toEqual(['high', 'medium', 'low'])
    expect(schema.required).toContain('size')
    expect(schema.required).toContain('activity')
    expect(schema.required).toContain('location')
    expect(schema.required).toContain('urgency')
    expect(schema.required).not.toContain('equipment')
  })

  it('should handle number fields with description hint', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    const fields = [
      { name: 'count', label: 'Count', type: 'number' as const, required: true, options: [] },
    ]
    const schema = client.buildJsonSchemaFromFields(fields)
    expect(schema.properties.count.type).toBe('string')
    expect(schema.properties.count.description).toContain('numeric')
  })

  it('should handle checkbox fields', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    const fields = [
      { name: 'urgent', label: 'Urgent', type: 'checkbox' as const, required: false, options: [] },
    ]
    const schema = client.buildJsonSchemaFromFields(fields)
    expect(schema.properties.urgent.description).toContain('yes or no')
  })

  it('should handle multiselect fields with options hint', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    const fields = [
      {
        name: 'tags',
        label: 'Tags',
        type: 'multiselect' as const,
        required: false,
        options: ['fire', 'medical', 'police'],
      },
    ]
    const schema = client.buildJsonSchemaFromFields(fields)
    expect(schema.properties.tags.description).toContain('fire')
    expect(schema.properties.tags.description).toContain('comma-separated')
  })

  it('should handle date fields with ISO 8601 hint', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    const fields = [
      {
        name: 'occurred_at',
        label: 'Occurred At',
        type: 'date' as const,
        required: true,
        options: [],
      },
    ]
    const schema = client.buildJsonSchemaFromFields(fields)
    expect(schema.properties.occurred_at.description).toContain('ISO 8601')
    expect(schema.required).toContain('occurred_at')
  })

  it('should use field name as fallback when label is empty', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    const fields = [
      { name: 'my_field', label: '', type: 'text' as const, required: false, options: [] },
    ]
    const schema = client.buildJsonSchemaFromFields(fields)
    expect(schema.properties.my_field.description).toBe('my_field')
  })

  it('should produce empty required array when no fields are required', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    const fields = [
      { name: 'notes', label: 'Notes', type: 'text' as const, required: false, options: [] },
    ]
    const schema = client.buildJsonSchemaFromFields(fields)
    expect(schema.required).toHaveLength(0)
  })
})
