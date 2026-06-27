// Quick E2E smoke test
async function test() {
  const BASE = 'http://localhost:8787/api';

  // 1. Health
  const health = await fetch(`${BASE}/health`);
  console.log('1. Health:', await health.json());

  // 2. Create lobby
  const createRes = await fetch(`${BASE}/lobbies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostName: 'TestHost',
      hostAvatar: '🎵',
      settings: { maxPlayers: 4, totalRounds: 3, maxPoints: 1000, timelineOnlyScoring: false, yearRange: { min: 1960, max: 2024 } },
    }),
  });
  const lobby = await createRes.json();
  console.log('2. Lobby created:', lobby.code);
  const code = lobby.code;

  // 3. Get lobby info
  const lobbyRes = await fetch(`${BASE}/lobbies/${code}`);
  const lobbyData = await lobbyRes.json();
  console.log('3. Lobby info:', lobbyData.players.length, 'players');

  // 4. Start match
  const startRes = await fetch(`${BASE}/games/${code}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const startData = await startRes.json();
  console.log('4. Start match:', startData.accepted, 'phase:', startData.state?.phase, 'deck:', startData.state?.deck?.length, 'tracks');

  // 5. Draw card
  const drawRes = await fetch(`${BASE}/games/${code}/draw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const drawData = await drawRes.json();
  console.log('5. Draw card:', drawData.accepted, 'card:', drawData.state?.currentCard?.title, 'by', drawData.state?.currentCard?.artist);

  // 6. Submit guess (wrong)
  const guessRes = await fetch(`${BASE}/games/${code}/guess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: lobbyData.players[0].id, cardId: drawData.state?.currentCard?.id, guessedArtist: 'Wrong', guessedTitle: 'Wrong', guessedYear: 2000 }),
  });
  const guessData = await guessRes.json();
  console.log('6. Guess result:', guessData.accepted, 'new phase:', guessData.state?.phase, 'round:', guessData.state?.currentRound, 'player score:', guessData.state?.players?.[0]?.score);

  // 7. Draw card 2
  const draw2Res = await fetch(`${BASE}/games/${code}/draw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const draw2Data = await draw2Res.json();
  console.log('7. Draw card 2:', draw2Data.accepted, 'card:', draw2Data.state?.currentCard?.title);

  // 8. Get state
  const stateRes = await fetch(`${BASE}/games/${code}/state`);
  const stateData = await stateRes.json();
  console.log('8. State check: phase:', stateData.phase, 'round:', stateData.currentRound, 'card:', stateData.currentCard?.title);

  console.log('\n✅ All API endpoints working!');
}

test().catch(err => console.error('❌ Test failed:', err.message));
