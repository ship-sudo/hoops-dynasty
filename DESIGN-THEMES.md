# What makes these games stick

Research into why people put a thousand hours into Football Manager, and what that means for
Hoops Dynasty. Quotes are verbatim from players and from Sports Interactive. Every theme ends with
what we would actually build.

Sources: r/footballmanagergames, Planet Football and cm9798 interviews with Championship Manager
players, Bleacher Report, PC Gamer, Eurogamer, Game Informer, Complex, SportsPro, footballmanager.com.

---

## 1. Attachment to invented people is the whole game

This is the finding. Not tactics, not the match engine — the people.

> "No other game lets you get so invested in a fictional character born in the mid 2020s. What a
> player, I've never seen one that good. Ever." — u/LJRTrains

> "I'll be 89 years old with a stick and if people come to me and say 'Cherno, Championship
> Manager!?' I'll say 'yes that's me son!'" — Cherno Samba, on being a save-file legend

> "The South African winger Lebohang Mofokang that I signed without scouting just because his name
> was funny… They live forever 😭" — u/sebastianinthebushes, on a save he lost years ago

What creates it: a **name** you remember, a player who is **yours** because you found him, and a
**career you watched** rather than read.

**What we build**
- Generated players need real names, not "shot creator 2004-19". A name generator with era- and
  region-appropriate names is small work and is the single highest-leverage change in this document.
- A career page: every season, every team, every milestone, in one place.
- Squad numbers, and the right to retire one.
- "You drafted him" as a permanent, visible fact.

## 2. The youth intake is a ritual, and rituals need a date

> "There's nothing better than youth intake day for Football Manager players." — FM Projects,
> subtitled *Christmas in Football Manager*

> "For me, I treat every player from my intake as 5 stars." — u/Masterfire76

> "Just got a 16yo CB with a 5-star potential… You better bet I'm already planning to sell my
> current best CB in order to not hinder the future captain's development." — u/MrEskola

The mechanism is anticipation on a known date, then a small number of unknown people who are
permanently associated with you.

**What we build**
- Draft night as an event with a build-up: a countdown in the inbox, scouting reports arriving over
  the weeks before, a war room on the night.
- Our draft board already hides the truth behind a scouted range. Lean into it: let scouts be wrong
  in *characterful* ways, and let the user disagree with them.

## 3. Retirement, testimonials and the afterlife

The strongest single mechanism in the corpus, and one almost nobody builds.

> "I stayed at Barca, despite the save becoming a little boring, to ensure he stayed long enough to
> beat Messi's league goalscoring record and to be able to have a testimonial." — u/JWOOD1999

> "My goalkeeper with 1200 apps, 6 goals, retired. And i sadly could not organize a testimonial
> match for him." — u/ObligationOriginal83

> "Love when your players become staff and wind up battling against you. Feels like a
> teacher/student sort of rivalry." — u/KneeDeepInTheDead

People will play a boring save for a season to reach a ceremony the game barely acknowledges.

**What we build**
- A retirement moment: a career summary, where he ranks in franchise history, a jersey in the rafters.
- Franchise records and a hall of fame that his name enters.
- Former players returning as coaches and scouts — and one day running a rival.

## 4. The league must generate stories on its own

> "Man. Its the stories that keep you hooked." — u/sommersj

> "I crafted my own narrative that says he's a grandchild of Andriy and is on a personal mission to
> restore the Shevchenko name amongst Europe's elite." — u/Jimmymott

> "As much as I know that it was just a random event… its hard not to buy into that narrative."
> — u/Bigpapa42_2006

And the rivalry that comes out of a press conference:

> "His response when asked about my comments was 'I don't care what u/SunPraising has to say. I'm
> not here to make friends'. I then proceeded to bad mouth him whenever given the opportunity."

**What we build**
- A news feed that notices things: streaks, career highs, a rookie's first start, a former player
  beating you, a record falling.
- Rival managers with names, tempers and memories.
- Milestones tracked and announced, so the user learns what to care about.

## 5. The AI plays by your rules, with no privileges

> "the computer didn't care that you were managing a team or whether the AI were managing a team —
> both of you have the exact same options and both of you make the same sort of decisions at the
> same time." — Miles Jacobson, Sports Interactive

> "there's no cheating going on, but if you do something wrong you're going to know about" — Jacobson

This is exactly where our game is weakest right now: the AI hands over stars for nothing, never
pays the tax, and lets a manager ride five men 48 minutes a night for free.

**What we build**
- Symmetry as a rule we can test: whatever the user can do, the AI does, and vice versa.
- An AI that values production, defends its stars, and punishes exploits by using them itself.

## 6. Realism is a means to believability, not the goal

> "it's the one area of the game that we actually tone down compared to real life because injuries
> are so hated." — Jacobson, on injuries

> "When you are looking to escape from the real world, if you're then reminded inside the fake
> world that you've gone into, that doesn't do the job that we wanted to do." — Jacobson

> "Whenever you make a change like this, it's actually pretty dangerous… FM is a giant productivity
> tool, right? You spend a lot of time in there." — Jacobson, on changing the UI

**What we build**
- Injuries that matter but do not spite the player: rest days, load management, a medical report.
- Era authenticity as the thing that makes 1998 feel like 1998 — our strongest existing asset.

## 7. Depth must be optional, not mandatory

FM's own analytics showed newcomers quitting within an hour; SI responded with tutorials, six
player personas, and an in-game encyclopedia:

> "If you type 'tactic' into the search bar, we now have a Wikipedia of football within the game
> called Fampedia." — Jacobson

> "You play it any way you want to. I'm not here to dictate how people should play the game."

Our casual play-tester could not tell who his best player was, whether his team was good, or what
had just happened.

**What we build**
- A home screen that answers three questions instantly: are we good, who is our best player, what
  just happened.
- Plain-language explanations of every piece of jargon, in place. Nobody knows what an apron is.
- Sensible automatic behaviour for anything the user has not touched.

## 8. Losing the save is a bereavement

> "I lost a save with 800 hours on it once." — u/sebastianinthebushes

> "One of my biggest regrets is not keeping my FM12 save… I remember all of my players' names but
> lost the save file years ago." — u/Jamie-92

**What we build**
- Saves that never corrupt, never silently truncate, and can be exported to a file the user keeps.
- Multiple save slots and an autosave history, not one rolling slot.

## 9. The features people miss most are the ones that told them no

Research into NBA 2K's franchise modes, twenty years of them, and the communities that still argue
about which year was best. The finding that matters is not a feature list:

> "players had a role (Superstar, Star, Starter, Role Player, Bench Warmer) and it really threw off
> your team morale if they weren't getting the minutes they wanted. **So you couldn't just stack
> your team, since then they'd be unhappy. It made it really challenging.**"

The fondly-remembered mechanic is a rule that refuses you something. The same pattern repeats in
every corpus: scouting fog of war, protected lists in an expansion draft, and — from College Hoops
2K8, the mode most often called the deepest ever made — being sackable:

> "don't feel devastated when you get fired after your first three years… it's part of the fun."

Against that, the two things nobody asks for and everybody resents are **concession pricing** and
**fitness schedules**:

> "What GM is setting prices for the concessions stands?? Why do I have a Team Gov if I'm
> responsible for all their responsibilities."

> "why do I employ a fitness staff if I have to make all the players fitness schedules."

**The rule this gives us:** if the club employs someone to do a job, the default is that he does it,
and the user may override. Depth is constraint, not chores.

### What ends a save

Three named failure modes, each with years of threads behind it: stat drift after about five
seasons, eight-seeds reaching the Finals every year, and AI clubs that never trade with each other.
An entire third-party slider economy exists to patch the first two. We have already fixed the third
and measured the second; the first is the one to keep watching.

### On narrative

People are not anti-story. They are anti-coercion and anti-inconsistency. The loudest complaint
about 2K18's MyGM was not that it had a story — it was that the story stopped after year one, and
that it broke the game's own rules:

> "the owner demands a trade for a player I literally cannot trade for because of the 60 Day Rule"

So: events every season, never only the first; events that never move your roster without you; and
events bound by the rules the rest of the game obeys.

---

# The backlog this implies

Ordered by how much illusion each buys per unit of work. Bugs come first — a broken world cannot
hold anyone's attention.

## Now: the world has to work
1. **Rotation, fatigue and injuries.** Rodman at 2.9 minutes, nobody over 35, no one ever hurt, and
   a free 48-minute exploit that wins 8 championships out of 8. *In progress.*
2. **The economy.** Stars are negative trade assets, offering more money loses a free agent, the
   luxury tax is never billed, league payroll halves every year. *In progress.*
3. **The interface.** Columns off the panel, raw team ids, jargon with no explanation. *In progress.*
4. ~~CBA rules frozen at the starting season~~ — done.
5. ~~A quarter of every draft class retiring on draft night~~ — done.
6. ~~Invented players taking 19 of the top 20 scoring places by year six~~ — done.

## Next: the people
7. **Real names for generated players.** The cheapest large win in this document.
8. **Career pages and franchise history.** Every season a player has played, every record he holds.
9. **Retirement ceremonies, retired numbers, a hall of fame.**
10. **A news feed that notices things** — streaks, milestones, first starts, records.

## Then: the world around the team
11. **An owner with expectations, and a job you can lose.** The research is unambiguous that being
    sackable is a feature, not a punishment.
11b. **Player roles and morale** — the single most-missed mechanic in twenty years of 2K. A role
    (star, starter, rotation, bench) that a player expects you to honour, and unhappiness when you
    do not, is what stops a squad being stacked without consequence.
12. **Rival managers with names and memories.**
13. **Staff: coaches, scouts, trainers, and former players who become them.**
14. **Morale, roles and locker-room reaction.**

## Later
15. Expansion teams. 16. In-season signings. 17. Multi-team trades. 18. A proper scouting department
with assignments. 19. Season review and awards night. 20. Statistical leaderboards, all-time.
