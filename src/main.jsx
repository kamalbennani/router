import { useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom/client'
import {
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router'

/**
 * `<Navigate>` re-issues its navigation on every render.
 *
 * Its only guard is an identity check on the JSX props object:
 *
 *   const previousPropsRef = React.useRef(null)
 *   useLayoutEffect(() => {
 *     if (previousPropsRef.current !== props) {
 *       navigate(props)
 *       previousPropsRef.current = props
 *     }
 *   }, [router, props, navigate])
 *
 * React allocates a fresh props object on every render, so that check never
 * holds and the navigation is re-issued every render.
 *
 * The counters below stop rendering `<Navigate>` after MAX_RENDERS so the tab
 * stays usable. Without that stop none of these cases terminate.
 */

const MAX_RENDERS = 25

const stats = {
  redirectRenders: 0,
  targetBeforeLoads: 0,
  loopDetected: false,
}

function reset() {
  stats.redirectRenders = 0
  stats.targetBeforeLoads = 0
  stats.loopDetected = false
}

/** Returns true once the redirect component has rendered suspiciously often. */
function trackRender() {
  stats.redirectRenders++
  if (stats.redirectRenders > MAX_RENDERS) {
    stats.loopDetected = true
    return true
  }
  return false
}

/**
 * An external store that keeps emitting while a navigation is pending, standing
 * in for the data-fetching subscriptions apps hold in redirect components.
 */
let tick = 0
const listeners = new Set()
setInterval(() => {
  tick++
  listeners.forEach((listener) => listener())
}, 20)

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function Report() {
  useRouterState()

  return (
    <div style={{ fontFamily: 'monospace', marginTop: 24 }}>
      <div>
        renders of the component holding &lt;Navigate&gt;:{' '}
        <b data-testid="redirect-renders">{stats.redirectRenders}</b>
      </div>
      <div>
        runs of the async destination&apos;s beforeLoad:{' '}
        <b data-testid="before-loads">{stats.targetBeforeLoads}</b>
      </div>
      <div>
        loop detected:{' '}
        <b
          data-testid="loop-detected"
          style={{ color: stats.loopDetected ? 'crimson' : 'green' }}
        >
          {String(stats.loopDetected)}
        </b>
      </div>
      <p style={{ maxWidth: 640, fontFamily: 'sans-serif' }}>
        Expected in every case: one render, and for case 2 one run of the
        destination&apos;s beforeLoad.
      </p>
    </div>
  )
}

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div style={{ padding: 24 }}>
      <h1>&lt;Navigate&gt; re-issues on every render</h1>
      <nav
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginBottom: 16,
        }}
      >
        <Link to="/" onClick={reset}>
          Home
        </Link>
        <Link to="/redirect-router-state" onClick={reset}>
          1. redirect component subscribes to router state
        </Link>
        <Link to="/redirect-external-store" onClick={reset}>
          2. external store emits during a pending navigation
        </Link>
        <Link to="/redirect-function-search" onClick={reset}>
          3. search passed as an updater function
        </Link>
      </nav>
      <div>
        current pathname: <b data-testid="pathname">{pathname}</b>
      </div>
      <hr />
      <Outlet />
      <Report />
    </div>
  )
}

const rootRoute = createRootRoute({ component: RootComponent })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <p style={{ maxWidth: 640 }}>
      Pick a case above. Cases 1 and 3 redirect to <code>/target</code>, which
      has no <code>beforeLoad</code>. Case 2 redirects to{' '}
      <code>/async-target</code>, whose <code>beforeLoad</code> takes 150 ms.
    </p>
  ),
})

/**
 * Case 1: the redirect component subscribes to router state. This is
 * self-sustaining: it needs no external input and no async destination.
 * Issuing the navigation changes router state, which re-renders this
 * component, which re-issues the navigation.
 */
function RedirectViaRouterState() {
  useRouterState()

  if (trackRender()) {
    return <div style={{ color: 'crimson' }}>loop detected, stopped</div>
  }

  return <Navigate to="/target" replace />
}

/**
 * Case 2: an unrelated external store re-renders the component while the
 * navigation is pending. Each re-issue supersedes the in-flight navigation, so
 * the destination's `beforeLoad` is restarted over and over and the navigation
 * never settles. This is the shape that produces unbounded requests.
 */
function RedirectViaExternalStore() {
  useSyncExternalStore(subscribe, () => tick)

  if (trackRender()) {
    return <div style={{ color: 'crimson' }}>loop detected, stopped</div>
  }

  return <Navigate to="/async-target" replace />
}

/**
 * Case 3: `search` passed as an updater function. Inline functions are a fresh
 * value on every render, so comparing the props by value rather than by
 * identity would not fix this one.
 */
function RedirectWithFunctionSearch() {
  useRouterState()

  if (trackRender()) {
    return <div style={{ color: 'crimson' }}>loop detected, stopped</div>
  }

  return <Navigate to="/target" search={(prev) => ({ ...prev })} replace />
}

const routerStateRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/redirect-router-state',
  component: RedirectViaRouterState,
})

const externalStoreRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/redirect-external-store',
  component: RedirectViaExternalStore,
})

const functionSearchRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/redirect-function-search',
  component: RedirectWithFunctionSearch,
})

const targetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/target',
  component: () => <div data-testid="target-content">Target route</div>,
})

const asyncTargetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/async-target',
  beforeLoad: async () => {
    stats.targetBeforeLoads++
    await new Promise((resolve) => setTimeout(resolve, 150))
  },
  component: () => <div data-testid="target-content">Async target route</div>,
})

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    routerStateRedirectRoute,
    externalStoreRedirectRoute,
    functionSearchRedirectRoute,
    targetRoute,
    asyncTargetRoute,
  ]),
})

ReactDOM.createRoot(document.getElementById('app')).render(
  <RouterProvider router={router} />,
)
