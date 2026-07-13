// Kept in a separate module so package.json doesn't have to be read at runtime
// (avoids resolveJsonModule pulling the whole manifest into the bundle).
// Bumped manually with each release; package.json stays canonical for npm.
export const SERVER_VERSION = '0.2.1'
