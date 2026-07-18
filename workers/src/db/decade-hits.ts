/**
 * Curated iconic hits per decade, used to give "Random Hits" real
 * decade-spanning variety instead of only whatever's on the current
 * charts. Years are hardcoded ground truth (the actual original single/
 * album release year) — deliberately NOT sourced from Deezer/iTunes,
 * since those often report compilation or remaster dates for older
 * songs (see catalog-provider-constraints). Only the preview URL and
 * cover art are looked up per track at deck-build time.
 */
export interface DecadeHit {
  artist: string;
  title: string;
  year: number;
}

export const DECADE_HITS: Record<string, DecadeHit[]> = {
  '1960s': [
    { artist: 'The Beatles', title: 'Hey Jude', year: 1968 },
    { artist: 'The Rolling Stones', title: "(I Can't Get No) Satisfaction", year: 1965 },
    { artist: 'Bob Dylan', title: 'Like a Rolling Stone', year: 1965 },
    { artist: 'The Beach Boys', title: 'Good Vibrations', year: 1966 },
    { artist: 'Aretha Franklin', title: 'Respect', year: 1967 },
    { artist: 'The Beatles', title: 'Come Together', year: 1969 },
    { artist: 'Otis Redding', title: "(Sittin' On) The Dock of the Bay", year: 1968 },
    { artist: 'Marvin Gaye', title: 'I Heard It Through the Grapevine', year: 1968 },
    { artist: 'Simon & Garfunkel', title: 'The Sound of Silence', year: 1964 },
    { artist: 'The Supremes', title: 'Baby Love', year: 1964 },
  ],
  '1970s': [
    { artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975 },
    { artist: 'Led Zeppelin', title: 'Stairway to Heaven', year: 1971 },
    { artist: 'Eagles', title: 'Hotel California', year: 1976 },
    { artist: 'ABBA', title: 'Dancing Queen', year: 1976 },
    { artist: 'Bee Gees', title: 'Stayin’ Alive', year: 1977 },
    { artist: 'Fleetwood Mac', title: 'Dreams', year: 1977 },
    { artist: 'Stevie Wonder', title: 'Superstition', year: 1972 },
    { artist: 'David Bowie', title: 'Heroes', year: 1977 },
    { artist: 'Elton John', title: 'Rocket Man', year: 1972 },
    { artist: 'Michael Jackson', title: "Don't Stop 'Til You Get Enough", year: 1979 },
  ],
  '1980s': [
    { artist: 'Michael Jackson', title: 'Billie Jean', year: 1982 },
    { artist: 'Michael Jackson', title: 'Thriller', year: 1982 },
    { artist: 'Prince', title: 'Purple Rain', year: 1984 },
    { artist: 'Whitney Houston', title: 'I Wanna Dance with Somebody', year: 1987 },
    { artist: 'a-ha', title: 'Take On Me', year: 1985 },
    { artist: "Guns N' Roses", title: "Sweet Child O' Mine", year: 1987 },
    { artist: 'Eurythmics', title: 'Sweet Dreams (Are Made of This)', year: 1983 },
    { artist: 'Journey', title: "Don't Stop Believin'", year: 1981 },
    { artist: 'Cyndi Lauper', title: 'Girls Just Want to Have Fun', year: 1983 },
    { artist: 'Madonna', title: 'Like a Prayer', year: 1989 },
  ],
  '1990s': [
    { artist: 'Nirvana', title: 'Smells Like Teen Spirit', year: 1991 },
    { artist: 'Whitney Houston', title: 'I Will Always Love You', year: 1992 },
    { artist: 'Oasis', title: 'Wonderwall', year: 1995 },
    { artist: 'TLC', title: 'No Scrubs', year: 1999 },
    { artist: 'Backstreet Boys', title: 'I Want It That Way', year: 1999 },
    { artist: 'Alanis Morissette', title: 'Ironic', year: 1995 },
    { artist: 'Radiohead', title: 'Creep', year: 1992 },
    { artist: 'Britney Spears', title: '...Baby One More Time', year: 1998 },
    { artist: 'Spice Girls', title: 'Wannabe', year: 1996 },
    { artist: 'Eminem', title: 'My Name Is', year: 1999 },
  ],
  '2000s': [
    { artist: 'Outkast', title: 'Hey Ya!', year: 2003 },
    { artist: 'Beyoncé', title: 'Crazy in Love', year: 2003 },
    { artist: 'Amy Winehouse', title: 'Rehab', year: 2006 },
    { artist: 'Coldplay', title: 'Viva la Vida', year: 2008 },
    { artist: 'Rihanna', title: 'Umbrella', year: 2007 },
    { artist: 'The Killers', title: 'Mr. Brightside', year: 2004 },
    { artist: 'Gnarls Barkley', title: 'Crazy', year: 2006 },
    { artist: 'Daft Punk', title: 'One More Time', year: 2000 },
    { artist: 'Usher', title: 'Yeah!', year: 2004 },
    { artist: 'Lady Gaga', title: 'Bad Romance', year: 2009 },
  ],
  '2010s': [
    { artist: 'Adele', title: 'Rolling in the Deep', year: 2010 },
    { artist: 'Daft Punk', title: 'Get Lucky', year: 2013 },
    { artist: 'Mark Ronson', title: 'Uptown Funk', year: 2014 },
    { artist: 'Ed Sheeran', title: 'Shape of You', year: 2017 },
    { artist: 'Billie Eilish', title: 'bad guy', year: 2019 },
    { artist: 'The Weeknd', title: 'Blinding Lights', year: 2019 },
    { artist: 'Taylor Swift', title: 'Shake It Off', year: 2014 },
    { artist: 'Imagine Dragons', title: 'Radioactive', year: 2012 },
    { artist: 'Pharrell Williams', title: 'Happy', year: 2013 },
    { artist: 'Lorde', title: 'Royals', year: 2013 },
  ],
};

export const DECADES = Object.keys(DECADE_HITS);
