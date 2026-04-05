import { IdleLockSlider } from '@/components/IdleLockSlider'
import { PinChangeForm } from '@/components/PinChangeForm'
import { RecoveryRotateForm } from '@/components/RecoveryRotateForm'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/security/factors')({
  component: FactorsPage,
})

function FactorsPage() {
  return (
    <div className="space-y-8" data-testid="factors-page">
      <PinChangeForm />
      <RecoveryRotateForm />
      <IdleLockSlider />
    </div>
  )
}
