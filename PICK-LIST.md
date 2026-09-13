# What we could build next — pick from this

Everything here comes out of the research: twenty years of NBA 2K franchise players, Football
Manager's community, and the developers of both. Quotes are verbatim. Each item says what it is,
why people want it, and roughly what it costs to build.

Pick by number. You do not have to take them in order.

---

## The finding that should shape the choice

The features people miss most are **the ones that told them no.**

> "players had a role (Superstar, Star, Starter, Role Player, Bench Warmer) and it really threw off
> your team morale if they weren't getting the minutes they wanted. **So you couldn't just stack
> your team, since then they'd be unhappy. It made it really challenging.**"

And the inverse — the two things nobody asks for and everybody resents:

> "What GM is setting prices for the concessions stands?? Why do I have a Team Gov if I'm
> responsible for all their responsibilities."

> "why do I employ a fitness staff if I have to make all the players fitness schedules."

So: constraints, yes. Chores, no. If the club employs someone to do a job, he does it by default.

---

# A. Constraints — the things that tell you no

### A1. Player roles and morale  ·  *most-missed mechanic in twenty years of 2K*
Every player expects a role — star, starter, rotation, bench — based on what he is and what he is
paid. Give him less and he is unhappy; unhappiness costs you on the floor and in the summer. This
is what stops you stacking a super-team without consequence.
**Cost:** medium. Roles derive from the ratings and contracts we already have; morale needs a new
per-player number and a hook into the engine and free agency.

### A2. An owner with expectations, and the sack
A target at the start of each season — win now, develop youth, cut payroll — and consequences for
missing it. From the deepest basketball franchise mode ever made:
> "don't feel devastated when you get fired after your first three years… it's part of the fun."
**Cost:** medium. Needs an owner model, a patience meter, and an end state for the save.

### A3. Scouting that must be paid for
Today every prospect is scouted equally well. Instead: scouting hours you spend where you choose,
so a board you have not worked is genuinely foggy. This is what makes draft night a decision.
**Cost:** small-medium. The fog already exists; this makes it something you manage.

### A4. Roster rules with teeth
Two-way contracts, a hard 15-man limit enforced at every point, protected lists in an expansion
draft, and trade deadlines that actually close.
**Cost:** small, mostly rules we already model but do not enforce everywhere.

---

# B. People — attachment, which is what keeps anyone playing

### B1. Finish the coaching staff  ·  *3,000 lines already written, unfinished*
Head coach, offensive and defensive assistants, a development coach and a head scout. Each with
ratings that do something real: development speed, scouting accuracy, rotation quality. Hire and
fire, a carousel where sacked coaches resurface, and retired players entering the pool.
**Cost:** small now — it needs finishing and testing, not starting.

### B2. Retired numbers, testimonials, club legends
> "I stayed at Barca, despite the save becoming a little boring, to ensure he stayed long enough to
> beat Messi's league goalscoring record and to be able to have a testimonial."
We have careers, records and a hall of fame. This is the ceremony on top: a jersey in the rafters,
a number nobody else may wear, a one-club man marked for good.
**Cost:** small. The data is all there.

### B3. Player personalities
A man who wants the ball, a man who wants to win, a professional, a problem. It changes what he
asks for in a contract, how he reacts to his role, and whether he stays.
**Cost:** medium. Feeds A1 directly.

### B4. Former players become your coaches
Draft a man, watch his career, hire him twenty years later, lose to him when he takes another job.
> "Love when your players become staff and wind up battling against you. Feels like a
> teacher/student sort of rivalry."
**Cost:** small once B1 lands.

---

# C. The league feels alive

### C1. Recaps of the rest of the league
Not a newspaper — the attested version, from ESPN NBA 2K5, is auto-generated highlights and recaps
of other people's games. Who went off last night, which contender is falling apart.
**Cost:** small. We already generate the games; this reads them.

### C2. Rival managers with names and memories
A coach who says something about you in the press, and remembers what you said back.
> "I proceeded to bad mouth him whenever given the opportunity. I was determined to make this man
> hate even just the thought of me passing through his mind."
**Cost:** medium.

### C3. Award ceremonies and a season review
An end-of-season night: awards handed out, All-NBA teams named, your season graded.
**Cost:** small-medium.

### C4. In-season signings and the buyout market
You cannot currently replace an injured player in January. Real teams do.
**Cost:** small-medium.

---

# D. Depth in the front office

### D1. Multi-team trades and pick swaps
Removed from 2K and missed ever since; restored in 2K27 to applause.
**Cost:** medium.

### D2. A draft board you build
> "When drafting, a simple draft board would improve the game immensely. I hate not knowing who is
> available to trade up or down for. They had the feature in every year up to 11."
Your own ranking, separate from the scouts', plus trading up and down on the night.
**Cost:** medium.

### D3. A G League / development assignments
> "The d-league was great for evaluating young players and giving them a place to play while
> keeping them in your team system."
**Cost:** medium.

### D4. Expansion teams and relocation
Found a franchise, run an expansion draft with protected lists, move a club.
**Cost:** large.

---

# E. Presentation and feel

### E1. The playing-style screen  ·  *being built now*
Starting five by position, named offensive systems, per-player instructions, and a minutes budget
that will not let you over 240.

### E2. Play a game rather than sim it
A live game view: quarter by quarter, timeouts, a run against you, the decision to call one.
**Cost:** large, and the highest-ceiling item on this page.

### E3. Team identity
Logos, courts, a colour scheme you can change, jerseys.
**Cost:** medium, mostly asset work.

### E4. Season objectives on the home screen
What you are chasing, how far along you are, what the owner thinks today.
**Cost:** small, and it makes A2 visible.

### E5. A narration layer, optionally powered by a language model
Everything in this game is deterministic and offline, and the simulation should stay that way. But
the *writing* — rumours, press conferences, retirement pieces, a season review — is templates, and
after a couple of hundred hours the seams show.

The shape that works: a switch, off by default, where a model rewrites text the simulation has
already decided and never chooses anything itself. Templates remain the fallback, so a missing key,
a rate limit or a failed request costs nothing. The research is blunt about the failure mode —
people forgive a thin story and never forgive one that contradicts the game's own rules, like 2K's
owner demanding a trade for a player the 60-day rule made untradeable. So the model gets handed the
facts and is forbidden to invent any.

Worth it for: a rival manager who remembers what you said, a beat writer with a voice, a piece
about a player the game has watched for fifteen years.
**Cost:** medium. The risk is not technical, it is that cheap output reads worse than a good
template — so the bar is "better than what we already write", measured by reading it.

---

# F. Keeping the simulation honest

These are not features, they are what stops a save rotting. Named by 2K players as what ends a save.

### F1. Scoring drift  ·  *measured today, mild*
Twelve simulated seasons from 2003-04: league scoring rose 92.5 → 96.9 a game, and the league's
best rebounder fell 14.9 → 11.4. Not catastrophic, but it is drift and it compounds.
**Cost:** small-medium to investigate and pin.

### F2. Playoff upsets
> "every year in the playoffs, there will be random 7- and 8-seeds getting to the conference finals"
Ours currently go the other way: the best team wins too often. Measured, not yet tuned.
**Cost:** small.

### F3. An era-aware injury model
1998 really had 51 players go 82-for-82; 2024 had 17. Ours is era-flat.
**Cost:** small.

---

## My recommendation, if you want one

**A1 (roles and morale) + B1 (finish the coaches) + A2 (an owner who can sack you).**

That trio turns the game from a spreadsheet you operate into a job you can lose. It is also the
combination the research points at hardest: a constraint that stops you stacking, a staff that does
work for you, and a reason any of it matters.

Then **B2 and C1** — cheap, and they are what make a save feel like it has a history.
