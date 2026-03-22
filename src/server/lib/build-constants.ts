import pkg from '../../../package.json' with { type: 'json' }

export const BUILD_VERSION = process.env.BUILD_VERSION ?? pkg.version
export const BUILD_COMMIT = process.env.BUILD_COMMIT ?? 'dev'
export const BUILD_TIME = process.env.BUILD_TIME ?? new Date().toISOString()
