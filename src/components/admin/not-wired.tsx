import { Card, EmptyState, type IconComponent } from '@/components/ui'

/**
 * A white-label section the live API server has nothing behind yet. It keeps
 * its place in the product (and its design) and states exactly what is
 * missing, instead of rendering sample data that would read as real.
 */
export function NotWired({
  icon,
  title,
  description,
  needs,
}: {
  icon: IconComponent
  title: string
  description: string
  needs: string[]
}) {
  return (
    <Card>
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={
          <div className="mx-auto max-w-md rounded-xl border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-left">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Needs on the API server</p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-neutral-300">
              {needs.map((need) => (
                <li key={need}>{need}</li>
              ))}
            </ul>
          </div>
        }
      />
    </Card>
  )
}
