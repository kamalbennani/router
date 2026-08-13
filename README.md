# `<Navigate>` re-issues its navigation on every render

Minimal reproduction for TanStack Router.
Pinned to `@tanstack/react-router@1.170.27`.

## Run

```sh
npm install
npm run dev
```

Open the dev server URL and click through the three cases.

## What you should see

| Case | Renders of the component holding `<Navigate>` | Destination `beforeLoad` runs | Loop |
| --- | --- | --- | --- |
| 1. subscribes to router state | 26 | n/a | yes |
| 2. external store emits during a pending navigation | 32 | 25 | yes |
| 3. `search` as an updater function | 26 | n/a | yes |

Expected is one render in every case, and one `beforeLoad` run in case 2.

The page stops rendering `<Navigate>` after 25 renders so the tab stays usable. Without that stop none of these terminate: raise `MAX_RENDERS` in `src/main.jsx` to 100000 and case 1 reaches 100001 renders in under half a second.

## Why it happens

`Navigate` guards its navigation on an identity check against the props object:

```js
const previousPropsRef = React.useRef(null)
useLayoutEffect(() => {
  if (previousPropsRef.current !== props) {
    navigate(props)
    previousPropsRef.current = props
  }
}, [router, props, navigate])
```

React allocates a fresh props object on every render, so `previousPropsRef.current !== props` is always true and the guard has never prevented anything. `Navigate` re-issues its navigation on every render.

That only becomes observable when the component rendering `<Navigate>` re-renders. The three cases are the realistic ways that happens.

**Case 1** is self-sustaining and needs nothing else - no external input, and no async destination. Issuing the navigation changes router state, which re-renders a component subscribed to that state, which re-issues the navigation. The destination here has no `beforeLoad` at all. The cost is unbounded render churn.

**Case 2** is the one that hurts in production. An unrelated subscription re-renders the component while the navigation is pending, and each re-issue supersedes the in-flight navigation, so the destination's `beforeLoad` is restarted over and over: 25 runs in the sample above, and it never settles. In our app that was a data-fetching client and 4511 requests before the tab died.

**Case 3** shows that comparing the props by value rather than by identity would not be sufficient either. `search` and `params` accept updater functions, which are usually declared inline and so are a fresh value on every render too.

## Not a regression

Case 1 behaves identically on:

| Version | Renders | Loop |
| --- | --- | --- |
| 1.131.7 | 26 | yes |
| 1.136.17 | 26 | yes |
| 1.136.18 | 26 | yes |
| 1.170.27 | 26 | yes |

1.136.17 and 1.136.18 straddle #5905, which moved this effect from `React.useEffect` to `useLayoutEffect`. The numbers are identical either side, so that change is not the cause. The defect predates 1.131.7.

## Note on the other adapters

`packages/solid-router` and `packages/vue-router` run the navigation in `onMount` / `onMounted`, so they issue it once and never re-issue. React's `Navigate` is the only adapter that re-issues, and the presence of the guard suggests the once-only semantics were intended there too.
