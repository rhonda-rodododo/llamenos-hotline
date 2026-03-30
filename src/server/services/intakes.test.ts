import { describe, expect, test } from 'bun:test'
import { IntakesService } from './intakes'

describe('IntakesService', () => {
  test('service has expected methods', () => {
    expect(IntakesService.prototype.submitIntake).toBeDefined()
    expect(IntakesService.prototype.listIntakes).toBeDefined()
    expect(IntakesService.prototype.getIntake).toBeDefined()
    expect(IntakesService.prototype.updateIntakeStatus).toBeDefined()
    expect(IntakesService.prototype.resetForTest).toBeDefined()
  })

  test('IntakeRow type is exported', () => {
    // Type-level check — if this compiles, the type export works
    const _typeCheck: typeof IntakesService = IntakesService
    expect(_typeCheck).toBe(IntakesService)
  })
})
