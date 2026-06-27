import type { CatalogProvider, CatalogTrack } from './catalog-provider';

/**
 * Mock catalog provider for development.
 * Returns hardcoded songs so the frontend can be developed without API keys.
 */
export class MockCatalogProvider implements CatalogProvider {
  name = 'mock-catalog';

  private tracks: CatalogTrack[] = [
    { id: 'm1', title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', year: 1975, genre: 'Rock', previewUrl: null, coverUrl: null },
    { id: 'm2', title: 'Billie Jean', artist: 'Michael Jackson', album: 'Thriller', year: 1982, genre: 'Pop', previewUrl: null, coverUrl: null },
    { id: 'm3', title: 'Smells Like Teen Spirit', artist: 'Nirvana', album: 'Nevermind', year: 1991, genre: 'Rock', previewUrl: null, coverUrl: null },
    { id: 'm4', title: 'Rolling in the Deep', artist: 'Adele', album: '21', year: 2010, genre: 'Soul', previewUrl: null, coverUrl: null },
    { id: 'm5', title: 'Shape of You', artist: 'Ed Sheeran', album: '÷', year: 2017, genre: 'Pop', previewUrl: null, coverUrl: null },
    { id: 'm6', title: 'Hotel California', artist: 'Eagles', album: 'Hotel California', year: 1976, genre: 'Rock', previewUrl: null, coverUrl: null },
    { id: 'm7', title: 'Thriller', artist: 'Michael Jackson', album: 'Thriller', year: 1983, genre: 'Pop', previewUrl: null, coverUrl: null },
    { id: 'm8', title: 'Like a Rolling Stone', artist: 'Bob Dylan', album: "Highway 61 Revisited", year: 1965, genre: 'Folk', previewUrl: null, coverUrl: null },
    { id: 'm9', title: 'Stairway to Heaven', artist: 'Led Zeppelin', album: 'Led Zeppelin IV', year: 1971, genre: 'Rock', previewUrl: null, coverUrl: null },
    { id: 'm10', title: 'Imagine', artist: 'John Lennon', album: 'Imagine', year: 1971, genre: 'Pop', previewUrl: null, coverUrl: null },
    { id: 'm11', title: 'Purple Rain', artist: 'Prince', album: 'Purple Rain', year: 1984, genre: 'Pop', previewUrl: null, coverUrl: null },
    { id: 'm12', title: 'Wonderwall', artist: 'Oasis', album: "(What's the Story) Morning Glory?", year: 1995, genre: 'Britpop', previewUrl: null, coverUrl: null },
    { id: 'm13', title: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories', year: 2013, genre: 'Funk', previewUrl: null, coverUrl: null },
    { id: 'm14', title: 'Lose Yourself', artist: 'Eminem', album: '8 Mile Soundtrack', year: 2002, genre: 'Hip-Hop', previewUrl: null, coverUrl: null },
    { id: 'm15', title: 'Hallelujah', artist: 'Jeff Buckley', album: 'Grace', year: 1994, genre: 'Rock', previewUrl: null, coverUrl: null },
  ];

  async searchTracks(query: string, limit = 10): Promise<CatalogTrack[]> {
    const lower = query.toLowerCase();
    return this.tracks
      .filter((t) => t.title.toLowerCase().includes(lower) || t.artist.toLowerCase().includes(lower))
      .slice(0, limit);
  }

  async getTrack(id: string): Promise<CatalogTrack | null> {
    return this.tracks.find((t) => t.id === id) ?? null;
  }

  async getPreviewUrl(_trackId: string): Promise<string | null> {
    return null; // mock has no previews
  }
}