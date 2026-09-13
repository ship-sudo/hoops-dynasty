// Names for invented players.
//
// This is the cheapest large win in DESIGN-THEMES.md. The research is unambiguous: attachment to
// invented people is what keeps anyone playing these games for years, and the anchor is a NAME.
// People quote their favourites a decade after losing the save file — "the South African winger
// Lebohang Mofokang that I signed without scouting just because his name was funny". Nobody has
// ever felt that about "shot creator 2004-19".
//
// Two things matter and neither is a big list:
//   1. The name must sound like it belongs to the league it appears in. An NBA draft class is
//      mostly American, with a foreign share that grows steeply from the late nineties on.
//   2. Names must not repeat inside a league, because two Marcus Websters is worse than none.
//
// These pools are invented, deliberately generic, and hold no real player's full name by design.

import type { Rng } from '@hoops/core'

/** Where a generated player is from. The mix shifts by era. */
export type Origin = 'us' | 'europe' | 'africa' | 'latin' | 'balkan' | 'oceania'

const US_FIRST = [
  'Marcus',
  'Andre',
  'Devin',
  'Tyrese',
  'Jalen',
  'Cameron',
  'Darius',
  'Trevor',
  'Isaiah',
  'Malik',
  'Brandon',
  'Terrance',
  'Damon',
  'Corey',
  'Dominic',
  'Elijah',
  'Xavier',
  'Jared',
  'Keenan',
  'Marquis',
  'Donnell',
  'Rashad',
  'Tyler',
  'Jamal',
  'Preston',
  'Quentin',
  'Reggie',
  'Sterling',
  'Trey',
  'Desmond',
  'Amari',
  'Khalil',
  'Zion',
  'Jaylen',
  'Kendrick',
  'Lamont',
  'Bryce',
  'Cedric',
  'Darnell',
  'Everett',
  'Garrett',
  'Hollis',
  'Jermaine',
  'Kelvin',
  'Lorenzo',
  'Maurice',
  'Nolan',
  'Otis',
  'Pierre',
  'Quinton',
  'Raheem',
  'Solomon',
  'Tariq',
  'Vernon',
  'Wendell',
  'Zachary',
]
const US_LAST = [
  'Whitfield',
  'Carraway',
  'Dunlap',
  'Ellington',
  'Fairchild',
  'Grier',
  'Hollins',
  'Ivey',
  'Jessup',
  'Kearse',
  'Ledbetter',
  'Mabry',
  'Nesbitt',
  'Ogletree',
  'Pettiford',
  'Quarles',
  'Rucker',
  'Shockley',
  'Tillman',
  'Upshaw',
  'Vaughan',
  'Waddell',
  'Yeargin',
  'Ziegler',
  'Bledsoe',
  'Coley',
  'Darden',
  'Eubanks',
  'Forbes',
  'Gaddy',
  'Hargrove',
  'Ingle',
  'Jeter',
  'Kilgore',
  'Lassiter',
  'Mixon',
  'Nickens',
  'Overton',
  'Pinckney',
  'Rountree',
  'Stackhouse',
  'Threadgill',
  'Vance',
  'Weatherspoon',
  'Yandell',
  'Ashby',
  'Bramlett',
  'Chatman',
  'Dupree',
  'Easley',
  'Fennell',
  'Gainey',
  'Halsey',
  'Isley',
  'Jarrell',
  'Kimbrough',
  'Lyles',
]
const EURO_FIRST = [
  'Matthias',
  'Lukas',
  'Tomas',
  'Andrei',
  'Pieter',
  'Emil',
  'Kasper',
  'Janne',
  'Rasmus',
  'Bastien',
  'Mattéo',
  'Nicolò',
  'Federico',
  'Joaquín',
  'Arnau',
  'Lennart',
  'Wouter',
  'Sebastián',
  'Dmitri',
  'Aleksei',
  'Gustav',
  'Henrik',
  'Iván',
  'Klaas',
  'Marek',
  'Ondrej',
  'Ruben',
  'Stefan',
  'Vilmos',
]
const EURO_LAST = [
  'Van Dijken',
  'Lehtinen',
  'Bergqvist',
  'Dupont',
  'Moreau',
  'Fiorentino',
  'Marchetti',
  'Álvarez',
  'Cabrera',
  'Wagner',
  'Brandt',
  'Hoffmann',
  'Novák',
  'Dvorak',
  'Kowalczyk',
  'Zielinski',
  'Antonov',
  'Volkov',
  'Lindqvist',
  'Aalto',
  'Rasmussen',
  'De Smet',
  'Janssens',
  'Bianchi',
  'Esposito',
  'Ferreira',
  'Sørensen',
  'Haugen',
  'Virtanen',
  'Szabó',
]
const BALKAN_FIRST = [
  'Nikola',
  'Vlade',
  'Dragan',
  'Milos',
  'Bojan',
  'Luka',
  'Stipe',
  'Ante',
  'Zoran',
  'Goran',
  'Marko',
  'Dusan',
  'Ivan',
  'Petar',
  'Filip',
  'Uros',
  'Vasilije',
  'Aleksandar',
]
const BALKAN_LAST = [
  'Radovic',
  'Perisic',
  'Jankovic',
  'Milosavljevic',
  'Tomic',
  'Vukovic',
  'Babic',
  'Kovacevic',
  'Stankovic',
  'Lukic',
  'Pavlovic',
  'Simic',
  'Kralj',
  'Hrvoje',
  'Matic',
  'Zivkovic',
  'Bogdanic',
]
const AFRICAN_FIRST = [
  'Cheikh',
  'Amadou',
  'Ousmane',
  'Ibrahima',
  'Bismack',
  'Serge',
  'Emeka',
  'Chinedu',
  'Kofi',
  'Kwame',
  'Lebohang',
  'Thabo',
  'Sipho',
  'Mamadou',
  'Boubacar',
  'Yakubu',
  'Obinna',
  'Tendai',
]
const AFRICAN_LAST = [
  'Diallo',
  'Ndiaye',
  'Traoré',
  'Okonkwo',
  'Adeyemi',
  'Mensah',
  'Owusu',
  'Mofokeng',
  'Dlamini',
  'Nkemdiche',
  'Camara',
  'Keita',
  'Sowande',
  'Achebe',
  'Mugabo',
  'Nwosu',
  'Bakayoko',
]
const LATIN_FIRST = [
  'Rafael',
  'Diego',
  'Emiliano',
  'Santiago',
  'Thiago',
  'Mateo',
  'Bruno',
  'Nicolás',
  'Gustavo',
  'Leandro',
  'Rodrigo',
  'Andrés',
  'Facundo',
  'Joaquim',
  'Eduardo',
]
const LATIN_LAST = [
  'Barbosa',
  'Nogueira',
  'Herrera',
  'Quintana',
  'Salazar',
  'Varela',
  'Cardoso',
  'Ibarra',
  'Mendoza',
  'Peralta',
  'Reyes',
  'Zamora',
  'Fonseca',
  'Duarte',
  'Escobar',
]
const OCEANIA_FIRST = [
  'Jarrah',
  'Beau',
  'Callum',
  'Riley',
  'Tane',
  'Hemi',
  'Lachlan',
  'Darcy',
  'Kai',
  'Marley',
]
const OCEANIA_LAST = [
  'Whitlam',
  'Barrenger',
  'Kaitoa',
  'Whanau',
  'Mullane',
  'Redfern',
  'Thurston',
  'Ngata',
  'Caldwell',
  'Bramble',
]

const POOLS: Record<Origin, { first: readonly string[]; last: readonly string[] }> = {
  us: { first: US_FIRST, last: US_LAST },
  europe: { first: EURO_FIRST, last: EURO_LAST },
  balkan: { first: BALKAN_FIRST, last: BALKAN_LAST },
  africa: { first: AFRICAN_FIRST, last: AFRICAN_LAST },
  latin: { first: LATIN_FIRST, last: LATIN_LAST },
  oceania: { first: OCEANIA_FIRST, last: OCEANIA_LAST },
}

/**
 * The foreign share of the league, by season. About 10% in 1998, about 30% by the mid-2020s —
 * roughly the real curve, and the reason a 2024 draft class should not sound like a 1998 one.
 */
export function foreignShare(yearEnd: number): number {
  if (yearEnd <= 1998) return 0.1
  if (yearEnd >= 2025) return 0.3
  return 0.1 + ((yearEnd - 1998) / (2025 - 1998)) * 0.2
}

/** Pick where a player is from, given the season. */
export function pickOrigin(yearEnd: number, rng: Rng): Origin {
  if (!rng.chance(foreignShare(yearEnd))) return 'us'
  // Within the foreign share: Europe leads, then the Balkans and Africa, then the rest.
  const weights: [Origin, number][] = [
    ['europe', 0.38],
    ['balkan', 0.22],
    ['africa', 0.18],
    ['latin', 0.14],
    ['oceania', 0.08],
  ]
  const roll = rng.next()
  let acc = 0
  for (const [origin, w] of weights) {
    acc += w
    if (roll <= acc) return origin
  }
  return 'europe'
}

/**
 * A name generator for one league. Keep one per save: it remembers what it has handed out, so no
 * two players share a name, and a name you remember belongs to exactly one man.
 */
export class NameBank {
  private readonly used = new Set<string>()

  /** Reserve the names a league already contains, so invented players never collide with them. */
  reserve(names: Iterable<string>): void {
    for (const n of names) this.used.add(n.toLowerCase())
  }

  next(yearEnd: number, rng: Rng): string {
    const origin = pickOrigin(yearEnd, rng)
    const pool = POOLS[origin]
    for (let attempt = 0; attempt < 40; attempt++) {
      const first = pool.first[rng.int(pool.first.length)] as string
      const last = pool.last[rng.int(pool.last.length)] as string
      const name = `${first} ${last}`
      if (!this.used.has(name.toLowerCase())) {
        this.used.add(name.toLowerCase())
        return name
      }
    }
    // The pools are large enough that this is rare; a middle initial keeps him distinct.
    const first = pool.first[rng.int(pool.first.length)] as string
    const last = pool.last[rng.int(pool.last.length)] as string
    const initial = String.fromCharCode(65 + rng.int(26))
    const name = `${first} ${initial}. ${last}`
    this.used.add(name.toLowerCase())
    return name
  }
}

/** How many distinct names the pools can make. Useful for tests and for sanity. */
export function poolSize(): number {
  let total = 0
  for (const pool of Object.values(POOLS)) total += pool.first.length * pool.last.length
  return total
}
