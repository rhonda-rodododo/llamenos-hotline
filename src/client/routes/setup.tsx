import { createFileRoute } from '@tanstack/react-router'
import { SetupWizard } from '@/components/setup/SetupWizard'

export const Route = createFileRoute('/setup')({
  component: SetupPage,
})

function SetupPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>
      <div className="relative z-10 w-full flex justify-center">
        <SetupWizard />
      </div>
    </div>
  )
}
