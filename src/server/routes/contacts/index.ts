import { createRouter } from '../../lib/openapi'
import bulkRoutes from './bulk'
import coreRoutes from './core'
import discoveryRoutes from './discovery'
import outreachRoutes from './outreach'
import relationshipRoutes from './relationships'

const contacts = createRouter()

// Mount order matters: static routes MUST come before parameterized /{id} routes.
// discovery has /recipients, /check-duplicate, /hash-phone, /from-call/{callId}
contacts.route('/', discoveryRoutes)
// relationships has /relationships, /relationships/{id}, /{id}/link
contacts.route('/', relationshipRoutes)
// bulk has /bulk (PATCH + DELETE) — must precede /{id}
contacts.route('/', bulkRoutes)
// outreach has /{id}/notify
contacts.route('/', outreachRoutes)
// core has /, /{id}, /{id}/timeline — parameterized routes last
contacts.route('/', coreRoutes)

export default contacts
