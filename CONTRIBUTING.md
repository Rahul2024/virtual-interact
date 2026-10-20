# Contributing

The city is built by the people in it. There is no roadmap handed down from
above: people say what they want the place to have, and people pick those
ideas up and build them. This file is the whole process.

## The loop

```
  post an idea  →  people vote and talk  →  someone says "I'll build this"
       ↑                                              ↓
  "what next?"  ←  it ships, credit on the wall  ←  build it (alone or as a team)
```

It runs in two places that mirror each other:

| | In the world | On GitHub |
| --- | --- | --- |
| Post | Walk to the **Idea Wall** by the plaza, press `E`, write one line | Open an **Idea** issue (template provided) |
| Vote | ▲ on the wall | 👍 on the issue |
| Claim | "I'll build this" button; several people can | Comment **"I'll build this"**; the bot labels it `claimed` and assigns you |
| Team up | "Join the builders" | Comment the same; everyone who does is assigned |
| Step back | "Leave the build" | Comment **"I'm out"** |
| Ship | "Mark built" | Merge a PR whose description says `closes #N`; the bot labels it `built` |

Ideas posted in the world are the raw material; the ones that need code become
GitHub issues (a maintainer or the builder copies it over and links back).

## Labels

- `idea` — anything posted through the Idea template
- `up for grabs` — nobody is building it yet
- `claimed` — someone is on it (see assignees)
- `built` — shipped
- `good first build` — small and self-contained, good for a first contribution

## Building something

1. Comment "I'll build this" on the issue so others know. If someone already
   has, join them: a second pair of hands is welcome, and the issue thread is
   where you coordinate.
2. Fork, branch, `npm install`, `npm run dev`. The README has the layout.
3. Keep PRs focused on the idea. If you find something else to fix, that is
   its own PR.
4. Open the PR with `closes #N` in the description. CI runs typecheck, build
   and tests; a maintainer reviews within a few days.
5. When it merges, you are on the credits. Pick the next one.

## What goes where

- **A new place, activity or game** → a plug-in (coming in SDK v0.1) or, for
  now, a folder under `packages/client/src/world/` plus any room logic under
  `packages/world-server/src/rooms/`.
- **A change to how everyone moves or interacts** → open a short design note
  in the issue first; these touch everyone.
- **Core (networking, voice, avatars)** → talk to a maintainer in the issue
  before starting; happy to pair.

## Conduct

Be kind, assume good faith, and make the place better for the next person. The
moderators who run the in-world report queue also enforce this here.
