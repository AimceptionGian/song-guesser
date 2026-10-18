/**
 * Identity of a song across releases and histories, for matching players'
 * listening histories against each other.
 *
 * Spotify gives the single, the album cut, the remaster and every regional
 * relink of a recording its own track id, and decorates titles with
 * release info ("… - Remastered 2011", "… (feat. X)", "… - Radio Edit").
 * Two players who both know a song therefore rarely share the id. This key
 * keeps only the primary artist and the bare title.
 *
 * Letters and digits of every script survive, so non-Latin titles don't all
 * collapse onto the same empty key.
 */
export function songKey(artist: string, title: string): string {
  const primaryArtist = artist.split(',')[0];
  const bareTitle = title
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '');
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
  return `${normalize(primaryArtist)}|${normalize(bareTitle) || normalize(title)}`;
}
