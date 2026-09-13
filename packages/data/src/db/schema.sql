-- Normalised database. One row per fact. Seasons keyed by the year they end (1998 = 1997-98).
-- Source columns say where a row came from: 'nba' (stats.nba.com), 'bref' (basketball-reference-derived
-- open dataset), 'wayback', 'era' (hand-curated), 'inferred'.

CREATE TABLE IF NOT EXISTS seasons (
  year_end INTEGER PRIMARY KEY,
  season_id TEXT NOT NULL,          -- '1997-98'
  games INTEGER NOT NULL,
  teams INTEGER NOT NULL,
  rules_json TEXT NOT NULL,         -- EraRules as JSON (cap, tax, aprons, playoff format, lottery, flags)
  shooting_json TEXT                -- league shot mix and FG% by zone from bref Player Shooting, FGA-weighted
);

CREATE TABLE IF NOT EXISTS team_seasons (
  year_end INTEGER NOT NULL,
  team_id TEXT NOT NULL,            -- NBA team id as text, stable across moves
  abbr TEXT NOT NULL,               -- that season's abbreviation
  bref_abbr TEXT,                   -- basketball-reference abbreviation, may differ (e.g. CHO/CHA, BRK/BKN)
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  conference TEXT NOT NULL,         -- 'East' | 'West'
  division TEXT NOT NULL,
  wins INTEGER, losses INTEGER,
  playoff_seed INTEGER,
  stats_json TEXT,                  -- team totals + advanced (pace, ortg, drtg, 3PAr, FTr, TOV%, ORB%) as JSON
  PRIMARY KEY (year_end, team_id)
);

CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,       -- canonical id: NBA person id as text when known
  bref_id TEXT,                     -- basketball-reference slug
  name TEXT NOT NULL,
  birth_date TEXT,                  -- ISO date
  height_in INTEGER,
  weight_lb INTEGER,
  pos TEXT,                         -- primary position from the latest season
  draft_year INTEGER, draft_round INTEGER, draft_pick INTEGER,
  from_year INTEGER, to_year INTEGER, -- year_end of first and last NBA season (career span)
  hof INTEGER NOT NULL DEFAULT 0,
  country TEXT, college TEXT
);
CREATE INDEX IF NOT EXISTS players_bref ON players(bref_id);
CREATE INDEX IF NOT EXISTS players_name ON players(name);

-- Cross-source id links and how confident the match is.
CREATE TABLE IF NOT EXISTS id_map (
  nba_id TEXT, bref_id TEXT, name TEXT NOT NULL,
  method TEXT NOT NULL,             -- 'exact' | 'name_season_team' | 'manual' | 'unmatched'
  PRIMARY KEY (nba_id, bref_id)
);

-- One row per player per team stint per season. TOT rows are not stored; sum stints.
CREATE TABLE IF NOT EXISTS player_seasons (
  year_end INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  stint INTEGER NOT NULL DEFAULT 1, -- 1 = first team that season
  season_type TEXT NOT NULL DEFAULT 'regular', -- 'regular' | 'playoffs'
  age INTEGER, pos TEXT,            -- pos: bref PG/SG/SF/PF/C when matched, else the NBA roster string ('G-F')
  years_pro INTEGER,                -- seasons before this one: roster EXP, else bref experience - 1
  gp INTEGER, gs INTEGER, min REAL,
  totals_json TEXT NOT NULL,        -- box totals
  per100_json TEXT,                 -- per-100-possession line (NBA, season-level)
  advanced_json TEXT,               -- NBA advanced (season-level) plus a `bref` block (PER/BPM/WS/pct)
  shooting_json TEXT,               -- zone distribution and pct (bref Player Shooting, season-level)
  pbp_json TEXT,                    -- position shares, on-court net, fouls, turnover types (bref Play By Play)
  PRIMARY KEY (year_end, player_id, team_id, stint, season_type)
);
CREATE INDEX IF NOT EXISTS ps_season ON player_seasons(year_end);
CREATE INDEX IF NOT EXISTS ps_player ON player_seasons(player_id);

CREATE TABLE IF NOT EXISTS games (
  game_id TEXT PRIMARY KEY,         -- NBA game id
  year_end INTEGER NOT NULL,
  date TEXT NOT NULL,
  season_type TEXT NOT NULL,        -- 'regular' | 'playin' | 'playoffs'
  home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL,
  home_pts INTEGER NOT NULL, away_pts INTEGER NOT NULL,
  home_box_json TEXT, away_box_json TEXT  -- team box lines
);
CREATE INDEX IF NOT EXISTS games_season ON games(year_end, season_type);

-- Player game logs: minutes per game feed the calibration harness and opening-night rosters.
CREATE TABLE IF NOT EXISTS player_games (
  game_id TEXT NOT NULL, player_id TEXT NOT NULL, team_id TEXT NOT NULL,
  year_end INTEGER NOT NULL, season_type TEXT NOT NULL,
  min REAL, pts INTEGER, fgm INTEGER, fga INTEGER, fg3m INTEGER, fg3a INTEGER, ftm INTEGER, fta INTEGER,
  oreb INTEGER, dreb INTEGER, ast INTEGER, stl INTEGER, blk INTEGER, tov INTEGER, pf INTEGER,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS pg_season ON player_games(year_end, team_id);
CREATE INDEX IF NOT EXISTS pg_player ON player_games(year_end, player_id);

CREATE TABLE IF NOT EXISTS playoff_series (
  year_end INTEGER NOT NULL, round INTEGER NOT NULL, -- 1 first round … 4 finals
  high_team_id TEXT NOT NULL, low_team_id TEXT NOT NULL,
  winner_team_id TEXT NOT NULL, high_wins INTEGER NOT NULL, low_wins INTEGER NOT NULL,
  PRIMARY KEY (year_end, round, high_team_id)
);

CREATE TABLE IF NOT EXISTS draft_picks (
  draft_year INTEGER NOT NULL,      -- calendar year of the draft (2003 draft precedes 2003-04)
  round INTEGER NOT NULL, pick INTEGER NOT NULL, overall INTEGER NOT NULL,
  team_id TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL,
  college TEXT,
  PRIMARY KEY (draft_year, overall)
);

CREATE TABLE IF NOT EXISTS salaries (
  year_end INTEGER NOT NULL, player_id TEXT NOT NULL, team_id TEXT,
  amount INTEGER NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (year_end, player_id, source)
);

-- Contract as known on opening night of year_end. Years are amounts from that season forward.
CREATE TABLE IF NOT EXISTS contracts (
  year_end INTEGER NOT NULL, player_id TEXT NOT NULL, team_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'standard', -- 'standard' | 'rookie_scale' | 'minimum' | 'two_way' | 'ten_day'
  years_json TEXT NOT NULL,         -- [{year_end, amount, option: null|'player'|'team'|'early_termination', guaranteed}]
  source TEXT NOT NULL,             -- 'wayback' | 'inferred' | 'bref_current'
  PRIMARY KEY (year_end, player_id)
);

CREATE TABLE IF NOT EXISTS awards (
  year_end INTEGER NOT NULL, award TEXT NOT NULL, -- 'MVP','ROY','DPOY','SMOY','MIP','COY','All-NBA','All-Defensive','All-Rookie','All-Star','Finals MVP'
  recipient TEXT NOT NULL,                       -- player_id for players, name for coaches (COY)
  player_id TEXT, team_rank INTEGER,             -- 1/2/3 for All-NBA style teams
  share REAL,                                    -- vote share where known
  PRIMARY KEY (year_end, award, recipient)
);

CREATE TABLE IF NOT EXISTS coaches (
  year_end INTEGER NOT NULL, team_id TEXT NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL,                            -- 'Head Coach' | 'Assistant Coach' | ...
  PRIMARY KEY (year_end, team_id, name)
);

CREATE TABLE IF NOT EXISTS injuries (
  year_end INTEGER NOT NULL, player_id TEXT NOT NULL, start_date TEXT NOT NULL,
  games_missed INTEGER, note TEXT,
  PRIMARY KEY (year_end, player_id, start_date)
);

CREATE TABLE IF NOT EXISTS pipeline_gaps (
  year_end INTEGER, table_name TEXT NOT NULL, reason TEXT NOT NULL
);

-- Season-end roster snapshot from commonteamroster. Feeds the opening-night rule for zero-game players,
-- raw positions ('G-F'), jersey, experience and how_acquired (null through 2008-09).
CREATE TABLE IF NOT EXISTS rosters (
  year_end INTEGER NOT NULL, team_id TEXT NOT NULL, player_id TEXT NOT NULL,
  jersey TEXT, pos TEXT, height_in INTEGER, weight_lb INTEGER, birth_date TEXT,
  age INTEGER, experience INTEGER, school TEXT, how_acquired TEXT,
  PRIMARY KEY (year_end, team_id, player_id)
);
CREATE INDEX IF NOT EXISTS rosters_player ON rosters(player_id);
