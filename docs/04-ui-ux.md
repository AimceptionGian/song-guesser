# 04 UI UX

## Goal
Define the user interface and experience for the Beat Timeline song-guessing game.

## Inputs
- docs/01-idea.md
- docs/03-architecture.md
- Figma design exported as docs/wireframes/04-ui-ux-wireframe-v6.html

## Decisions

### Core User Journey (V7 Wireframe)
1. **Lobby** – Player names, game info (5 cards, max 1000 pts, 60-year range)
2. **Game Screen** – Central timeline zone with interactive year slider
3. **Placed Cards** – Previously guessed songs appear above the track in a collision-free grid, each with a stem line + dot indicating their exact year on the timeline
4. **Current Card** – The active unknown song sits below the track; position updates live as the user drags the slider thumb
5. **Input Fields** – Artist and song title text boxes below the timeline
6. **Audio Player** – Mini player with play/pause, progress bar, and time display
7. **Result Screen** – Points breakdown, year/artist/title accuracy
8. **Final Screen** – Winner podium with full leaderboard

### Timeline UX Design
- No drag-and-drop: users place songs by sliding the year thumb on the track
- Collision resolution algorithm keeps placed cards visually separated even at identical years
- Stem lines + dots create unambiguous year-to-position mapping
- Purple color scheme with neon pink current indicator and green correct indicator
- Decade markers (1960–2020) provide orientation

### Screens & States
| Screen     | States                              |
|------------|-------------------------------------|
| Lobby      | default                             |
| Game       | playing, guessing, submitting       |
| Result     | per-round points and accuracy       |
| Final      | winner announcement, full ranking   |

### Wireframe Versions
| Version | File                                        | Description                               |
|---------|---------------------------------------------|-------------------------------------------|
| V1      | docs/wireframes/04-ui-ux-wireframe.html      | Initial concept                           |
| V2      | docs/wireframes/04-ui-ux-wireframe-v2.html   | Refined layout                            |
| V3      | docs/wireframes/04-ui-ux-wireframe-v3.html   | Dark theme iteration                      |
| V4      | docs/wireframes/04-ui-ux-wireframe-v4.html   | Neon/card-based design                    |
| V5      | docs/wireframes/04-ui-ux-wireframe-v5.html   | Vinyl Record Store theme                  |
| V6      | docs/wireframes/04-ui-ux-wireframe-v6.html   | Figma export – Beat Timeline purple theme |
| V7      | docs/wireframes/04-ui-ux-wireframe-v7.html   | **Target version** – Cards-in-timeline layout, collision grid  |

## Risks
- Card overlap on very close years requires collision resolution (not quite solved in V7, but it has the right idea)
- Mobile layout needs compact card sizing (handled via media queries)

## Open Questions
- Multi-player turn order UI detail for timeline view
- Wildcard / special card mechanics

## Status
approved
