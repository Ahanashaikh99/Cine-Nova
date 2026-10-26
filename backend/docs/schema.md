# Firestore Data Model

## users
Doc ID: Firebase Auth `uid`

| Field | Type | Notes |
|---|---|---|
| email | string | |
| displayName | string | |
| createdAt | timestamp | |

Example:
```json
{ "email": "simran@example.com", "displayName": "Simran", "createdAt": "2026-10-26T12:00:00Z" }
```

## favorites
Doc ID: `{uid}_{tmdbId}` (prevents duplicate favorites)

| Field | Type | Notes |
|---|---|---|
| userId | string | Auth uid of the owner |
| tmdbId | number | ID from TMDb |
| mediaType | string | "movie" or "tv" |
| title | string | Stored copy so we don't re-call TMDb |
| posterPath | string | TMDb poster path |
| addedAt | timestamp | |

## reviews
Doc ID: auto-generated

| Field | Type | Notes |
|---|---|---|
| userId | string | Auth uid of the author |
| userName | string | Stored copy for display |
| tmdbId | number | |
| mediaType | string | "movie" or "tv" |
| rating | number | 1-10 |
| text | string | |
| createdAt | timestamp | |

## Common queries
- A user's favorites: `favorites where userId == uid`
- Reviews for a title: `reviews where tmdbId == X and mediaType == Y`, ordered by `createdAt desc`
- A user's reviews: `reviews where userId == uid`