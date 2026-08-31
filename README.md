# CFB Betting Model

A college football analytics tool that compares a power-rating-based model against
sportsbook lines to surface games worth a closer look. Separate project from Cavepicks.

## What's in this project so far

- `prisma/schema.prisma` — the full database blueprint (teams, games, lines, weather,
  injuries, model predictions, situational flags, picks).
- `lib/nameMatching.ts` — the team-name-matching logic. Fixes the class of bug we hit
  in Cavepicks (a name like "Louisiana" incorrectly matching "Louisiana Tech Bulldogs").
- `scripts/matchTeamAliases.ts` — pulls team names from CFBD, The Odds API, and ESPN,
  and matches them all against one canonical team list.

We are deliberately doing the alias-matching step FIRST, before any of the "nitty
gritty" (predictions, flags, weather, etc.), because every other table in the schema
depends on team identity being correct.

## Setup — step by step

### 1. Create a Neon database
- Go to https://neon.tech, sign up free, create a new project.
- Copy the connection string it gives you (starts with `postgresql://`).

### 2. Get your API keys
- **CFBD**: go to https://collegefootballdata.com/key, request a free key (arrives by email).
- **The Odds API**: go to https://the-odds-api.com, sign up for a free key.
  **Use a brand new account for this** — don't reuse the Cavepicks key, since they'd
  share the same monthly credit limit.

### 3. Set up your environment file
- In this project folder, copy `.env.example` to a new file named `.env`.
- Paste your Neon connection string into `DATABASE_URL`.
- Paste your CFBD key into `CFBD_API_KEY`.
- Paste your new Odds API key into `ODDS_API_KEY`.

### 4. Install dependencies
In a terminal, inside this project folder, run:
```
npm install
```

### 5. Create the database tables
This reads `prisma/schema.prisma` and creates all the tables in your Neon database:
```
npx prisma migrate dev --name init
```

### 6. Run the alias-matching script
This is the step we agreed to do first:
```
npm run match-aliases
```
It will print a summary at the end. If anything says "needs review," that means the
script found a team name it couldn't confidently match — those are worth looking at
together before we build anything on top of them.

## What happens after this

Once the alias table is clean, the next pieces (in order) are:
1. Pull weekly SP+ ratings + schedule from CFBD
2. Pull and snapshot betting lines from The Odds API
3. Build the spread prediction model
4. Add situational flags (lookahead, letdown, short week, etc.)
5. Add weather + injuries
6. Build the totals model

We'll tackle these one at a time, the same way we did the schema.
