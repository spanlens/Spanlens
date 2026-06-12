// Wires @testing-library/jest-dom matchers (toBeInTheDocument, toHaveClass,
// toHaveAttribute, …) onto Vitest's `expect`. Component tests rely on these
// for readable assertions; pure-helper tests in lib/ never call them so the
// extra setup cost is one require() at boot.
import '@testing-library/jest-dom/vitest'
